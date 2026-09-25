/**
 * Child-level projection specs: `extractAttachmentKey` (from
 * `src/attachments.ts`), and `normalizeNoteRecord`, `plainNoteText`,
 * `normalizeAnnotationRecord`, and `partitionChildren` from `src/normalize.ts`.
 * @module tests/unit/normalize-children
 */

import { describe, expect, it } from 'vitest'
import { ZOTERO_UNEXPECTED } from '../../src/errors.js'
import { extractAttachmentKey } from '../../src/attachments.js'
import {
  normalizeAnnotationRecord,
  normalizeNoteRecord,
  partitionChildren,
  plainNoteText,
  type ZoteroChildKind,
} from '../../src/normalize.js'
import { ctx, expectUnexpected } from './normalize-helpers.js'

describe('extractAttachmentKey', () => {
  it('extracts an 8-character key from an attachment href', () => {
    expect(extractAttachmentKey('http://localhost:23119/api/users/0/items/WXYZ6789')).toBe(
      'WXYZ6789',
    )
    expect(extractAttachmentKey('https://api.zotero.org/users/1/items/WXYZ6789?format=json')).toBe(
      'WXYZ6789',
    )
  })

  it('returns undefined when no key is present', () => {
    expect(
      extractAttachmentKey('http://localhost:23119/api/users/0/items/not-a-key'),
    ).toBeUndefined()
    expect(extractAttachmentKey(undefined)).toBeUndefined()
  })
})

describe('normalizeNoteRecord', () => {
  it('normalizes a note child with truncation budget', () => {
    const row = { key: 'NOTE1111', data: { itemType: 'note', note: 'hello world' } }
    expect(normalizeNoteRecord(row, ctx('S1'), 5)).toEqual({
      ref: 'zotero://user/0/item/NOTE1111?server=S1',
      text: 'hello',
      truncated: true,
    })
  })

  it('tolerates a missing note body', () => {
    expect(
      normalizeNoteRecord({ key: 'NOTE1111', data: { itemType: 'note' } }, undefined, 100),
    ).toEqual({ ref: 'zotero://user/0/item/NOTE1111', text: '', truncated: false })
  })

  it('strips HTML and carries the parent ref when reported', () => {
    const row = {
      key: 'NOTE1111',
      data: { itemType: 'note', note: '<p>First</p><p>Second</p>', parentItem: 'ABCD1234' },
    }
    expect(normalizeNoteRecord(row, ctx('S1'), 100)).toEqual({
      ref: 'zotero://user/0/item/NOTE1111?server=S1',
      text: 'First\nSecond',
      truncated: false,
      parentRef: 'zotero://user/0/item/ABCD1234?server=S1',
    })
  })

  it('keeps the full body when no budget is given', () => {
    const row = { key: 'NOTE1111', data: { itemType: 'note', note: 'word word word' } }
    expect(normalizeNoteRecord(row, undefined)).toEqual({
      ref: 'zotero://user/0/item/NOTE1111',
      text: 'word word word',
      truncated: false,
    })
  })

  it('ignores malformed parent keys', () => {
    const row = { key: 'NOTE1111', data: { itemType: 'note', note: 'x', parentItem: 'nope!!' } }
    expect(normalizeNoteRecord(row, undefined, 10).parentRef).toBeUndefined()
  })
})

describe('plainNoteText', () => {
  it('strips tags, turns block ends into newlines, and decodes entities', () => {
    expect(plainNoteText('<p>A &amp; B</p><p>C&nbsp;D<br/>E</p>')).toBe('A & B\nC D\nE')
  })

  it('returns an empty string for non-string or empty input', () => {
    expect(plainNoteText(undefined)).toBe('')
    expect(plainNoteText(42)).toBe('')
    expect(plainNoteText('<p></p>')).toBe('')
  })

  it('does not double-decode entities in a single pass', () => {
    expect(plainNoteText('<p>&amp;lt; &amp;gt; &amp;amp; &quot; &#39; &apos;</p>')).toBe(
      "&lt; &gt; &amp; \" ' '",
    )
  })
})

describe('normalizeAnnotationRecord', () => {
  it('normalizes an annotation child and omits empty optionals', () => {
    const row = {
      key: 'ANNO1111',
      data: {
        itemType: 'annotation',
        annotationType: 'highlight',
        annotationText: 'the key insight',
        annotationComment: 'check this',
        annotationColor: '#ffd400',
        annotationPageLabel: '7',
        annotationSortIndex: '00003',
        annotationPosition: '{"pageIndex":6}',
        parentItem: 'WXYZ6789',
      },
    }
    expect(normalizeAnnotationRecord(row, ctx('S1'))).toEqual({
      ref: 'zotero://user/0/annotation/ANNO1111?server=S1',
      type: 'highlight',
      text: 'the key insight',
      comment: 'check this',
      color: '#ffd400',
      pageLabel: '7',
      parentRef: 'zotero://user/0/attachment/WXYZ6789?server=S1',
    })
  })

  it('tolerates image annotations without annotationText', () => {
    expect(
      normalizeAnnotationRecord(
        { key: 'ANNO2222', data: { itemType: 'annotation', annotationType: 'image' } },
        undefined,
      ),
    ).toEqual({
      ref: 'zotero://user/0/annotation/ANNO2222',
      type: 'image',
      text: '',
      comment: undefined,
      color: undefined,
      pageLabel: undefined,
    })
  })

  it('keeps empty-string optionals distinct from absent ones', () => {
    // Zotero reports an empty annotationComment/annotationColor as '' rather
    // than omitting the field; the record stays lossless by carrying them.
    expect(
      normalizeAnnotationRecord(
        {
          key: 'ANNO3333',
          data: {
            itemType: 'annotation',
            annotationType: 'highlight',
            annotationText: 'x',
            annotationComment: '',
            annotationColor: '',
          },
        },
        undefined,
      ),
    ).toEqual({
      ref: 'zotero://user/0/annotation/ANNO3333',
      type: 'highlight',
      text: 'x',
      comment: '',
      color: '',
    })
  })

  it('fails loud on an annotation without a valid key', () => {
    const error = expectUnexpected(() =>
      normalizeAnnotationRecord({ data: { annotationText: 'x' } }),
    )
    expect(error.code).toBe(ZOTERO_UNEXPECTED)
  })

  it('defaults a missing annotation type to an empty string', () => {
    expect(
      normalizeAnnotationRecord({ key: 'ANNO1111', data: { itemType: 'annotation' } }),
    ).toEqual({ ref: 'zotero://user/0/annotation/ANNO1111', type: '', text: '' })
  })
})

describe('partitionChildren', () => {
  it('partitions children into notes, annotations, and attachments', () => {
    const rows = [
      { key: 'NOTE1111', data: { itemType: 'note', note: 'n' } },
      {
        key: 'ANNO1111',
        data: { itemType: 'annotation', annotationType: 'highlight', annotationText: 'a' },
      },
      {
        key: 'WXYZ6789',
        data: {
          itemType: 'attachment',
          title: 'p',
          contentType: 'application/pdf',
          linkMode: 'imported_file',
        },
      },
      { key: 'AAAA1111', data: { itemType: 'note', note: 'n2' } },
    ]
    const partitioned = partitionChildren(rows, ctx('S1'), 100)
    expect(partitioned.notes).toHaveLength(2)
    expect(partitioned.annotations).toHaveLength(1)
    expect(partitioned.attachments).toHaveLength(1)
    expect(partitioned.attachments[0]).toEqual({
      key: 'WXYZ6789',
      title: 'p',
      contentType: 'application/pdf',
      linkMode: 'imported_file',
    })
    expect(partitioned.notes[0]!.text).toBe('n')
  })

  it('sorts annotations by their Zotero sort index', () => {
    const rows = [
      {
        key: 'ANNO2222',
        data: {
          itemType: 'annotation',
          annotationType: 'highlight',
          annotationText: 'second',
          annotationSortIndex: '00002',
        },
      },
      {
        key: 'ANNO1111',
        data: {
          itemType: 'annotation',
          annotationType: 'highlight',
          annotationText: 'first',
          annotationSortIndex: '00001',
        },
      },
    ]
    expect(
      partitionChildren(rows, undefined, 100).annotations.map((annotation) => annotation.text),
    ).toEqual(['first', 'second'])
  })

  it('fails loud on a child without a valid key', () => {
    expect(() => partitionChildren([{ data: { itemType: 'note' } }], undefined, 100)).toThrowError()
  })

  it('normalizes only the requested kinds', () => {
    const rows = [
      { key: 'NOTE1111', data: { itemType: 'note', note: '<p>body</p>' } },
      {
        key: 'ANNO1111',
        data: {
          itemType: 'annotation',
          annotationType: 'highlight',
          annotationText: 'a',
          annotationSortIndex: '00001',
        },
      },
      {
        key: 'WXYZ6789',
        data: { itemType: 'attachment', title: 'p', contentType: 'application/pdf' },
      },
    ]
    const partitioned = partitionChildren(
      rows,
      ctx('S1'),
      undefined,
      new Set<ZoteroChildKind>(['attachment']),
    )
    expect(partitioned.notes).toEqual([])
    expect(partitioned.annotations).toEqual([])
    expect(partitioned.attachments).toHaveLength(1)
  })

  it('skips malformed rows of unrequested kinds', () => {
    const malformed = [{ data: { itemType: 'note', note: 'body' } }]
    expect(
      partitionChildren(malformed, undefined, 100, new Set<ZoteroChildKind>(['attachment'])),
    ).toEqual({ notes: [], annotations: [], attachments: [] })
    expect(() =>
      partitionChildren(malformed, undefined, 100, new Set<ZoteroChildKind>(['note'])),
    ).toThrowError()
  })

  it('sorts annotations without a sort index first', () => {
    const rows = [
      {
        key: 'ANNO2222',
        data: {
          itemType: 'annotation',
          annotationType: 'highlight',
          annotationText: 'sorted',
          annotationSortIndex: '00002',
        },
      },
      {
        key: 'ANNO1111',
        data: { itemType: 'annotation', annotationType: 'highlight', annotationText: 'unsorted' },
      },
    ]
    const partitioned = partitionChildren(rows, undefined, 100)
    expect(partitioned.annotations.map((annotation) => annotation.ref)).toEqual([
      'zotero://user/0/annotation/ANNO1111',
      'zotero://user/0/annotation/ANNO2222',
    ])
  })

  it('skips non-object child rows', () => {
    const partitioned = partitionChildren(
      ['junk', { key: 'NOTE1111', data: { itemType: 'note', note: 'n' } }],
      undefined,
      100,
    )
    expect(partitioned.notes).toHaveLength(1)
    expect(partitioned.annotations).toHaveLength(0)
    expect(partitioned.attachments).toHaveLength(0)
  })
})
