/** WP4/D4: real filesystem sentinels around force and streamed file publication. */
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelDownloadManager } from '../../../src/enrichment/model-downloader.ts'
import { downloadPinnedFile } from '../../../src/enrichment/model-download-client.ts'
import { ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED } from '../../../src/errors.ts'
import { modelClient, tinyModel, writeTinyBundle } from '../../helpers/semantic-model-bundle.ts'

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
  const root = await mkdtemp(join(tmpdir(), 'dsh-model-safety-'))
  roots.push(root)
  return root
}

function managerOf() {
  const manager = new ModelDownloadManager({ client: modelClient() })
  managers.push(manager)
  return manager
}

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('model installation filesystem ownership', () => {
  it('force preserves files outside the catalog in the existing model directory', async () => {
    const root = await tempRoot()
    const dir = await writeTinyBundle(root)
    const unknown = join(dir, 'user-notes.txt')
    await writeFile(unknown, 'user-owned notes')

    await managerOf().start({ model: tinyModel.key, modelDir: root, force: true })

    expect(await readFile(unknown, 'utf8')).toBe('user-owned notes')
  })

  it('force preserves an unknown symlink and its external referent', async () => {
    const root = await tempRoot()
    const dir = await writeTinyBundle(root)
    const sentinel = join(root, 'sentinel.txt')
    const link = join(dir, 'user-link')
    await writeFile(sentinel, 'sentinel')
    await symlink(sentinel, link)

    await managerOf().start({ model: tinyModel.key, modelDir: root, force: true })

    expect(await readFile(sentinel, 'utf8')).toBe('sentinel')
    expect((await lstat(link)).isSymbolicLink()).toBe(true)
  })

  it('refuses a physical model directory symlink before admitting a writer', async () => {
    const root = await tempRoot()
    const outside = await tempRoot()
    const sentinel = join(outside, 'sentinel.txt')
    await writeFile(sentinel, 'sentinel')
    await symlink(outside, join(root, tinyModel.physicalKey))

    const result = await managerOf()
      .start({ model: tinyModel.key, modelDir: root })
      .then(
        (value) => value,
        (error: unknown) => error,
      )

    expect(await readFile(sentinel, 'utf8')).toBe('sentinel')
    expect(result).toMatchObject({ code: ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED })
  })

  it('does not follow a planted predictable download-temp symlink', async () => {
    const root = await tempRoot()
    const sentinel = join(root, 'sentinel.txt')
    await writeFile(sentinel, 'sentinel')
    const dir = join(root, 'bundle')
    await mkdir(dir)
    await symlink(sentinel, join(dir, 'config.json.hf-mirror.tmp'))

    await downloadPinnedFile({
      model: tinyModel,
      file: tinyModel.files[0]!,
      dir,
      sources: ['hf-mirror'],
      deps: modelClient(),
    }).catch(() => undefined)

    expect(await readFile(sentinel, 'utf8')).toBe('sentinel')
  })

  it('refuses a nested model directory symlink without replacing its pinned-file sentinel', async () => {
    const root = await tempRoot()
    const outside = await tempRoot()
    const sentinel = join(outside, 'model_quantized.onnx')
    await writeFile(sentinel, 'sentinel')
    await symlink(outside, join(root, 'onnx'))

    await downloadPinnedFile({
      model: tinyModel,
      file: tinyModel.files[1]!,
      dir: root,
      sources: ['hf-mirror'],
      deps: modelClient(),
    }).catch(() => undefined)

    expect(await readFile(sentinel, 'utf8')).toBe('sentinel')
  })
})
