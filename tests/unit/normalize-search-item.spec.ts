/**
 * The compact search-hit projection `normalizeSearchItem` builds, plus the
 * whole-module contract that rides it: hostile input — null, an array, a
 * non-string item type — fails loud or degrades rather than throwing whatever
 * the shape happened to cause. That contract is a whole-module one, so it
 * stays its own describe rather than folding into a function's block. The
 * detail projection `normalizeItemDetail`, its relation map, and the
 * `extraFields` lossless-JSON gate live in `normalize-item-detail.spec.ts`.
 * @module tests/unit/normalize-search-item
 */

import { describe, expect, it } from 'vitest'
import { ZOTERO_UNEXPECTED, ZoteroError } from '../../src/errors.js'
import { fixtureJson } from '../helpers/fixtures-dir.js'
import { citekeyOf, normalizeSearchItem } from '../../src/normalize.js'
import { ctx, expectUnexpected } from './normalize-helpers.js'

/** One captured response body from `tests/fixtures/`. */
const fixture = fixtureJson

describe('normalizeSearchItem', () => {
  it('normalizes a full Zotero 10 item, including the best attachment link and server provenance', () => {
    const item = normalizeSearchItem(fixture('item10.json'), ctx('S1'))
    expect(item).toEqual({
      ref: 'zotero://user/0/item/ABCD1234?server=S1',
      title: 'FlashAttention-2: Faster Attention with Better Parallelism and Work Partitioning',
      creatorSummary: 'Dao, Tri',
      year: 2023,
      itemType: 'conferencePaper',
      bestAttachmentRef: 'zotero://user/0/attachment/WXYZ6789?server=S1',
      bestAttachmentType: 'application/pdf',
      attachmentSize: 1234567,
    })
  })

  it('omits the server qualifier when the instance reported none (pre-Zotero-10)', () => {
    const item = normalizeSearchItem(fixture('item-pre10.json'))
    expect(item.ref).toBe('zotero://user/0/item/EFGH5678')
    expect(item.bestAttachmentRef).toBeUndefined()
    expect(item.year).toBe(2017)
  })

  it('ignores unknown fields from future Zotero versions', () => {
    const item = normalizeSearchItem(fixture('item-extra-fields.json'), ctx('S2'))
    expect(item.ref).toBe('zotero://user/0/item/MNOP3456?server=S2')
    expect(item.title).toBe('A Forward-Tolerant Record')
    expect(item.year).toBe(2020)
  })

  it('tolerates missing optional fields', () => {
    const item = normalizeSearchItem(fixture('item-minimal.json'))
    expect(item).toEqual({
      ref: 'zotero://user/0/item/QRST7890',
      title: '',
      creatorSummary: '',
      year: undefined,
      itemType: 'webpage',
      bestAttachmentRef: undefined,
      bestAttachmentType: undefined,
      attachmentSize: undefined,
    })
  })

  it('omits the year when parsedDate does not start with four digits', () => {
    const item = normalizeSearchItem({
      key: 'ABCD1234',
      meta: { parsedDate: 'n/a' },
      data: { itemType: 'book', title: 'Undated' },
    })
    expect(item.year).toBeUndefined()
    expect(item.title).toBe('Undated')
  })

  it('falls back to the top-level itemType when data.itemType is absent', () => {
    const item = normalizeSearchItem({
      key: 'ABCD1234',
      itemType: 'book',
      data: { title: 'Top Level Type' },
    })
    expect(item.itemType).toBe('book')
  })

  it('falls back to the top-level itemType when the data block is missing entirely', () => {
    const item = normalizeSearchItem({ key: 'ABCD1234', itemType: 'book' })
    expect(item.itemType).toBe('book')
  })

  it('carries the parent ref for child notes', () => {
    const item = normalizeSearchItem(
      { key: 'NOTE1111', data: { itemType: 'note', title: '', parentItem: 'ABCD1234' } },
      ctx('S1'),
    )
    expect(item.parentRef).toBe('zotero://user/0/item/ABCD1234?server=S1')
    expect(
      normalizeSearchItem({ key: 'ABCD1234', data: { itemType: 'book' } }).parentRef,
    ).toBeUndefined()
  })

  it('synthesizes a note title from the first body line when the title is empty', () => {
    const item = normalizeSearchItem({
      key: 'NOTE1111',
      data: { itemType: 'note', title: '', note: '<p>论文概述</p><p>second line</p>' },
    })
    expect(item.title).toBe('论文概述')
  })

  it('falls back to an untitled marker for notes without any body', () => {
    const item = normalizeSearchItem({ key: 'NOTE1111', data: { itemType: 'note', title: '' } })
    expect(item.title).toBe('(untitled note)')
  })

  it('keeps an explicit note title when Zotero reports one', () => {
    const item = normalizeSearchItem({
      key: 'NOTE1111',
      data: { itemType: 'note', title: 'Real title', note: 'body' },
    })
    expect(item.title).toBe('Real title')
  })

  it('yields an empty itemType when neither level declares one', () => {
    const item = normalizeSearchItem({ key: 'ABCD1234' })
    expect(item.itemType).toBe('')
  })

  it('fails loud when the key invariant is broken', () => {
    expectUnexpected(() => normalizeSearchItem({ key: 'nope', data: {} }))
    expectUnexpected(() => normalizeSearchItem({ data: { title: 'no key' } }))
    expectUnexpected(() => normalizeSearchItem(null))
  })

  it('builds a group ref for a hit in a group library', () => {
    const item = normalizeSearchItem(
      { key: 'ABCD1234', data: { itemType: 'book', title: 'T' } },
      { library: { type: 'group', id: 42 }, serverId: 'S1' },
    )
    expect(item.ref).toBe('zotero://group/42/item/ABCD1234?server=S1')
  })
})

describe('normalization of hostile inputs', () => {
  it('fails loud on null and array item JSON', () => {
    for (const input of [null, []]) {
      let thrown: unknown
      try {
        normalizeSearchItem(input)
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(ZoteroError)
      expect((thrown as ZoteroError).code).toBe(ZOTERO_UNEXPECTED)
    }
  })

  it('tolerates non-string item types in search hits', () => {
    expect(normalizeSearchItem({ key: 'ABCD1234', data: { itemType: 42 } }).itemType).toBe('')
  })
})

describe('citekeyOf — the one citation-key grammar', () => {
  it('reads the canonical line-start label', () => {
    expect(citekeyOf('Citation Key: dao2023flash\nDOI: 10.1/x')).toBe('dao2023flash')
  })

  it('accepts the lowercase alias and mid-line occurrences, as export alignment always has', () => {
    expect(citekeyOf('citekey: daoLower')).toBe('daoLower')
    expect(citekeyOf('see also citekey: daoInline, DOI on the next line')).toBe('daoInline')
  })

  it('takes the first token only: trailing prose on the same line is never the key', () => {
    expect(citekeyOf('Citation Key: keyWith trailing words')).toBe('keyWith')
  })

  it('does not read a label embedded inside another word', () => {
    expect(citekeyOf('notcitekey: bogus')).toBeUndefined()
    expect(citekeyOf('prefixCitation Key: bogus')).toBeUndefined()
  })

  it('returns undefined for absent, empty, and labelless extra text', () => {
    expect(citekeyOf(undefined)).toBeUndefined()
    expect(citekeyOf('')).toBeUndefined()
    expect(citekeyOf('arXiv: 2401.12345')).toBeUndefined()
  })
})
