/**
 * The `zotero_changes` tool surface: baseline readings and minted cursors,
 * diffs over items, child objects, trash, and deletions, group libraries,
 * unobservable kinds, and the render of every digest and withheld cursor.
 * @module tests/tools/changes
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BASELINE_NO_INSTANCE_MESSAGE,
  BASELINE_NO_VERSION_MESSAGE,
  baselineCursorMessage,
  CHANGES_NO_DELETIONS_MESSAGE,
  CHANGES_NOT_ADVANCED_FULLTEXT,
  CHANGES_NOT_ADVANCED_LIBRARY_MOVED,
  CHANGES_NOT_ADVANCED_NO_VERSION,
  CHANGES_NOT_ADVANCED_UNVERIFIED,
  FULLTEXT_COUNTER_NOTE,
  otherDeletedMessage,
  renderChanges,
  UNOBSERVABLE_NOT_SERVED_MESSAGE,
  UNOBSERVABLE_RANGE_NOT_COVERED_MESSAGE,
  UNOBSERVABLE_UNREADABLE_MESSAGE,
} from '../../src/tools/changes.js'
import { type HostLane, setupHostLane } from '../helpers/lanes/host-lane.js'

let lane: HostLane

beforeEach(async () => {
  lane = await setupHostLane()
})

afterEach(async () => {
  await lane.teardown()
})

describe('change digest rendering', () => {
  it('renders digests, withheld cursors, and unobservable kinds honestly', () => {
    // Three baseline outcomes, three texts: a cursor, a version without an
    // instance, and no version at all. None of them is a bare "Baseline
    // reading." that leaves the model guessing why no cursor came back.
    const noVersion = renderChanges({}, { changed: {}, versionUnavailable: true } as never)
    expect((noVersion[0] as { text: string }).text).toContain(BASELINE_NO_VERSION_MESSAGE)
    const noInstance = renderChanges({}, { changed: {} } as never)
    expect((noInstance[0] as { text: string }).text).toContain(BASELINE_NO_INSTANCE_MESSAGE)
    const based = renderChanges({}, {
      changed: {},
      cursor: { serverId: 'S1', library: { type: 'user', id: 0 }, version: 42 },
    } as never)
    expect((based[0] as { text: string }).text).toContain(baselineCursorMessage(42, 'S1'))

    // A capped listing is a digest: the cursor still stands and totals carries
    // the counts behind the rows that were dropped.
    const digest = renderChanges({}, {
      fromVersion: 1,
      cursor: { serverId: 'S1', library: { type: 'user', id: 0 }, version: 220 },
      changed: {
        items: Array.from({ length: 50 }, (_, i) => ({
          key: `KEY${String(i).padStart(4, '0')}`,
          version: i + 2,
        })),
      },
      totals: { items: 120 },
      truncated: true,
    } as never)
    const digestText = (digest[0] as { text: string }).text
    expect(digestText).toContain('Changes 1 → 220')
    expect(digestText).toContain(
      'Items (top-level): 120 changed — 50 newest listed, raise maxChangesResults for the rest',
    )
    // Every key the read returned is printed: the listing is bounded by
    // maxChangesResults, so a second cut here only hid keys the model could
    // already see counted.
    expect(digestText).toContain('KEY0049 (v51)')
    expect(digestText).not.toContain('KEY0050')

    const incomplete = renderChanges({}, {
      fromVersion: 1,
      changed: {
        items: Array.from({ length: 25 }, (_, i) => ({
          key: `KEY${String(i).padStart(4, '0')}`,
          version: i + 2,
        })),
      },
      deleted: {
        items: Array.from({ length: 22 }, (_, i) => `GONE${String(i).padStart(4, '0')}`),
      },
      truncated: true,
    } as never)
    const text = (incomplete[0] as { text: string }).text
    expect(text).toContain(CHANGES_NOT_ADVANCED_UNVERIFIED)
    // A listing the read returned whole is printed whole: the 25th key and
    // the 22nd tombstone included.
    expect(text).toContain('Items (top-level): 25 changed')
    expect(text).toContain('  - KEY0024 (v26)')
    expect(text).not.toContain('more')
    expect(text).toContain('Deleted items: 22')
    expect(text).toContain('  - GONE0021')

    const moved = renderChanges({}, {
      fromVersion: 1,
      libraryChanged: true,
      changed: { items: [] },
      unobservable: [{ kind: 'deleted', reason: 'not-served' }],
    } as never)
    const movedText = (moved[0] as { text: string }).text
    expect(movedText).toContain(CHANGES_NOT_ADVANCED_LIBRARY_MOVED)
    expect(movedText).toContain(UNOBSERVABLE_NOT_SERVED_MESSAGE)
    expect(movedText).toContain('deleted')

    const cappedDeleted = renderChanges({}, {
      fromVersion: 1,
      cursor: { serverId: 'S1', library: { type: 'user', id: 0 }, version: 220 },
      changed: { items: [] },
      deleted: {
        items: Array.from({ length: 50 }, (_, i) => `GONE${String(i).padStart(4, '0')}`),
        collections: [],
        savedSearches: [],
        tags: ['obsolete'],
      },
      totals: { deletedItems: 540, deletedTags: 1, deletedOther: 3 },
      truncated: true,
    } as never)
    const cappedText = (cappedDeleted[0] as { text: string }).text
    expect(cappedText).toContain('Deleted items: 540 — 50 listed')
    expect(cappedText).toContain('Deleted tags: 1')
    expect(cappedText).toContain(otherDeletedMessage(3))
    expect(cappedText).not.toContain(CHANGES_NO_DELETIONS_MESSAGE)

    // An observed, empty tombstone read is stated positively.
    const nothingRemoved = renderChanges({}, {
      fromVersion: 1,
      cursor: { serverId: 'S1', library: { type: 'user', id: 0 }, version: 220 },
      changed: { items: [] },
      deleted: { items: [], collections: [], savedSearches: [], tags: [] },
      totals: { deletedItems: 0, deletedCollections: 0, deletedSavedSearches: 0, deletedTags: 0 },
    } as never)
    expect((nothingRemoved[0] as { text: string }).text).toContain(CHANGES_NO_DELETIONS_MESSAGE)

    // Child objects and trash have their own sections: a reader of a diff must
    // be able to tell a top-level item from the note or PDF beneath it.
    const childSections = renderChanges({}, {
      fromVersion: 1,
      cursor: { serverId: 'S1', library: { type: 'user', id: 0 }, version: 220 },
      changed: {
        items: [{ key: 'PARN1234', version: 219 }],
        childItems: [{ key: 'ANNO1234', version: 218 }],
        trashedItems: [{ key: 'TRSH1234', version: 217 }],
      },
      totals: { items: 1, childItems: 1, trashedItems: 1 },
    } as never)
    const childText = (childSections[0] as { text: string }).text
    expect(childText).toContain('Items (top-level): 1 changed')
    expect(childText).toContain('Child objects (notes, attachments, annotations): 1 changed')
    expect(childText).toContain('Items in the trash: 1 changed')

    // A diff whose build reported no version says so instead of blaming the range.
    const noVersionDiff = renderChanges({}, {
      fromVersion: 1,
      changed: {},
      versionUnavailable: true,
    } as never)
    expect((noVersionDiff[0] as { text: string }).text).toContain(CHANGES_NOT_ADVANCED_NO_VERSION)

    // Each unobservable reason reads as its own remedy.
    const reasons = renderChanges({}, {
      fromVersion: 1,
      libraryChanged: false,
      changed: {},
      unobservable: [
        { kind: 'deleted', reason: 'not-served' },
        { kind: 'collections', reason: 'range-not-covered' },
        { kind: 'fulltext', reason: 'unreadable' },
      ],
    } as never)
    const reasonsText = (reasons[0] as { text: string }).text
    expect(reasonsText).toContain(UNOBSERVABLE_NOT_SERVED_MESSAGE)
    expect(reasonsText).toContain(UNOBSERVABLE_RANGE_NOT_COVERED_MESSAGE)
    expect(reasonsText).toContain(UNOBSERVABLE_UNREADABLE_MESSAGE)
    expect(reasonsText).toContain('deleted')
    expect(reasonsText).toContain('collections')
    expect(reasonsText).toContain('fulltext')

    const fulltext = renderChanges({ include: ['fulltext'] }, {
      fromVersion: 1,
      changed: { fulltextAttachments: [{ key: 'WXYZ6789', version: 90071 }] },
      totals: { fulltextAttachments: 1 },
    } as never)
    const fulltextText = (fulltext[0] as { text: string }).text
    expect(fulltextText).toContain(FULLTEXT_COUNTER_NOTE)
    expect(fulltextText).toContain(CHANGES_NOT_ADVANCED_FULLTEXT)

    const fulltextFromSince = renderChanges(
      {
        since: {
          serverId: 'S1',
          library: { type: 'user', id: 0 },
          version: 1,
          include: ['fulltext'],
          unserved: [],
        },
      },
      {
        fromVersion: 1,
        changed: { fulltextAttachments: [{ key: 'WXYZ6789', version: 90071 }] },
        totals: { fulltextAttachments: 1 },
      } as never,
    )
    const fulltextFromSinceText = (fulltextFromSince[0] as { text: string }).text
    expect(fulltextFromSinceText).toContain(CHANGES_NOT_ADVANCED_FULLTEXT)
  })
})
