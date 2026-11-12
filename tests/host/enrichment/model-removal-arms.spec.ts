/**
 * Removal admission and settlement arms: a second removal while the first owns
 * the target, removal while a download is live, a non-removal failure wrapped
 * with the delete code, and a failed download reservation dropped by removal.
 * @module tests/host/enrichment/model-removal-arms
 */
import { mkdir, readFile } from 'node:fs/promises'

import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelDownloadManager } from '../../../src/enrichment/model-downloader.ts'
import { hostSafeDirectoryDeps } from '../../../src/enrichment/safe-directory.ts'
import {
  ZOTERO_ENRICHMENT_MODEL_DELETE_FAILED,
  ZOTERO_ENRICHMENT_OPERATION_CONFLICT,
} from '../../../src/errors.ts'
import {
  modelClient,
  modelResponse,
  tinyModel,
  writeTinyBundle,
} from '../../helpers/semantic-model-bundle.ts'
import { deferred } from '../../helpers/sync.ts'
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

const sandbox = createModelSandbox('dsh-model-removal-arms-')

afterEach(async () => {
  await sandbox.settle()
})

describe('model removal admission', () => {
  it('refuses a second removal while the first still owns the target', async () => {
    const root = await sandbox.root()
    const entered = deferred<void>()
    const release = deferred<void>()
    sandbox.release(() => release.resolve())
    let gated = false
    const manager = sandbox.manager(
      new ModelDownloadManager({
        client: modelClient(),
        fs: {
          ...hostSafeDirectoryDeps,
          canonicalize: async (path) => {
            if (!gated) {
              gated = true
              entered.resolve()
              await release.promise
            }
            return await hostSafeDirectoryDeps.canonicalize!(path)
          },
        },
      }),
    )
    const firstRemoval = manager.remove(tinyModel.key, root).then(
      (value) => value,
      (error: unknown) => error,
    )
    await entered.promise
    const second = await manager.remove(tinyModel.key, root).then(
      (value) => value,
      (error: unknown) => error,
    )
    release.resolve()

    expect(second).toMatchObject({ code: ZOTERO_ENRICHMENT_OPERATION_CONFLICT })
    expect(await firstRemoval).toMatchObject({ success: true })
  })

  it('refuses removal while the model is downloading', async () => {
    const root = await sandbox.root()
    const gate = deferred<void>()
    sandbox.release(() => gate.resolve())
    const manager = sandbox.manager(
      new ModelDownloadManager({
        client: modelClient(async (url) => {
          await gate.promise
          return modelResponse(url)
        }),
      }),
    )
    await manager.start({ model: tinyModel.key, modelDir: root })

    await expect(manager.remove(tinyModel.key, root)).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_OPERATION_CONFLICT,
    })
  })

  it('wraps a non-removal failure with the delete error code', async () => {
    const root = await sandbox.root()
    const dir = await writeTinyBundle(root)
    await mkdir(join(root, `${tinyModel.physicalKey}.install`))
    const manager = sandbox.manager(new ModelDownloadManager({ client: modelClient() }))

    await expect(manager.remove(tinyModel.key, root)).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_MODEL_DELETE_FAILED,
    })
    expect(await readFile(join(dir, 'config.json'), 'utf8')).toBe('alpha')
  })
})

describe('model removal settlement', () => {
  it('drops a failed download reservation once its bundle is removed', async () => {
    const root = await sandbox.root()
    const manager = sandbox.manager(
      new ModelDownloadManager({
        client: {
          ...modelClient(),
          fetch: async () => ({ ok: false, status: 503, headers: { get: () => null }, body: null }),
        },
      }),
    )
    await manager.start({ model: tinyModel.key, modelDir: root })
    await vi.waitFor(
      async () => {
        const status = await manager.status(tinyModel.key, root)
        if (status.error === undefined) throw new Error('the download has not failed yet')
      },
      { timeout: 5_000, interval: 20 },
    )

    await expect(manager.remove(tinyModel.key, root)).resolves.toMatchObject({
      removed: false,
      removedFiles: 0,
    })
    const after = await manager.status(tinyModel.key, root)
    expect(after).toMatchObject({ ready: false, downloading: false })
    expect(after.error).toBeUndefined()
  }, 15_000)
})
