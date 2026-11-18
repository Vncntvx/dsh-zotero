/** Real tiny files exercise the shared installer/status/runtime bundle rule. */
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearVerifiedSnapshots,
  inspectInstalledBundle,
} from '../../src/enrichment/model-bundle-inspector.ts'
import { MANIFEST_MAX_BYTES } from '../../src/enrichment/model-manifest.ts'
import {
  createBundleVerifier,
  openSemanticEmbedder,
  verifySemanticBundle,
} from '../../src/enrichment/semantic/bundle.ts'
import { ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE } from '../../src/errors.ts'
import { tinyManifest, tinyModel, writeTinyBundle } from '../helpers/semantic-model-bundle.ts'
import { withTempDir } from '../helpers/temp-dir.ts'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, open: vi.fn(actual.open) }
})

afterEach(() => {
  clearVerifiedSnapshots()
  vi.clearAllMocks()
})

async function bundle(run: (dir: string, root: string) => Promise<void>): Promise<void> {
  await withTempDir(async (root) => await run(await writeTinyBundle(root), root))
}

async function refused(dir: string, reason: RegExp): Promise<void> {
  await expect(verifySemanticBundle(dir, tinyModel)).rejects.toMatchObject({
    code: ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE,
    message: expect.stringMatching(reason),
  })
  await expect(inspectInstalledBundle(dir, tinyManifest())).resolves.toMatchObject({
    kind: 'corrupt',
  })
}

describe('shared bundle verification', () => {
  it('accepts real files with matching manifest, sizes and SHA-256 digests', async () => {
    await bundle(async (dir) => {
      await expect(verifySemanticBundle(dir, tinyModel)).resolves.toBeUndefined()
    })
  })

  it('refuses a missing commit marker before opening any model session', async () => {
    await bundle(async (dir) => {
      await fs.unlink(join(dir, 'manifest.json'))
      await expect(openSemanticEmbedder(tinyModel, dir)).rejects.toMatchObject({
        code: ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE,
        message: expect.stringContaining('commit marker is missing'),
      })
    })
  })

  it.each([
    { ...tinyManifest(), revision: '0'.repeat(40) },
    { ...tinyManifest(), unexpected: true },
  ])('refuses any manifest disagreement with the catalog', async (marker) => {
    await bundle(async (dir) => {
      await fs.writeFile(join(dir, 'manifest.json'), JSON.stringify(marker))
      await refused(dir, /disagrees with the catalog/)
    })
  })

  it('refuses an oversized manifest before reading it', async () => {
    await bundle(async (dir) => {
      await fs.writeFile(join(dir, 'manifest.json'), Buffer.alloc(MANIFEST_MAX_BYTES + 1))
      const open = vi.mocked(fs.open)
      await refused(dir, /exceeds its bounded size/)
      expect(open.mock.calls.some(([path]) => String(path).endsWith('manifest.json'))).toBe(false)
    })
  })

  it('distinguishes an unsafe commit-marker path from cacheable corruption', async () => {
    await bundle(async (dir) => {
      const marker = join(dir, 'manifest.json')
      await fs.unlink(marker)
      await fs.mkdir(marker)
      await expect(verifySemanticBundle(dir, tinyModel)).rejects.toMatchObject({
        name: 'ZoteroError',
        message: expect.stringContaining('commit marker is not a regular file'),
      })
      await expect(inspectInstalledBundle(dir, tinyManifest())).resolves.toMatchObject({
        kind: 'corrupt',
      })
    })
  })

  it.each(['[', '[]'])(
    'classifies invalid manifest bytes (%s) as deterministic corruption',
    async (marker) => {
      await bundle(async (dir) => {
        await fs.writeFile(join(dir, 'manifest.json'), marker)
        await expect(verifySemanticBundle(dir, tinyModel)).rejects.toMatchObject({
          kind: 'corrupt',
          snapshot: expect.objectContaining({ dir }),
        })
      })
    },
  )

  it.each(['manifest.json', 'config.json'])(
    'does not cache a temporary open failure for %s',
    async (name) => {
      await bundle(async (dir) => {
        const original = vi.mocked(fs.open).getMockImplementation()!
        const failure = Object.assign(new Error('temporarily unavailable'), { code: 'EIO' })
        vi.mocked(fs.open).mockImplementation(async (...args) => {
          if (String(args[0]) === join(dir, name)) throw failure
          return original(...args)
        })
        try {
          const verifier = createBundleVerifier()
          await expect(verifier.verify(dir, tinyModel)).rejects.toMatchObject({ cause: failure })
          await expect(inspectInstalledBundle(dir, tinyManifest())).resolves.toMatchObject({
            kind: 'corrupt',
          })
          vi.mocked(fs.open).mockImplementation(original)
          await expect(verifier.verify(dir, tinyModel)).resolves.toBeUndefined()
        } finally {
          vi.mocked(fs.open).mockImplementation(original)
        }
      })
    },
  )

  it('refuses a missing pinned file', async () => {
    await bundle(async (dir) => {
      await fs.unlink(join(dir, 'config.json'))
      await refused(dir, /config\.json is missing/)
    })
  })

  it('refuses a pinned file at the wrong size', async () => {
    await bundle(async (dir) => {
      await fs.writeFile(join(dir, 'config.json'), 'a')
      await refused(dir, /config\.json is 1 bytes, expected 5/)
    })
  })

  it('invalidates a remembered identity after a same-size mutation', async () => {
    await bundle(async (dir) => {
      await createBundleVerifier().verify(dir, tinyModel)
      await fs.writeFile(join(dir, 'config.json'), 'wrong')
      await refused(dir, /config\.json failed its SHA-256 check/)
    })
  })

  it('refuses a symbolic link even when its bytes match the pin', async () => {
    await bundle(async (dir, root) => {
      const target = join(root, 'outside-config')
      await fs.rename(join(dir, 'config.json'), target)
      await fs.symlink(target, join(dir, 'config.json'))
      await refused(dir, /config\.json is missing or not a regular file/)
    })
  })

  it('refuses symbolic links in parent paths before reading their files', async () => {
    await bundle(async (dir, root) => {
      const target = join(root, 'outside-onnx')
      await fs.rename(join(dir, 'onnx'), target)
      await fs.symlink(target, join(dir, 'onnx'))
      const open = vi.mocked(fs.open)
      await refused(dir, /onnx is not a regular directory/)
      expect(open).not.toHaveBeenCalled()
    })
  })

  it('reads each manifest once and reuses file hashes across replacement verifiers', async () => {
    await bundle(async (dir) => {
      const open = vi.mocked(fs.open)
      await createBundleVerifier().verify(dir, tinyModel)
      await createBundleVerifier().verify(dir, tinyModel)
      await inspectInstalledBundle(dir, tinyManifest())
      const paths = open.mock.calls.map(([path]) => String(path))
      expect(paths.filter((path) => path.endsWith('manifest.json'))).toHaveLength(3)
      for (const file of tinyModel.files)
        expect(paths.filter((path) => path.endsWith(file.path))).toHaveLength(1)
    })
  })

  it('invalidates shared verification when the catalog changes', async () => {
    await bundle(async (dir) => {
      await createBundleVerifier().verify(dir, tinyModel)
      await expect(
        createBundleVerifier().verify(dir, { ...tinyModel, revision: '0'.repeat(40) }),
      ).rejects.toThrow(/disagrees with the catalog/)
    })
  })

  it('refuses unsafe catalog paths through the semantic error vocabulary', async () => {
    await bundle(async (dir) => {
      const unsafe = {
        ...tinyModel,
        files: [{ path: '..\\evil', bytes: 1, sha256: 'a'.repeat(64) }],
      }
      await expect(verifySemanticBundle(dir, unsafe)).rejects.toMatchObject({
        code: ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE,
        message: expect.stringContaining('invalid catalog path'),
      })
    })
  })
})
