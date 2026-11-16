/** A file existing is not evidence that it was built from current inputs. */
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertBuildFresh, writeBuildState } from '../../../scripts/build-state.mjs'
import { withTempDir } from '../../helpers/temp-dir.js'

async function built(root: string): Promise<void> {
  await mkdir(join(root, 'src'))
  await mkdir(join(root, 'lib'))
  await writeFile(join(root, 'package.json'), '{"name":"build-fixture"}')
  await writeFile(join(root, 'src/index.ts'), 'export const answer = 42')
  await writeFile(join(root, 'lib/index.js'), 'export const answer = 42')
  await writeFile(join(root, 'lib/index.d.ts'), 'export declare const answer: 42')
  writeBuildState(root)
}

describe('build provenance', () => {
  it('accepts only the stamped source and complete emitted bytes', async () => {
    await withTempDir(async (root) => {
      await built(root)
      expect(assertBuildFresh(root).outputs.files['lib/index.d.ts']).toMatch(/^[a-f0-9]{64}$/)
      await writeFile(join(root, 'src/index.ts'), 'export const answer = 43')
      expect(() => assertBuildFresh(root)).toThrow('stale or modified')
    })
  })
  it.each(['lib/index.js', 'lib/index.d.ts'])(
    'rejects a missing emitted artifact: %s',
    async (file) => {
      await withTempDir(async (root) => {
        await built(root)
        await rm(join(root, file))
        expect(() => assertBuildFresh(root)).toThrow('stale or modified')
      })
    },
  )
  it('rejects an artifact modified after the build', async () => {
    await withTempDir(async (root) => {
      await built(root)
      await writeFile(join(root, 'lib/index.js'), 'modified')
      expect(() => assertBuildFresh(root)).toThrow('stale or modified')
    })
  })
})
