/**
 * Pure decoding of sync diffs and background job results.
 * @module tests/client/sources/decoders-sync
 */

import { describe, expect, it } from 'vitest'
import {
  changesMetaOf,
  jobArmOf,
  jobSummaryKeyOf,
} from '../../../src/client/sources/sync-decoder.ts'

describe('changesMetaOf', () => {
  const DIFF = {
    fromVersion: 10,
    cursor: { version: 20, serverId: 'abc123' },
    changed: {
      items: [
        { key: 'AAAA1111', version: 11 },
        { key: 'BBBB2222', version: 12 },
      ],
      collections: [{ key: 'COLL1111', version: 13 }],
    },
    deleted: { items: ['CCCC3333'], collections: [], savedSearches: [], tags: [] },
    totals: { items: 4, collections: 1, deletedItems: 2 },
  }

  it('counts the changed families and the deletions apart', () => {
    const meta = changesMetaOf(DIFF)
    // Four objects changed, two were deleted. Counting the `deleted*` totals
    // into the changed total reported six: more changes than the library had.
    expect(meta.changedTotal).toBe(5)
    expect(meta.deletedTotal).toBe(2)
    expect(meta.fromVersion).toBe(10)
    expect(meta.cursor).toEqual({ version: 20, serverId: 'abc123' })
  })

  it('reads each changed kind with its keys and versions, skipping unasked kinds', () => {
    const meta = changesMetaOf(DIFF)
    expect(meta.changed.map((section) => section.key)).toEqual(['items', 'collections'])
    expect(meta.changed[0]!.entries).toEqual([
      { key: 'AAAA1111', version: 11 },
      { key: 'BBBB2222', version: 12 },
    ])
    // The true count sits beside the bounded listing.
    expect(meta.changed[0]!.total).toBe(4)
  })

  it('reads the removals with their own true counts', () => {
    const meta = changesMetaOf(DIFF)
    expect(meta.deleted.map((section) => section.key)).toEqual([
      'items',
      'collections',
      'savedSearches',
      'tags',
    ])
    expect(meta.deleted[0]!.keys).toEqual(['CCCC3333'])
    expect(meta.deleted[0]!.total).toBe(2)
  })

  it('still reports the true counts when the byte budget dropped the listings', () => {
    const meta = changesMetaOf({ fromVersion: 10, totals: { items: 900, deletedItems: 3 } })
    expect(meta.changed).toEqual([])
    expect(meta.changedTotal).toBe(900)
    expect(meta.deletedTotal).toBe(3)
  })

  it('falls back to the listing size when no totals were reported', () => {
    const meta = changesMetaOf({
      changed: { items: [{ key: 'AAAA1111', version: 11 }] },
      deleted: { items: ['CCCC3333'] },
    })
    expect(meta.changedTotal).toBe(1)
    expect(meta.deletedTotal).toBe(1)
  })

  it('counts removals of kinds it does not report individually', () => {
    // The tool counts tombstones it never lists (`totals.deletedOther`). Omitting
    // them would leave the summary smaller than the tool's own count while
    // presenting it as authoritative.
    const meta = changesMetaOf({
      changed: {},
      deleted: { items: ['CCCC3333'], collections: [], savedSearches: [], tags: [] },
      totals: { deletedItems: 2, deletedOther: 3 },
    })
    // The wire always carries all four tombstone families; `other` joins them.
    expect(meta.deleted.map((section) => section.key)).toEqual([
      'items',
      'collections',
      'savedSearches',
      'tags',
      'other',
    ])
    expect(meta.deleted.at(-1)).toEqual({
      key: 'other',
      label: 'toolDeletedOther',
      total: 3,
      keys: [],
    })
    expect(meta.deletedTotal).toBe(5)
  })

  it('leaves the other bucket out when nothing was removed through it', () => {
    const meta = changesMetaOf({
      changed: {},
      deleted: { items: [], collections: [], savedSearches: [], tags: [] },
      totals: { deletedItems: 0, deletedOther: 0 },
    })
    expect(meta.deleted.map((section) => section.key)).toEqual([
      'items',
      'collections',
      'savedSearches',
      'tags',
    ])
    expect(meta.deletedTotal).toBeNull()
  })

  it('reads the range and the kinds the diff could not observe', () => {
    const meta = changesMetaOf({
      fromVersion: 10,
      changed: { items: [{ key: 'AAAA1111', version: 11 }] },
      totals: { items: 1 },
      unobservable: [
        { kind: 'collections', reason: 'not-served' },
        { kind: 'savedSearches', reason: 'unreadable' },
        { kind: 'invented', reason: 'not-a-reason' },
        'junk',
      ],
    })
    expect(meta.fromVersion).toBe(10)
    expect(meta.withheld).toEqual([
      { kind: 'collections', reason: 'not-served' },
      { kind: 'savedSearches', reason: 'unreadable' },
    ])
  })

  it('reports no withheld list when the diff covered everything', () => {
    expect(changesMetaOf({ changed: { items: [] } }).withheld).toBeNull()
    expect(changesMetaOf({ changed: { items: [] }, unobservable: [] }).withheld).toBeNull()
  })

  it('keeps the unobservable list beside a cursor, which is the normal shape', () => {
    // For a standalone resource, `not-served` and `range-not-covered` do not
    // withhold the cursor (those changes were never observable in any range)
    // so a diff with a coverage gap and a cursor is the ordinary result, not an
    // edge case. Suppressing the list there would hide the gap in exactly the
    // case it exists to report.
    const meta = changesMetaOf({
      cursor: { version: 20, serverId: 'abc' },
      changed: { items: [{ key: 'AAAA1111', version: 11 }] },
      unobservable: [{ kind: 'deleted', reason: 'not-served' }],
    })
    expect(meta.cursor).toEqual({ version: 20, serverId: 'abc' })
    expect(meta.withheld).toEqual([{ kind: 'deleted', reason: 'not-served' }])
  })

  it('reports a range the diff could not cover as a withheld kind', () => {
    const meta = changesMetaOf({
      cursor: { version: 20, serverId: 'abc' },
      changed: { items: [{ key: 'AAAA1111', version: 11 }] },
      unobservable: [{ kind: 'collections', reason: 'range-not-covered' }],
    })
    expect(meta.withheld).toEqual([{ kind: 'collections', reason: 'range-not-covered' }])
  })

  it('still reports no count for a diff that found nothing', () => {
    const meta = changesMetaOf({ fromVersion: 10, changed: {}, totals: {} })
    expect(meta.changedTotal).toBeNull()
    expect(meta.deletedTotal).toBeNull()
    expect(meta.withheld).toBeNull()
  })

  it('drops malformed rows and withholds an unpinned cursor', () => {
    const meta = changesMetaOf({
      cursor: { version: 'twenty' },
      changed: { items: [{ key: 'AAAA1111' }, { version: 12 }, 'junk', { key: 'B', version: 2 }] },
    })
    expect(meta.changed[0]!.entries).toEqual([{ key: 'B', version: 2 }])
    // A cursor without both halves cannot be passed back as `since`.
    expect(meta.cursor).toBeNull()
  })

  it('drops a withheld entry that names no kind or no reason', () => {
    const meta = changesMetaOf({
      changed: { items: [] },
      unobservable: [{ kind: 'collections' }, { reason: 'not-served' }],
    })
    expect(meta.withheld).toBeNull()
  })

  it('drops a changed section that is not a listing', () => {
    const meta = changesMetaOf({ changed: { items: 'not-a-listing' } })
    expect(meta.changed[0]!.entries).toEqual([])
  })
})

describe('background job projection', () => {
  it('decodes both job arms and their summary keys', () => {
    expect(jobArmOf({ kind: 'background', jobId: 'job-7' })).toEqual({
      kind: 'background',
      jobId: 'job-7',
    })
    expect(jobSummaryKeyOf({ kind: 'promoted', jobId: 'job-8' })).toBe('toolSummaryJobPromoted')
    expect(jobSummaryKeyOf({ kind: 'background', jobId: 'job-7' })).toBe('toolSummaryJobBackground')
    expect(jobArmOf({ kind: 'applied' })).toBeNull()
    expect(jobArmOf({ kind: 'background' })).toBeNull()
  })
})
