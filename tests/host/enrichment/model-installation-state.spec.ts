/** WP4/D3: the real manager's read-only bundle inspection and repair admission. */
import { readFile, rm, stat, writeFile } from 'node:fs/promises'

import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelDownloadManager } from '../../../src/enrichment/model-downloader.ts'
import {
  modelClient,
  tinyManifest,
  tinyModel,
  writeTinyBundle,
} from '../../helpers/semantic-model-bundle.ts'
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

const sandbox = createModelSandbox('dsh-model-inspection-')

async function world() {
  const root = await sandbox.root()
  const manager = sandbox.manager(new ModelDownloadManager({ client: modelClient() }))
  return { root, manager }
}

afterEach(async () => {
  await sandbox.settle()
})

describe('model installation inspection', () => {
  it.each(['status', 'verify'] as const)(
    '%s leaves a missing custom root absent',
    async (method) => {
      const { root, manager } = await world()
      const missing = join(root, 'draft', 'models')
      const status = await manager[method](tinyModel.key, missing)

      expect(status).toMatchObject({ ready: false, downloading: false })
      await expect(stat(join(root, 'draft'))).rejects.toMatchObject({ code: 'ENOENT' })
    },
  )

  it.each(['status', 'verify'] as const)(
    '%s requires the manifest commit marker',
    async (method) => {
      const { root, manager } = await world()
      const dir = await writeTinyBundle(root)
      await rm(join(dir, 'manifest.json'))

      expect((await manager[method](tinyModel.key, root)).ready).toBe(false)
      await expect(stat(join(dir, 'manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    },
  )

  it.each(['status', 'verify'] as const)(
    '%s rejects a manifest for a different revision',
    async (method) => {
      const { root, manager } = await world()
      await writeTinyBundle(root, { ...tinyManifest(), revision: 'c'.repeat(40) })

      expect((await manager[method](tinyModel.key, root)).ready).toBe(false)
    },
  )

  it('invalidates a previously ready bundle after a same-size file mutation', async () => {
    const { root, manager } = await world()
    const dir = await writeTinyBundle(root)
    expect((await manager.status(tinyModel.key, root)).ready).toBe(true)
    await writeFile(join(dir, 'config.json'), 'wrong')

    expect((await manager.status(tinyModel.key, root)).ready).toBe(false)
    expect(await readFile(join(dir, 'config.json'), 'utf8')).toBe('wrong')
  })

  it('admits repair of a size-correct bundle without a commit marker', async () => {
    const { root, manager } = await world()
    const dir = await writeTinyBundle(root)
    await rm(join(dir, 'manifest.json'))

    expect((await manager.start({ model: tinyModel.key, modelDir: root })).status).toBe('started')
  })

  it('admits repair of a same-size corrupt file instead of answering already-ready', async () => {
    const { root, manager } = await world()
    const dir = await writeTinyBundle(root)
    await writeFile(join(dir, 'config.json'), 'wrong')

    expect((await manager.start({ model: tinyModel.key, modelDir: root })).status).toBe('started')
  })
})
