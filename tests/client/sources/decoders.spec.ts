/**
 * The meta decoding layer: presentation projections decoded defensively,
 * absent or malformed fields degrade instead of crashing.
 * @module tests/client/sources/decoders
 */

import { describe, expect, it } from 'vitest'
import {
  attachmentMetaOf,
  changesMetaOf,
  childrenMetaOf,
  exportMetaOf,
  jobArmOf,
  getMetaOf,
  retrieveMetaOf,
  searchMetaOf,
  writeMetaOf,
} from '../../../src/client/sources/decoders.ts'

describe('searchMetaOf', () => {
  const ROW = {
    ref: 'zotero://user/0/item/ABCDEFGH',
    title: 'Paper',
    creatorSummary: 'Creator',
    year: 2020,
  }

  it('decodes valid rows and the omission count', () => {
    const meta = searchMetaOf({
      returned: 3,
      total: 42,
      displayed: 3,
      omitted: 0,
      noteMatches: 1,
      items: [
        ROW,
        {
          ...ROW,
          bestAttachmentRef: 'zotero://user/0/attachment/WXYZ6789',
          bestAttachmentType: 'application/pdf',
        },
      ],
    })
    expect(meta.omitted).toBe(0)
    expect(meta.returned).toBe(3)
    expect(meta.total).toBe(42)
    expect(meta.rows).toEqual([
      ROW,
      {
        ...ROW,
        bestAttachmentRef: 'zotero://user/0/attachment/WXYZ6789',
        bestAttachmentType: 'application/pdf',
      },
    ])
  })

  it('decodes a row item type and omits it when the projection left it out', () => {
    expect(searchMetaOf({ items: [{ ...ROW, itemType: 'preprint' }] }).rows).toEqual([
      { ...ROW, itemType: 'preprint' },
    ])
    expect(searchMetaOf({ items: [ROW] }).rows).toEqual([ROW])
  })

  it('nulls the page facts when the projection carries none', () => {
    const meta = searchMetaOf({ items: [ROW] })
    expect(meta.returned).toBeNull()
    expect(meta.total).toBeNull()
  })

  it('degrades malformed rows to null and absent facts to null', () => {
    const meta = searchMetaOf({ items: [{ ref: 'x' }] })
    expect(meta.rows).toBeNull()
    expect(meta.omitted).toBeNull()
  })

  it('degrades a non-record row to null and omits an absent year', () => {
    expect(searchMetaOf({ items: ['x'] }).rows).toBeNull()
    const meta = searchMetaOf({
      items: [
        {
          ref: 'zotero://user/0/item/ABCDEFGH',
          title: 'T',
          creatorSummary: 'C',
        },
      ],
    })
    expect(meta.rows).toEqual([
      { ref: 'zotero://user/0/item/ABCDEFGH', title: 'T', creatorSummary: 'C' },
    ])
  })

  it('decodes the resolved library for personal and group scopes', () => {
    const user = searchMetaOf({
      items: [],
      scope: { kind: 'library', library: { type: 'user', id: 0 } },
      library: { type: 'user', id: 0 },
    })
    expect(user.library).toEqual({ type: 'user', id: 0 })
    expect(user.scope).toEqual({ kind: 'library', library: { type: 'user', id: 0 } })
    const group = searchMetaOf({
      items: [],
      scope: { kind: 'library', library: { type: 'group', id: 42 } },
      library: { type: 'group', id: 42 },
    })
    expect(group.library).toEqual({ type: 'group', id: 42 })
    const publications = searchMetaOf({
      items: [],
      scope: { kind: 'publications', library: { type: 'group', id: 7 } },
      library: { type: 'group', id: 7 },
    })
    expect(publications.scope).toEqual({ kind: 'publications', library: { type: 'group', id: 7 } })
  })

  it('degrades unparseable or unsupported scope libraries to null, never personal', () => {
    expect(searchMetaOf({ items: [], library: { type: 'user', id: 5 } }).library).toBeNull()
    expect(
      searchMetaOf({ items: [], library: { type: 'group', id: 99999999999999999999 } }).library,
    ).toBeNull()
    expect(searchMetaOf({ items: [], library: { type: 'group', id: 0 } }).library).toBeNull()
    expect(searchMetaOf({ items: [], library: 'user/0' }).library).toBeNull()
    expect(searchMetaOf({ items: [] }).library).toBeNull()
    expect(searchMetaOf({ items: [], scope: { kind: 'library' } }).scope).toBeNull()
    expect(
      searchMetaOf({
        items: [],
        scope: { kind: 'collection', ref: 'zotero://user/0/collection/C1', name: 'C' },
      }).scope,
    ).toEqual({ kind: 'collection', ref: 'zotero://user/0/collection/C1', name: 'C' })
    expect(searchMetaOf({ items: [], scope: { kind: 'tags' } }).scope).toBeNull()
  })
})

describe('getMetaOf', () => {
  it('decodes the attachment selection with its ref', () => {
    const meta = getMetaOf({
      title: 'T',
      creators: 'C',
      year: 2020,
      venue: 'V',
      bestAttachment: {
        ref: 'zotero://user/0/attachment/WXYZ6789',
        contentType: 'application/pdf',
      },
    })
    expect(meta.title).toBe('T')
    expect(meta.creators).toBe('C')
    expect(meta.bestAttachment).toEqual({
      ref: 'zotero://user/0/attachment/WXYZ6789',
      contentType: 'application/pdf',
    })
  })

  it('keeps a ref-less attachment selection as the content type alone', () => {
    const meta = getMetaOf({ bestAttachment: { contentType: 'application/pdf' } })
    expect(meta.bestAttachment).toEqual({ contentType: 'application/pdf' })
  })

  it('degrades absent and malformed fields to null', () => {
    const meta = getMetaOf({ title: 3, bestAttachment: 'x' })
    expect(meta.title).toBeNull()
    expect(meta.bestAttachment).toBeNull()
  })

  it('ignores an attachment record without a content type', () => {
    expect(getMetaOf({ bestAttachment: {} }).bestAttachment).toBeNull()
  })

  it('reads the per-kind child counts the detail call reported', () => {
    const meta = getMetaOf({
      notes: { total: 5, returned: 2 },
      annotations: { total: 3, returned: 3 },
    })
    expect(meta.notes).toEqual({ total: 5, returned: 2 })
    expect(meta.annotations).toEqual({ total: 3, returned: 3 })
    // A kind the call did not ask for is absent, not zero: "no annotations
    // exist" and "annotations were not requested" are different facts.
    expect(meta.attachments).toBeNull()
  })

  it('nulls a child count the projection left without a total', () => {
    expect(getMetaOf({ notes: { returned: 2 } }).notes).toBeNull()
    expect(getMetaOf({ notes: 'x' }).notes).toBeNull()
  })

  it('reads a total with no returned count as everything having come back', () => {
    expect(getMetaOf({ notes: { total: 4 } }).notes).toEqual({ total: 4, returned: 4 })
  })

  it('reads the bounded note and annotation previews', () => {
    const meta = getMetaOf({
      notesPreview: [
        { ref: 'zotero://user/0/note/NOTE1234', preview: 'a reading note' },
        {
          ref: 'zotero://user/0/note/NOTE5678',
          preview: 'another',
          parentRef: 'zotero://user/0/item/ABCD1234',
        },
      ],
      annotationsPreview: [
        {
          ref: 'zotero://user/0/annotation/ANN12345',
          preview: 'highlighted',
          pageLabel: '7',
          parentRef: 'zotero://user/0/attachment/WXYZ6789',
        },
      ],
    })
    expect(meta.notesPreview).toEqual([
      {
        ref: 'zotero://user/0/note/NOTE1234',
        preview: 'a reading note',
        pageLabel: null,
        parentRef: null,
      },
      {
        ref: 'zotero://user/0/note/NOTE5678',
        preview: 'another',
        pageLabel: null,
        parentRef: 'zotero://user/0/item/ABCD1234',
      },
    ])
    expect(meta.annotationsPreview[0]).toEqual({
      ref: 'zotero://user/0/annotation/ANN12345',
      preview: 'highlighted',
      pageLabel: '7',
      parentRef: 'zotero://user/0/attachment/WXYZ6789',
    })
  })

  it('drops a preview row that names nothing readable', () => {
    const meta = getMetaOf({
      notesPreview: [
        { ref: 'zotero://user/0/note/NOTE1234', preview: 'kept' },
        { ref: 'zotero://user/0/note/NOTE5678' },
        { preview: 'no ref' },
        'junk',
      ],
    })
    expect(meta.notesPreview).toHaveLength(1)
    expect(meta.annotationsPreview).toEqual([])
  })
})

describe('retrieveMetaOf', () => {
  const ITEM = {
    source: 'annotation',
    sourceRef: 'zotero://user/0/annotation/ANN1',
    preview: 'claim',
    previewTruncated: false,
    pageLabel: '7',
    attachmentRef: 'zotero://user/0/attachment/WXYZ6789',
  }

  it('reads the availability facts, attachment ref, and coverage', () => {
    const meta = retrieveMetaOf({
      count: 1,
      sources: ['annotation'],
      truncated: true,
      sourcesSkipped: [],
      items: [ITEM],
      attachmentRef: 'zotero://user/0/attachment/WXYZ6789',
      coverage: { indexedPages: 5, totalPages: 10, complete: false },
      sourceAvailability: {
        annotation: { requested: true, returnedPassages: 1, unavailable: false },
        note: { requested: true, returnedPassages: 0, unavailable: true },
      },
    })
    expect(meta.truncated).toBe(true)
    expect(meta.attachmentRef).toBe('zotero://user/0/attachment/WXYZ6789')
    expect(meta.coverage).toEqual({ indexedPages: 5, totalPages: 10, complete: false })
    expect(meta.sourceAvailability).toEqual({
      annotation: { requested: true, returnedPassages: 1, unavailable: false },
      note: { requested: true, returnedPassages: 0, unavailable: true },
    })
    expect(meta.items).toEqual([ITEM])
  })

  it('drops malformed availability entries and coverage', () => {
    const meta = retrieveMetaOf({
      items: [],
      sourceAvailability: { annotation: { requested: true }, note: 'x' },
      coverage: { indexedPages: 1 },
    })
    expect(meta.sourceAvailability).toEqual({})
    expect(meta.coverage).toBeNull()
    expect(meta.truncated).toBeNull()
  })

  it('reads a chars-axis coverage', () => {
    const meta = retrieveMetaOf({
      items: [],
      coverage: { indexedChars: 100, totalChars: 200, complete: true },
    })
    expect(meta.coverage).toEqual({ indexedChars: 100, totalChars: 200, complete: true })
  })

  it('degrades malformed items to null', () => {
    const meta = retrieveMetaOf({ items: [{ source: 'annotation' }] })
    expect(meta.items).toBeNull()
  })
})

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
    // into the changed total reported six — more changes than the library had.
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
    // withhold the cursor — those changes were never observable in any range —
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

  it('still reports no count for a diff that found nothing', () => {
    const meta = changesMetaOf({ fromVersion: 10, changed: {}, totals: {} })
    expect(meta.changedTotal).toBeNull()
    expect(meta.deletedTotal).toBeNull()
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
})

describe('childrenMetaOf', () => {
  it('partitions the listing by kind, in the order the tool returns them', () => {
    const meta = childrenMetaOf({
      ref: 'zotero://user/0/item/ABCD1234',
      itemType: 'journalArticle',
      notes: { total: 1, returned: 1, items: [{ ref: 'zotero://user/0/note/N1', text: 'a' }] },
      attachments: {
        total: 1,
        returned: 1,
        items: [
          { ref: 'zotero://user/0/attachment/A1', title: 'p.pdf', contentType: 'application/pdf' },
        ],
      },
      annotations: {
        total: 2,
        returned: 1,
        items: [
          {
            ref: 'zotero://user/0/annotation/ANN1',
            type: 'highlight',
            text: 'hit',
            color: '#ffd400',
            pageLabel: '3',
            parentRef: 'zotero://user/0/attachment/A1',
          },
        ],
      },
    })
    expect(meta.itemType).toBe('journalArticle')
    expect(meta.sections.map((s) => s.kind)).toEqual(['note', 'attachment', 'annotation'])
    expect(meta.sections[2]!.rows[0]).toEqual({
      kind: 'annotation',
      ref: 'zotero://user/0/annotation/ANN1',
      type: 'highlight',
      text: 'hit',
      color: '#ffd400',
      pageLabel: '3',
      parentRef: 'zotero://user/0/attachment/A1',
    })
  })

  it('omits a kind the call did not ask for, and keeps an empty one', () => {
    const meta = childrenMetaOf({ notes: { total: 0, returned: 0, items: [] } })
    expect(meta.sections.map((s) => s.kind)).toEqual(['note'])
    // "No notes exist" is a finding; dropping the section would read as
    // "notes were not requested".
    expect(meta.sections[0]!.rows).toEqual([])
  })

  it('drops a row missing the field that identifies it', () => {
    const meta = childrenMetaOf({
      notes: {
        total: 2,
        returned: 2,
        items: [{ ref: 'zotero://user/0/note/N1' }, { ref: 'N2', text: 'ok' }],
      },
      annotations: {
        total: 1,
        returned: 1,
        items: [{ ref: 'zotero://user/0/annotation/A1', text: 'no type' }],
      },
    })
    expect(meta.sections[0]!.rows).toEqual([{ kind: 'note', ref: 'N2', text: 'ok' }])
    expect(meta.sections[1]!.rows).toEqual([])
  })

  it('nulls an annotation colour the projection left blank', () => {
    // The hex guard that decides whether a swatch renders at all lives in the
    // view; this only pins that a blank colour never reaches it as a value.
    const row = (color: unknown) =>
      childrenMetaOf({
        annotations: {
          total: 1,
          returned: 1,
          items: [{ ref: 'A1', type: 'highlight', text: 't', color }],
        },
      }).sections[0]!.rows[0]
    expect(row('')).toMatchObject({ color: null })
    expect(row(undefined)).toMatchObject({ color: null })
    // An unparseable colour is carried through for the view to reject, rather
    // than being second-guessed here.
    expect(row('not-a-colour')).toMatchObject({ color: 'not-a-colour' })
  })
})

describe('jobArmOf', () => {
  it('reads both job arms with the id the reader needs to collect the result', () => {
    // `zotero_export` and `zotero_changes` can both be handed to a background
    // job, so the arm is read once for both cards rather than spelled twice.
    expect(jobArmOf({ kind: 'background', jobId: 'job-7' })).toEqual({
      kind: 'background',
      jobId: 'job-7',
    })
    expect(jobArmOf({ kind: 'promoted', jobId: 'job-8', timeoutMs: 60_000 })).toEqual({
      kind: 'promoted',
      jobId: 'job-8',
    })
  })

  it('reads a call that ran inline as having no job arm', () => {
    for (const meta of [{}, { kind: 'applied' }, { kind: 'background' }, { jobId: 'job-7' }]) {
      expect(jobArmOf(meta)).toBeNull()
    }
  })
})

describe('attachmentMetaOf', () => {
  it('decodes the file arm with its ref', () => {
    const meta = attachmentMetaOf({
      kind: 'file',
      title: 'a.pdf',
      contentType: 'application/pdf',
      ref: 'zotero://user/0/attachment/WXYZ6789',
      path: '/tmp/a.pdf',
    })
    expect(meta.kind).toBe('file')
    expect(meta.location).toBe('/tmp/a.pdf')
    expect(meta.ref).toBe('zotero://user/0/attachment/WXYZ6789')
  })

  it('decodes the url arm and a record without a ref', () => {
    expect(
      attachmentMetaOf({ kind: 'url', title: 'p', contentType: 'text/html', url: 'https://e.org' }),
    ).toEqual({
      kind: 'url',
      title: 'p',
      contentType: 'text/html',
      location: 'https://e.org',
      ref: null,
    })
  })

  it('degrades an unknown kind to null fields', () => {
    const meta = attachmentMetaOf({ kind: 'other', contentType: 'application/pdf' })
    expect(meta.kind).toBeNull()
    expect(meta.location).toBeNull()
  })

  it('nulls the location when the arm field is missing', () => {
    const meta = attachmentMetaOf({ kind: 'file', contentType: 'application/pdf' })
    expect(meta.kind).toBe('file')
    expect(meta.title).toBeNull()
    expect(meta.location).toBeNull()
    expect(meta.ref).toBeNull()
  })

  it('nulls an absent content type', () => {
    const meta = attachmentMetaOf({ kind: 'url' })
    expect(meta.contentType).toBeNull()
  })
})

describe('exportMetaOf', () => {
  it('reads the bounded refs', () => {
    const meta = exportMetaOf({
      format: 'bibtex',
      style: 'apa',
      locale: 'en-US',
      refs: ['zotero://user/0/item/AAAAAAA1'],
      refsOmitted: 2,
    })
    expect(meta.format).toBe('bibtex')
    expect(meta.style).toBe('apa')
    expect(meta.locale).toBe('en-US')
    expect(meta.refs).toEqual(['zotero://user/0/item/AAAAAAA1'])
    expect(meta.refsOmitted).toBe(2)
  })

  it('treats a ref-less record as itemizing none', () => {
    const meta = exportMetaOf({ format: 'bibtex' })
    expect(meta.refs).toEqual([])
    expect(meta.refsOmitted).toBe(0)
  })

  it('nulls every absent fact', () => {
    expect(exportMetaOf({})).toEqual({
      format: null,
      style: null,
      locale: null,
      refs: [],
      refsOmitted: 0,
      items: [],
    })
  })

  it('decodes the bounded per-document items and drops malformed rows', () => {
    const meta = exportMetaOf({
      items: [
        {
          ref: 'zotero://user/0/item/AAAAAAA1',
          key: 'a1',
          title: 'Alpha',
          start: 0,
          end: 41,
        },
        { ref: 'zotero://user/0/item/AAAAAAA2', entryIndex: 1 },
        { ref: 'zotero://user/0/item/AAAAAAA4', start: 'x' },
        { key: 'no-ref' },
        'junk',
        { ref: 'zotero://user/0/item/AAAAAAA3', key: 7 },
      ],
    })
    expect(meta.items).toEqual([
      { ref: 'zotero://user/0/item/AAAAAAA1', key: 'a1', title: 'Alpha', start: 0, end: 41 },
      { ref: 'zotero://user/0/item/AAAAAAA2', entryIndex: 1 },
      { ref: 'zotero://user/0/item/AAAAAAA4' },
      { ref: 'zotero://user/0/item/AAAAAAA3' },
    ])
  })
})

describe('writeMetaOf', () => {
  it('reads the applied tag count an add_tags call reported', () => {
    expect(
      writeMetaOf({
        kind: 'applied',
        ref: 'zotero://user/0/item/AAAAAAA1',
        version: 4,
        addedCount: 2,
      }),
    ).toEqual({ kind: 'applied', addedCount: 2, added: null })
  })

  it('distinguishes an added membership from an already-a-member one', () => {
    const read = writeMetaOf({ kind: 'applied', version: 4, added: false })
    expect(read.added).toBe(false)
    expect(writeMetaOf({ kind: 'applied', version: 4, added: true }).added).toBe(true)
  })

  it('keeps an unverified commit distinguishable from an applied one', () => {
    // The unverified arm reports no applied fact, so a card reading a count off
    // it sees nothing rather than a stale one. Which *reason* it was is left to
    // the tool's own sentence, which the receipt shows verbatim.
    expect(
      writeMetaOf({ kind: 'committed-unverified', reason: 'commit-unknown', key: 'NOTE1234' }),
    ).toEqual({ kind: 'committed-unverified', addedCount: null, added: null })
  })

  it('reads a declined arm as carrying no applied fact', () => {
    expect(writeMetaOf({ kind: 'declined' })).toEqual({
      kind: 'declined',
      addedCount: null,
      added: null,
    })
  })

  it('reads an absent or malformed kind as applied with nothing applied proven', () => {
    // An unrecognized kind must never read as a success claim: the applied
    // fields stay null, so the card falls back to the tool's own text.
    for (const meta of [{}, { kind: 7 }, { kind: 'surprise' }]) {
      expect(writeMetaOf(meta)).toEqual({ kind: 'applied', addedCount: null, added: null })
    }
  })
})
