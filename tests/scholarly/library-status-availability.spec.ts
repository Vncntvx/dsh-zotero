/** Unreadable candidates count unresolved papers, while a later proven match resolves them. */
import { expect, it } from 'vitest'
import { annotateWithLibraryStatus } from '../../src/scholarly/zotero-link.js'
import { libraryOf, paperOf, recordOf } from './support/library-status.js'

it('discloses an invalid local reference instead of implying absence', async () => {
  const { notice, report } = await annotateWithLibraryStatus(
    [paperOf()],
    libraryOf([recordOf({ ref: 'invalid-local-reference' })]),
  )
  expect(report).toEqual({ matched: 0, failed: 0, unparseable: 1 })
  expect(notice).toContain('unavailable for 1 of 1 results')
  expect(notice).toContain('invalid item reference')
})

it('counts three failed detail candidates as one unresolved paper', async () => {
  const papers = [paperOf({ doi: '10.1234/expected' })]
  const library = libraryOf(
    Array.from({ length: 3 }, (_, i) =>
      recordOf({
        ref: `zotero://user/0/item/ITEM123${i}`,
        title: 'Another unrelated paper title',
      }),
    ),
  )
  const { notice, report } = await annotateWithLibraryStatus(papers, {
    ...library,
    get: async () => {
      throw new Error('detail unavailable')
    },
  })
  expect(report).toEqual({ matched: 0, failed: 1, unparseable: 0 })
  expect(notice).toContain('unavailable for 1 of 1 results')
})

it('reports each unresolved paper once even when malformed and unreadable candidates overlap', async () => {
  const { notice, report } = await annotateWithLibraryStatus(
    [paperOf({ doi: '10.1234/expected' })],
    {
      ...libraryOf([
        recordOf({ ref: 'invalid' }),
        recordOf({ title: 'Another unrelated paper title' }),
      ]),
      get: async () => {
        throw new Error('detail unavailable')
      },
    },
  )
  expect(report.failed + report.unparseable).toBe(1)
  expect(notice).toContain('unavailable for 1 of 1 results')
})

it('removes unavailable status when a later valid candidate proves membership', async () => {
  const { notice, report } = await annotateWithLibraryStatus(
    [paperOf()],
    libraryOf([recordOf({ ref: 'invalid' }), recordOf()]),
  )
  expect(report).toEqual({ matched: 1, failed: 0, unparseable: 0 })
  expect(notice).toBe('')
})
