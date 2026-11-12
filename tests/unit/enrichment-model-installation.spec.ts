/**
 * The transactional installer's settlement rule: a cleanup failure after a
 * committed publication never turns success into failure.
 *
 * The bundle is published before the private staging directory is removed, so a
 * cleanup error leaves an installed, ready bundle. Throwing there made the
 * manager report a failed install for a model that was on disk and ready, and
 * left the success branch that surfaces `cleanupError` unreachable.
 * @module tests/unit/enrichment-model-installation
 */

import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/enrichment-model-catalog.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/enrichment-model-catalog.js')>()
  const fileA = Buffer.from('alpha')
  const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
  const tiny = {
    key: 'balanced',
    physicalKey: 'tiny',
    label: 'tiny',
    physicalModel: 'tiny',
    note: 'tiny',
    modelId: 'acme/tiny',
    revision: 'b'.repeat(40),
    dimension: 2,
    maxTokens: 16,
    languages: ['*'],
    license: 'MIT',
    pooling: 'mean',
    normalize: true,
    queryPrefix: '',
    documentPrefix: '',
    files: [{ path: 'config.json', bytes: fileA.length, sha256: sha(fileA) }],
  }
  return {
    ...actual,
    SEMANTIC_MODEL_KEYS: ['balanced'],
    DEFAULT_SEMANTIC_MODEL: 'balanced',
    SEMANTIC_MODELS: [tiny],
    semanticModelOf: (key: string) => {
      if (key !== 'balanced') throw new TypeError(`unknown semantic model "${key}"`)
      return tiny
    },
    semanticModelBytes: () => fileA.length,
  }
})

import { manifestOf, semanticModelOf } from '../../src/enrichment-model-catalog.ts'
import { createBundleInspector } from '../../src/enrichment/model-bundle-inspector.ts'
import {
  installModelBundle,
  safeModelRelativePath,
} from '../../src/enrichment/model-installation.ts'
import { HarnessError } from '@deepseek-ai/dsh-llm'

const spec = semanticModelOf('balanced')
const bytesOf: Record<string, Buffer> = { 'config.json': Buffer.from('alpha') }

let roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-install-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  const current = roots
  roots = []
  await Promise.all(current.map((root) => rm(root, { recursive: true, force: true })))
})

describe('installModelBundle cleanup settlement', () => {
  it('resolves with the installed bundle and reports the cleanup failure', async () => {
    const root = await tempRoot()
    const dir = join(root, spec.physicalKey)
    const result = await installModelBundle({
      dir,
      expected: manifestOf(spec),
      inspector: createBundleInspector(),
      transfer: async (file, stagingDir) => {
        await writeFile(join(stagingDir, file.path), bytesOf[file.path]!)
      },
      cleanup: async () => {
        throw new Error('staging rmdir failed')
      },
    })
    expect(result.status).toBe('installed')
    expect(String(result.cleanupError)).toContain('staging rmdir failed')
    // The publication happened: the marker and the pinned file are both in
    // place, and the bundle inspects as ready.
    expect(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')).schema).toBe(2)
    const inspection = await createBundleInspector().inspect({
      dir,
      expected: manifestOf(spec),
    })
    expect(inspection.kind).toBe('ready')
  })

  it('still rejects when the installation itself fails', async () => {
    const root = await tempRoot()
    const dir = join(root, spec.physicalKey)
    await expect(
      installModelBundle({
        dir,
        expected: manifestOf(spec),
        inspector: createBundleInspector(),
        transfer: async () => {
          throw new Error('transfer failed')
        },
        cleanup: async () => {
          throw new Error('staging rmdir failed')
        },
      }),
    ).rejects.toBeDefined()
    const inspection = await createBundleInspector().inspect({
      dir,
      expected: manifestOf(spec),
    })
    expect(inspection.kind).not.toBe('ready')
  })

  it('refuses an unsafe path with a routable harness error', () => {
    // The installer's own refusals are what a CLI sees when it loads this
    // module directly: `HarnessError` gives them a routeable name and code,
    // where a bare `Error` subclass left the code as decoration.
    let thrown: unknown
    try {
      safeModelRelativePath('../escape')
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(HarnessError)
    expect(thrown).toMatchObject({
      name: 'ModelInstallationError',
      code: 'MODEL_INSTALLATION_FAILED',
    })
    expect((thrown as Error).message).toContain('invalid relative path')
  })
})
