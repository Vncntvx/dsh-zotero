/** Model removal safety: catalog-only deletion, symlink refusal, and clean status after removal. */
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelDownloadManager } from '../../../src/enrichment/model-downloader.ts'
import { removeModelBundle } from '../../../src/enrichment/model-removal.ts'
import {
  ZOTERO_ENRICHMENT_MODEL_DELETE_FAILED,
  ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED,
  ZOTERO_INVALID_ARGUMENT,
} from '../../../src/errors.ts'
import {
  modelClient,
  tinyManifest,
  tinyModel,
  writeTinyBundle,
} from '../../helpers/semantic-model-bundle.ts'

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

const roots: string[] = []
const managers: ModelDownloadManager[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-model-removal-'))
  roots.push(root)
  return root
}

function managerOf(): ModelDownloadManager {
  const manager = new ModelDownloadManager({ client: modelClient() })
  managers.push(manager)
  return manager
}

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('model bundle removal', () => {
  it('removes pinned files and the marker while preserving unknown files', async () => {
    const root = await tempRoot()
    const dir = await writeTinyBundle(root)
    const notes = join(dir, 'notes.txt')
    await writeFile(notes, 'keep me')

    const result = await managerOf().remove(tinyModel.key, root, new AbortController().signal)

    expect(result).toMatchObject({ removed: true, removedFiles: 3 })
    expect(
      await lstat(join(dir, 'manifest.json')).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
    expect(
      await lstat(join(dir, 'config.json')).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
    expect(
      await lstat(join(dir, 'onnx/model_quantized.onnx')).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
    expect(await readFile(notes, 'utf8')).toBe('keep me')
  })

  it('clears a corrupt bundle and reports a clean missing status afterwards', async () => {
    const root = await tempRoot()
    await writeTinyBundle(root, { wrong: true })
    const manager = managerOf()

    const before = await manager.status(tinyModel.key, root)
    expect(before.ready).toBe(false)
    expect(before.error).toBeDefined()

    await manager.remove(tinyModel.key, root)
    const after = await manager.status(tinyModel.key, root)
    expect(after).toMatchObject({ ready: false, downloadedBytes: 0 })
    expect(after.error).toBeUndefined()
  })

  it('treats a never-downloaded model as a normal missing state and a no-op removal', async () => {
    const root = await tempRoot()
    const manager = managerOf()

    const status = await manager.status(tinyModel.key, root)
    expect(status).toMatchObject({ ready: false, downloadedBytes: 0 })
    expect(status.error).toBeUndefined()

    await expect(manager.remove(tinyModel.key, root)).resolves.toMatchObject({ removed: false })
  })

  it('refuses a bundle-directory symlink and preserves its target', async () => {
    const root = await tempRoot()
    const outside = await tempRoot()
    const sentinel = join(outside, 'sentinel.txt')
    await writeFile(sentinel, 'sentinel')
    await symlink(outside, join(root, tinyModel.physicalKey))

    await expect(managerOf().remove(tinyModel.key, root)).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_MODEL_DELETE_FAILED,
    })
    expect(await readFile(sentinel, 'utf8')).toBe('sentinel')
  })

  it('refuses a nested symlink and preserves its target', async () => {
    const root = await tempRoot()
    const dir = await writeTinyBundle(root)
    const outside = await tempRoot()
    const sentinel = join(outside, 'model_quantized.onnx')
    await writeFile(sentinel, 'sentinel')
    await rm(join(dir, 'onnx'), { recursive: true, force: true })
    await symlink(outside, join(dir, 'onnx'))

    await expect(managerOf().remove(tinyModel.key, root)).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_MODEL_DELETE_FAILED,
    })
    expect(await readFile(sentinel, 'utf8')).toBe('sentinel')
  })

  it('removes a symlinked pinned file without following it', async () => {
    const root = await tempRoot()
    const dir = await writeTinyBundle(root)
    const outside = await tempRoot()
    const sentinel = join(outside, 'sentinel.txt')
    await writeFile(sentinel, 'sentinel')
    await rm(join(dir, 'config.json'))
    await symlink(sentinel, join(dir, 'config.json'))

    const result = await managerOf().remove(tinyModel.key, root)

    expect(result).toMatchObject({ removed: true, removedFiles: 3 })
    expect(await readFile(sentinel, 'utf8')).toBe('sentinel')
  })

  it('skips a pinned file whose parent directory is gone', async () => {
    const root = await tempRoot()
    const dir = await writeTinyBundle(root)
    await rm(join(dir, 'onnx'), { recursive: true, force: true })

    const result = await managerOf().remove(tinyModel.key, root)

    expect(result).toMatchObject({ removed: true, removedFiles: 2 })
  })

  it('removes pinned files when the commit marker is already gone', async () => {
    const root = await tempRoot()
    const dir = await writeTinyBundle(root)
    await rm(join(dir, 'manifest.json'), { force: true })

    const result = await managerOf().remove(tinyModel.key, root)

    expect(result).toMatchObject({ removed: true, removedFiles: 2 })
  })

  it('refuses an unknown model and a closed manager', async () => {
    const root = await tempRoot()
    const manager = managerOf()
    await expect(manager.remove('nope' as never, root)).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
    })
    await manager.dispose()
    await expect(manager.remove(tinyModel.key, root)).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED,
    })
  })

  it('refuses mismatched and unsafe bundle paths directly', async () => {
    const root = await tempRoot()
    await expect(
      removeModelBundle({ dir: join(root, 'other'), expected: tinyManifest() }),
    ).rejects.toMatchObject({ code: 'MODEL_REMOVAL_FAILED' })
    await expect(
      removeModelBundle({
        dir: join(root, 'bad key'),
        expected: { ...tinyManifest(), physicalKey: 'bad key' },
      }),
    ).rejects.toMatchObject({ code: 'MODEL_REMOVAL_FAILED' })
    await writeFile(join(root, tinyModel.physicalKey), 'not a directory')
    await expect(
      removeModelBundle({ dir: join(root, tinyModel.physicalKey), expected: tinyManifest() }),
    ).rejects.toMatchObject({ code: 'MODEL_REMOVAL_FAILED' })
  })

  it('refuses a root path that is a regular file', async () => {
    const root = await tempRoot()
    const file = join(root, 'not-a-directory')
    await writeFile(file, 'x')
    await expect(
      removeModelBundle({ dir: join(file, tinyModel.physicalKey), expected: tinyManifest() }),
    ).rejects.toMatchObject({ code: 'MODEL_REMOVAL_FAILED' })
  })

  it('counts only the pinned files that were present', async () => {
    const root = await tempRoot()
    const dir = await writeTinyBundle(root)
    await rm(join(dir, 'config.json'))

    const result = await managerOf().remove(tinyModel.key, root)

    expect(result).toMatchObject({ removed: true, removedFiles: 2 })
  })

  it('refuses a pinned path that is a directory', async () => {
    const root = await tempRoot()
    const dir = await writeTinyBundle(root)
    await rm(join(dir, 'config.json'))
    await mkdir(join(dir, 'config.json'))

    await expect(managerOf().remove(tinyModel.key, root)).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_MODEL_DELETE_FAILED,
    })
  })

  it('treats a missing model root as a no-op removal', async () => {
    const root = await tempRoot()
    await expect(
      managerOf().remove(tinyModel.key, join(root, 'missing', 'models')),
    ).resolves.toMatchObject({ removed: false })
  })

  it('prunes nested catalog directories after removing their files', async () => {
    const root = await tempRoot()
    const dir = join(root, 'nested-model')
    await mkdir(join(dir, 'a/b'), { recursive: true })
    await writeFile(join(dir, 'a/b/c.bin'), 'c')
    await writeFile(join(dir, 'a/d.bin'), 'd')
    const pin = (text: string) => ({
      bytes: Buffer.byteLength(text),
      sha256: createHash('sha256').update(text).digest('hex'),
    })

    const result = await removeModelBundle({
      dir,
      expected: {
        ...tinyManifest(),
        physicalKey: 'nested-model',
        files: { 'a/b/c.bin': pin('c'), 'a/d.bin': pin('d') },
      },
    })

    expect(result).toMatchObject({ removed: true, removedFiles: 2 })
    expect(
      await lstat(dir).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
  })
})
