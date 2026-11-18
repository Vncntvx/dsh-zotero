import { describe, expect, it } from 'vitest'
import { getBatchMetaOf, matchReferencesMetaOf } from '../../../src/sources/decoders.js'

describe('getBatchMetaOf', () => {
  it('keys rows by ref and keeps only complete facts', () => {
    const view = getBatchMetaOf(
      {
        items: [
          {
            ref: 'zotero://user/0/item/AAAAAAA1',
            status: 'ok',
            title: 'Alpha',
            creators: 'Dao, Tri',
            venue: 'Journal of Tests',
            year: 2024,
            bestAttachmentRef: 'zotero://user/0/attachment/PDF000001',
            bestAttachmentType: 'application/pdf',
          },
          { ref: 'zotero://user/0/item/AAAAAAA2', status: 'error', code: 'ZOTERO_NOT_FOUND' },
          { title: 'no ref' },
          'junk',
        ],
      },
      [],
    )
    expect(view.rows?.get('zotero://user/0/item/AAAAAAA1')).toEqual({
      ref: 'zotero://user/0/item/AAAAAAA1',
      status: 'ok',
      title: 'Alpha',
      creators: 'Dao, Tri',
      venue: 'Journal of Tests',
      year: 2024,
      bestAttachmentRef: 'zotero://user/0/attachment/PDF000001',
      bestAttachmentType: 'application/pdf',
    })
    expect(view.rows?.get('zotero://user/0/item/AAAAAAA2')).toEqual({
      ref: 'zotero://user/0/item/AAAAAAA2',
      code: 'ZOTERO_NOT_FOUND',
      status: 'error',
      title: null,
      creators: null,
      venue: null,
      year: null,
      bestAttachmentRef: null,
      bestAttachmentType: null,
    })
    // A row without its ref names nothing the fold can attribute.
    expect(view.rows?.size).toBe(2)
    expect(view.attributedRefs).toEqual([
      'zotero://user/0/item/AAAAAAA1',
      'zotero://user/0/item/AAAAAAA2',
    ])
  })

  it('joins the statuses vector onto the request refs only when they match one-to-one', () => {
    const refs = ['zotero://user/0/item/AAAAAAA1', 'zotero://user/0/item/AAAAAAA2']
    const joined = getBatchMetaOf({ items: [], statuses: ['ok', 'error'] }, refs)
    expect(joined.outcomes.get(refs[0]!)).toBe('ok')
    expect(joined.outcomes.get(refs[1]!)).toBe('error')
    expect(joined.attributedRefs).toEqual(refs)
    // A vector that does not match the request says nothing per ref.
    const mismatched = getBatchMetaOf({ items: [], statuses: ['ok'] }, refs)
    expect(mismatched.outcomes.size).toBe(0)
    expect(mismatched.attributedRefs).toEqual(refs)
  })

  it('degrades a malformed items array to null rows', () => {
    const view = getBatchMetaOf({ items: 'junk' }, [])
    expect(view.rows).toBeNull()
    expect(view.attributedRefs).toEqual([])
  })
})

describe('matchReferencesMetaOf', () => {
  it('decodes selected and candidate lists, dropping candidates without ref or title', () => {
    const view = matchReferencesMetaOf({
      items: [
        {
          inputId: 'a',
          status: 'matched',
          selected: {
            ref: 'zotero://user/0/item/AAAAAAA1',
            title: 'Alpha',
            authors: ['Tri Dao', 7],
            venue: 'Journal of Tests',
            year: 2024,
          },
        },
        {
          inputId: 'b',
          status: 'ambiguous',
          candidates: [
            { ref: 'zotero://user/0/item/AAAAAAA2', title: 'Beta' },
            { title: 'no ref' },
            'junk',
          ],
        },
        'junk',
      ],
    })
    expect(view.items).toEqual([
      {
        inputId: 'a',
        status: 'matched',
        selected: [
          {
            ref: 'zotero://user/0/item/AAAAAAA1',
            title: 'Alpha',
            authors: ['Tri Dao'],
            venue: 'Journal of Tests',
            year: 2024,
          },
        ],
        candidates: [],
      },
      {
        inputId: 'b',
        status: 'ambiguous',
        selected: [],
        candidates: [
          {
            ref: 'zotero://user/0/item/AAAAAAA2',
            title: 'Beta',
            authors: [],
            venue: null,
            year: null,
          },
        ],
      },
    ])
  })

  it('degrades a malformed items array to null', () => {
    expect(matchReferencesMetaOf({ items: 'junk' }).items).toBeNull()
    expect(matchReferencesMetaOf({}).items).toBeNull()
  })
})
