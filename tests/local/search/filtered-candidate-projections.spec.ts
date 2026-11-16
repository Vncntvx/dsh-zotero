/** Paging one filter reuses its projection; old filter variants remain bounded per scan. */
import { expect, it } from 'vitest'
import { filteredCandidatesOf, type FilteredIndex } from '../../../src/local/search-index.js'
import type { ZoteroSearchRequest } from '../../../src/types.js'

const request: ZoteroSearchRequest = {
  query: '',
  mode: 'metadata',
  scope: { kind: 'library' },
  sort: 'dateModified',
  direction: 'desc',
  offset: 0,
  limit: 20,
  yearFrom: 2020,
}
it('reuses the accepted candidate set across offsets and isolates a new scan identity', () => {
  let reads = 0
  const index: FilteredIndex = {
    candidates: Array.from({ length: 1000 }, (_unused, key) => ({
      key: String(key),
      get year() {
        reads++
        return key % 2 === 0 ? 2024 : 2010
      },
    })),
    attachmentIndexed: false,
    fetchedAt: 0,
  }
  const first = filteredCandidatesOf(index, request)
  const firstReads = reads
  expect(first).toHaveLength(500)
  expect(filteredCandidatesOf(index, { ...request, offset: 20 })).toBe(first)
  expect(reads).toBe(firstReads)
  expect(filteredCandidatesOf({ ...index }, request)).not.toBe(first)
  expect(reads).toBeGreaterThan(firstReads)
})

it('retains four recent variants and evicts the least recently used projection', () => {
  const index: FilteredIndex = {
    candidates: [{ key: 'one', year: 2024, hasAttachment: true }],
    attachmentIndexed: true,
    fetchedAt: 0,
  }
  const first = filteredCandidatesOf(index, request)
  const old = filteredCandidatesOf(index, { ...request, yearFrom: 2021 })
  for (const yearFrom of [2022, 2023]) filteredCandidatesOf(index, { ...request, yearFrom })
  expect(filteredCandidatesOf(index, request)).toBe(first)
  filteredCandidatesOf(index, { ...request, yearFrom: 2024 })
  expect(filteredCandidatesOf(index, request)).toBe(first)
  expect(filteredCandidatesOf(index, { ...request, yearFrom: 2021 })).not.toBe(old)
  expect(filteredCandidatesOf(index, { ...request, hasAttachment: false })).toEqual([])
})
