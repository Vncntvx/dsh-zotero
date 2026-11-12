/** WP4/D2: manager reservations must outlive validation, cancellation and cleanup. */
import { realpath } from 'node:fs/promises'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelDownloadManager } from '../../../src/enrichment/model-downloader.ts'
import { hostSafeDirectoryDeps } from '../../../src/enrichment/safe-directory.ts'
import { ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED } from '../../../src/errors.ts'
import { modelClient, tinyModel } from '../../helpers/semantic-model-bundle.ts'
import { deferred, progress } from '../../helpers/sync.ts'
import { createModelSandbox } from './support/model-sandbox.ts'

vi.mock('../../../src/enrichment-model-catalog.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/enrichment-model-catalog.js')>()
  const { tinyModel } = await import('../../helpers/semantic-model-bundle.ts')
  return {
    ...actual,
    SEMANTIC_MODEL_KEYS: [tinyModel.key],
    SEMANTIC_MODELS: [tinyModel],
    semanticModelOf: () => tinyModel,
  }
})

const sandbox = createModelSandbox('dsh-model-ownership-')

async function heldTransfer() {
  const root = await sandbox.root()
  const cleanup = deferred()
  const changed = progress()
  const requests: AbortSignal[] = []
  let aborted = 0
  sandbox.release(() => cleanup.resolve())
  const client = modelClient(async (_url, init) => {
    const signal = init!.signal!
    requests.push(signal)
    changed.notify()
    await Promise.race([
      new Promise<void>((resolve) => {
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', () => resolve(), { once: true })
      }),
      cleanup.promise,
    ])
    aborted += 1
    changed.notify()
    // A transport can need asynchronous cleanup after receiving cancellation.
    await cleanup.promise
    throw signal.reason
  })
  const manager = sandbox.manager(new ModelDownloadManager({ client }))
  return { root, manager, client, cleanup, changed, requests, aborted: () => aborted }
}

afterEach(async () => {
  await sandbox.settle()
})

describe('model download task ownership', () => {
  it('concurrent starts reserve one writer before the asynchronous disk probe', async () => {
    const world = await heldTransfer()
    const admission = deferred()
    sandbox.release(() => admission.resolve())
    let arrivals = 0
    const manager = new ModelDownloadManager({
      client: world.client,
      fs: {
        ...hostSafeDirectoryDeps,
        access: async (path, mode) => {
          await hostSafeDirectoryDeps.access(path, mode)
          arrivals += 1
          if (arrivals === 2) admission.resolve()
          await admission.promise
        },
      },
    })
    sandbox.manager(manager)
    // Both calls leave the injected directory boundary in the same microtask
    // turn, before either real disk probe can finish its first asynchronous stat.
    const starts = [
      manager.start({ model: tinyModel.key, modelDir: world.root }),
      manager.start({ model: tinyModel.key, modelDir: world.root }),
    ]
    // A fixed manager may join before repeating directory validation at all.
    // That public result also releases the boundary, so the test does not need
    // duplicate validation.
    void starts[1]!.then(
      () => admission.resolve(),
      () => admission.resolve(),
    )
    const results = await Promise.all(starts)

    expect(results.map(({ status }) => status).sort()).toEqual(['downloading', 'started'])
  })

  it('cancel remains pending until the aborted transfer has released its resources', async () => {
    const world = await heldTransfer()
    await world.manager.start({ model: tinyModel.key, modelDir: world.root })
    await world.changed.when(() => world.requests.length === 1)
    let settled = false
    const cancellation = world.manager.cancel(tinyModel.key, world.root).then((value) => {
      settled = true
      return value
    })
    try {
      await world.changed.when(() => world.aborted() === 1)
      // This public read also gives the cancellation call a chance to settle.
      const status = await world.manager.status(tinyModel.key, world.root)
      expect(settled).toBe(false)
      expect(status.ready).toBe(false)
    } finally {
      world.cleanup.resolve()
      await cancellation
    }
  })

  it('dispose still waits for a transfer whose cancellation is already in progress', async () => {
    const world = await heldTransfer()
    await world.manager.start({ model: tinyModel.key, modelDir: world.root })
    await world.changed.when(() => world.requests.length === 1)
    const cancellation = world.manager.cancel(tinyModel.key, world.root)
    await world.changed.when(() => world.aborted() === 1)
    let disposed = false
    const disposal = world.manager.dispose().then(() => {
      disposed = true
    })
    try {
      await world.manager.status(tinyModel.key, world.root)
      expect(disposed).toBe(false)
    } finally {
      world.cleanup.resolve()
      await Promise.all([cancellation, disposal])
    }
  })

  it('repeated disposal waits for the same unfinished transfer', async () => {
    const world = await heldTransfer()
    await world.manager.start({ model: tinyModel.key, modelDir: world.root })
    await world.changed.when(() => world.requests.length === 1)
    const first = world.manager.dispose()
    await world.changed.when(() => world.aborted() === 1)
    let secondSettled = false
    const second = world.manager.dispose().then(() => {
      secondSettled = true
    })
    try {
      await world.manager.status(tinyModel.key, world.root)
      expect(secondSettled).toBe(false)
    } finally {
      world.cleanup.resolve()
      await Promise.all([first, second])
    }
  })

  it('repeated cancellation joins the same resource cleanup', async () => {
    const world = await heldTransfer()
    await world.manager.start({ model: tinyModel.key, modelDir: world.root })
    await world.changed.when(() => world.requests.length === 1)
    const first = world.manager.cancel(tinyModel.key, world.root)
    await world.changed.when(() => world.aborted() === 1)
    let secondSettled = false
    const second = world.manager.cancel(tinyModel.key, world.root).then((value) => {
      secondSettled = true
      return value
    })
    try {
      await world.manager.status(tinyModel.key, world.root)
      expect(secondSettled).toBe(false)
    } finally {
      world.cleanup.resolve()
      await Promise.all([first, second])
    }
  })

  it('a repeated start cannot replace a task that is still cancelling', async () => {
    const world = await heldTransfer()
    await world.manager.start({ model: tinyModel.key, modelDir: world.root })
    await world.changed.when(() => world.requests.length === 1)
    const cancellation = world.manager.cancel(tinyModel.key, world.root)
    try {
      await world.changed.when(() => world.aborted() === 1)
      const joined = await world.manager.start({ model: tinyModel.key, modelDir: world.root })
      expect(joined.status).toBe('downloading')
    } finally {
      world.cleanup.resolve()
      await cancellation
    }
  })

  it('a disposed manager rejects new starts before creating a transport', async () => {
    const world = await heldTransfer()
    await world.manager.dispose()
    const result = await world.manager.start({ model: tinyModel.key, modelDir: world.root }).then(
      (value) => value,
      (error: unknown) => error,
    )

    expect(world.requests).toHaveLength(0)
    expect(result).toMatchObject({ code: ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED })
  })

  it('dispose covers a start suspended in directory validation', async () => {
    const world = await heldTransfer()
    const entered = deferred()
    const resume = deferred()
    sandbox.release(() => resume.resolve())
    const canonical = await realpath(world.root)
    const manager = new ModelDownloadManager({
      client: world.client,
      fs: {
        ...hostSafeDirectoryDeps,
        // The directory resolver admits the complete candidate through its
        // canonicalize seam before any stat, so pause there instead of in
        // realpath. The reservation must already own the start by then.
        canonicalize: async (path) => {
          if (path === world.root) {
            entered.resolve()
            await resume.promise
            return canonical
          }
          return await realpath(path)
        },
      },
    })
    sandbox.manager(manager)
    const starting = manager.start({ model: tinyModel.key, modelDir: world.root }).then(
      (value) => value,
      (error: unknown) => error,
    )
    await entered.promise
    const disposal = manager.dispose()
    resume.resolve()
    const [result] = await Promise.all([starting, disposal])

    expect(world.requests).toHaveLength(0)
    expect(result).toMatchObject({ code: ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED })
  })
})
