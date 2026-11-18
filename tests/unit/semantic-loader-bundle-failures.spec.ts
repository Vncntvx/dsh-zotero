import { expect, it, vi } from 'vitest'
import { createBundleInspector } from '../../src/enrichment/model-bundle-inspector.ts'
import { SemanticBundleFailure } from '../../src/enrichment/semantic/bundle-failure.ts'
import { SemanticEmbedderLoader } from '../../src/enrichment/semantic/loader.ts'
import { tinyManifest, tinyModel, writeTinyBundle } from '../helpers/semantic-model-bundle.ts'
import { withTempDir } from '../helpers/temp-dir.ts'
import { rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

it.each(['missing', 'in-place', 'same-size-replacement'] as const)(
  'reuses a deterministic failure until %s changes the snapshot',
  async (change) => {
    await withTempDir(async (root) => {
      const dir =
        change === 'missing' ? join(root, tinyModel.physicalKey) : await writeTinyBundle(root)
      const file = join(dir, 'config.json')
      if (change !== 'missing') await writeFile(file, 'xx')
      const inspector = createBundleInspector()
      const snapshot = await inspector.snapshot({ dir, expected: tinyManifest() })
      const failure = new SemanticBundleFailure(
        'bad bundle',
        change === 'missing' ? 'missing' : 'corrupt',
        snapshot,
      )
      const open = vi
        .fn()
        .mockRejectedValueOnce(failure)
        .mockResolvedValue({
          dimension: tinyModel.dimension,
          embed: async () => [],
          dispose: async () => {},
        })
      const loader = new SemanticEmbedderLoader({ open, inspector })
      const target = { dir, spec: tinyModel }
      try {
        await expect(loader.get(target)).rejects.toBe(failure)
        await expect(loader.get(target)).rejects.toBe(failure)
        expect(open).toHaveBeenCalledOnce()
        if (change === 'missing') await writeTinyBundle(root)
        else if (change === 'in-place') await writeFile(file, 'y')
        else {
          await writeFile(join(root, 'replacement'), 'yy')
          await rename(join(root, 'replacement'), file)
        }
        await (await loader.get(target)).dispose()
        expect(open).toHaveBeenCalledTimes(2)
      } finally {
        await loader.dispose()
      }
    })
  },
)

it('does not memoize runtime errors and clears failures on retirement and installation', async () => {
  await withTempDir(async (dir) => {
    const target = { dir, spec: tinyModel }
    const inspector = createBundleInspector()
    const failure = new SemanticBundleFailure(
      'missing bundle',
      'missing',
      await inspector.snapshot({ dir, expected: tinyManifest() }),
    )
    const open = vi
      .fn()
      .mockRejectedValueOnce(new Error('worker crashed'))
      .mockRejectedValue(failure)
    const loader = new SemanticEmbedderLoader({ open, inspector })
    try {
      await expect(loader.get(target)).rejects.toThrow('worker crashed')
      await expect(loader.get(target)).rejects.toBe(failure)
      await expect(loader.get(target)).rejects.toBe(failure)
      expect(open).toHaveBeenCalledTimes(2)
      loader.retire(target)
      await expect(loader.get(target)).rejects.toBe(failure)
      loader.forgetBundleFailures(dir)
      await expect(loader.get(target)).rejects.toBe(failure)
      expect(open).toHaveBeenCalledTimes(4)
    } finally {
      await loader.dispose()
    }
  })
})
