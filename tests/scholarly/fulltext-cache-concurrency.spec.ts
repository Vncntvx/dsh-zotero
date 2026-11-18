import { expect, it, vi } from 'vitest'
import { ScholarlyTextStore, type FullTextRecord } from '../../src/scholarly/fulltext/store.ts'
import { readRegularFile } from '../../src/regular-file.ts'
import { deferred } from '../helpers/sync.ts'
import { withTempDir } from '../helpers/temp-dir.ts'

vi.mock('../../src/regular-file.ts', { spy: true })

it.each([false, true])(
  'cannot restore or evict a newer entry from a late disk read (read failed: %s)',
  async (failed) => {
    await withTempDir(async (root) => {
      const old = {
        provider: 'arxiv-html',
        format: 'markdown',
        text: '# Old',
        source: 'arXiv HTML',
        url: 'https://arxiv.org/html/2301.07041',
        sourceIdentity: 'https://arxiv.org/html/2301.07041',
      } satisfies FullTextRecord
      const fresh = { ...old, text: '# Fresh' }
      await new ScholarlyTextStore(root).set('paper', old)
      const store = new ScholarlyTextStore(root)
      const read = vi.mocked(readRegularFile)
      const readFile = read.getMockImplementation() ?? read
      const captured = deferred<void>()
      const resume = deferred<void>()
      read.mockImplementationOnce(async (...args) => {
        const bytes = await readFile(...args)
        captured.resolve()
        await resume.promise
        if (failed) throw new Error('the old descriptor failed')
        return bytes
      })
      const oldRead = store.get('paper')
      try {
        await captured.promise
        expect(await store.delete('paper')).toBeUndefined()
        await store.set('paper', fresh)
      } finally {
        resume.resolve()
      }
      expect(await oldRead).toEqual({ kind: 'miss' })
      expect(await store.get('paper')).toMatchObject({ kind: 'hit', entry: { record: fresh } })
    })
  },
)
