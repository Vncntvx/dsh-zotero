/**
 * Manager races that need a controlled filesystem instant: teardown while the
 * writer is still validating (before and after the physical-directory probe),
 * an aborted deletion whose signal carries or omits a reason, and a committed
 * bundle whose staging cleanup fails.
 * @module tests/host/enrichment/model-manager-races
 */
import { readdir, readFile, realpath } from 'node:fs/promises'

import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelDownloadManager } from '../../../src/enrichment/model-downloader.ts'
import { hostSafeDirectoryDeps } from '../../../src/enrichment/safe-directory.ts'
import { ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED } from '../../../src/errors.ts'
import {
  modelClient,
  modelResponse,
  tinyModel,
  writeTinyBundle,
} from '../../helpers/semantic-model-bundle.ts'
import { deferred } from '../../helpers/sync.ts'
import { createModelSandbox } from './support/model-sandbox.ts'

const control = vi.hoisted(() => ({
  lstat: undefined as undefined | ((path: string) => Promise<void> | void),
  rmdir: undefined as undefined | ((path: string) => Promise<void> | void),
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      await control.lstat?.(String(args[0]))
      return await actual.lstat(...args)
    },
    rmdir: async (...args: Parameters<typeof actual.rmdir>) => {
      await control.rmdir?.(String(args[0]))
      return await actual.rmdir(...args)
    },
  }
})

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

const sandbox = createModelSandbox('dsh-model-manager-races-')

afterEach(async () => {
  control.lstat = undefined
  control.rmdir = undefined
  await sandbox.settle()
})

describe('model manager cancellation windows', () => {
  it('refuses a start whose cancellation lands before directory admission', async () => {
    const root = await sandbox.root()
    const entered = deferred<void>()
    const resume = deferred<void>()
    sandbox.release(() => resume.resolve())
    let fetches = 0
    const manager = sandbox.manager(
      new ModelDownloadManager({
        client: {
          ...modelClient(),
          fetch: async (url) => {
            fetches += 1
            return modelResponse(url)
          },
        },
        fs: {
          ...hostSafeDirectoryDeps,
          canonicalize: async (path) => {
            if (path === root) {
              entered.resolve()
              await resume.promise
            }
            return await hostSafeDirectoryDeps.canonicalize!(path)
          },
        },
      }),
    )
    const starting = manager.start({ model: tinyModel.key, modelDir: root }).then(
      (value) => value,
      (error: unknown) => error,
    )
    await entered.promise
    const disposal = manager.dispose()
    resume.resolve()
    const [result] = await Promise.all([starting, disposal])

    expect(result).toMatchObject({ code: ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED })
    expect(fetches).toBe(0)
  })

  it('refuses a start whose cancellation lands during bundle inspection', async () => {
    const root = await sandbox.root()
    const dir = join(await realpath(root), tinyModel.physicalKey)
    let fetches = 0
    let triggered = false
    let disposal: Promise<void> | undefined
    const manager = sandbox.manager(
      new ModelDownloadManager({
        client: {
          ...modelClient(),
          fetch: async (url) => {
            fetches += 1
            return modelResponse(url)
          },
        },
      }),
    )
    control.lstat = (path) => {
      if (triggered || path !== dir) return
      triggered = true
      disposal = manager.dispose()
    }
    const result = await manager.start({ model: tinyModel.key, modelDir: root }).then(
      (value) => value,
      (error: unknown) => error,
    )
    await disposal

    expect(triggered).toBe(true)
    expect(result).toMatchObject({ code: ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED })
    expect(fetches).toBe(0)
  })

  it('keeps a committed bundle ready when staging cleanup fails', async () => {
    const root = await sandbox.root()
    const attempted = deferred<void>()
    control.rmdir = async (path) => {
      if (!path.includes('-install-')) return
      attempted.resolve()
      throw Object.assign(new Error('staging rmdir denied'), { code: 'EACCES' })
    }
    const manager = sandbox.manager(new ModelDownloadManager({ client: modelClient() }))
    await manager.start({ model: tinyModel.key, modelDir: root })
    await attempted.promise
    await vi.waitFor(
      async () => {
        const status = await manager.status(tinyModel.key, root)
        if (!status.ready) throw new Error(`not ready yet: ${JSON.stringify(status)}`)
      },
      { timeout: 5_000, interval: 20 },
    )

    const status = await manager.status(tinyModel.key, root)
    expect(status.ready).toBe(true)
    expect(await readFile(join(root, tinyModel.physicalKey, 'config.json'), 'utf8')).toBe('alpha')
    // The failed rmdir left the private stage behind, so the warning describes
    // a real cleanup failure rather than a second success path.
    const leftovers = await readdir(root)
    expect(leftovers.some((name) => name.startsWith(`.${tinyModel.physicalKey}-install-`))).toBe(
      true,
    )
  }, 15_000)
})

describe('model removal cancellation reasons', () => {
  it('keeps the caller reason when a deletion is aborted through a filesystem failure', async () => {
    const root = await sandbox.root()
    await writeTinyBundle(root)
    const canonical = await realpath(root)
    const controller = new AbortController()
    const reason = new Error('caller stopped the delete')
    control.lstat = (path) => {
      if (path !== canonical) return
      controller.abort(reason)
      throw Object.assign(new Error('model root vanished'), { code: 'EIO' })
    }
    const manager = sandbox.manager(new ModelDownloadManager({ client: modelClient() }))

    await expect(manager.remove(tinyModel.key, root, controller.signal)).rejects.toBe(reason)
    expect(await readFile(join(root, tinyModel.physicalKey, 'config.json'), 'utf8')).toBe('alpha')
  })

  it('reports the underlying removal failure when the abort carries no reason', async () => {
    const root = await sandbox.root()
    await writeTinyBundle(root)
    const canonical = await realpath(root)
    const controller = new AbortController()
    control.lstat = (path) => {
      if (path !== canonical) return
      controller.abort(null)
      throw Object.assign(new Error('model root vanished'), { code: 'EIO' })
    }
    const manager = sandbox.manager(new ModelDownloadManager({ client: modelClient() }))

    await expect(manager.remove(tinyModel.key, root, controller.signal)).rejects.toMatchObject({
      message: 'model root vanished',
      code: 'EIO',
    })
  })
})
