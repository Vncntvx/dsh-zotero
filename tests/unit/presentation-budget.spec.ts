/**
 * The shared UTF-8 byte budget every card projection passes through: what it
 * measures, what it drops on overflow, and the per-tool pages whose card
 * depends on which keys survive.
 *
 * Split out of `presentation-meta.spec.ts` along its own seam: the budget is
 * one mechanism shared by every projector, not a property of any one of them,
 * and that split is what keeps the projector spec under the size ratchet.
 * @module tests/unit/presentation-budget
 */

import { describe, expect, it } from 'vitest'
import {
  MAX_PRESENTATION_META_BYTES,
  boundedPresentationMeta,
  presentationMetaBytes,
  projectExportMeta,
} from '../../src/presentation-meta.js'

describe('boundedPresentationMeta', () => {
  it('passes non-object inputs through untouched', () => {
    expect(boundedPresentationMeta(null, ['items'])).toBeNull()
    expect(boundedPresentationMeta('plain', ['items'])).toBe('plain')
    expect(boundedPresentationMeta([1], ['items'])).toEqual([1])
  })

  it('keeps a projection inside the byte budget unchanged', () => {
    const meta = { count: 1, items: [] }
    expect(boundedPresentationMeta(meta, ['items'])).toEqual(meta)
  })

  it('measures UTF-8 bytes, not code units', () => {
    // 3000 中文字符 = 9000 UTF-8 bytes but only 3000 code units.
    const meta = { count: 1, items: [{ preview: '批'.repeat(3000) }] }
    expect(presentationMetaBytes(meta)).toBeGreaterThan(MAX_PRESENTATION_META_BYTES)
  })

  it('drops exactly the detail keys on overflow and records detailOmitted', () => {
    const filler = 'x'.repeat(MAX_PRESENTATION_META_BYTES)
    const meta = {
      count: 3,
      title: 'kept',
      items: [{ preview: filler }],
      notesPreview: [{ preview: filler }],
    }
    const bounded = boundedPresentationMeta(meta, ['items', 'notesPreview'])
    expect(bounded).toEqual({ detailOmitted: true, count: 3, title: 'kept' })
  })

  it('drops the export items and refs wholesale when the projection overflows', () => {
    const filler = 'x'.repeat(MAX_PRESENTATION_META_BYTES)
    const meta = projectExportMeta(
      {
        format: 'bibtex',
        text: 'raw',
        items: [{ ref: 'zotero://user/0/item/AAAAAAA1', key: 'a1', title: filler, start: 0 }],
      },
      ['zotero://user/0/item/AAAAAAA1'],
    )
    const bounded = boundedPresentationMeta(meta, ['refs', 'items'])
    expect(bounded).toEqual({ detailOmitted: true, format: 'bibtex', requested: 1, refsOmitted: 0 })
  })

  it('honors the byte budget at the exact boundary', () => {
    // Size the payload against the measured envelope so the fit is exact.
    const envelope = Buffer.byteLength(JSON.stringify({ count: 1, title: '' }), 'utf8')
    const slack = MAX_PRESENTATION_META_BYTES - envelope
    const exact = { count: 1, title: 't'.repeat(slack) }
    expect(presentationMetaBytes(exact)).toBe(MAX_PRESENTATION_META_BYTES)
    expect(boundedPresentationMeta(exact, [])).toEqual(exact)
    const over = { count: 1, title: 't'.repeat(slack + 1) }
    // No detail keys were declared, so the overflow keeps every fact and only records the flag.
    expect(boundedPresentationMeta(over, [])).toEqual({ detailOmitted: true, ...over })
  })
})

describe('a browse page through the budget', () => {
  // `zotero_browse` has no projector of its own: it hands its whole output to
  // the budget with `items` as the one droppable detail key, because the Chat
  // card reads the page facts and the rows from the same record.
  function heavyBrowsePage(): Record<string, unknown> {
    return {
      kind: 'collections',
      total: 5000,
      offset: 0,
      returned: 20,
      nextOffset: 20,
      items: Array.from({ length: 20 }, (_, index) => ({
        ref: `zotero://user/0/collection/${String(index).padStart(8, '0')}`,
        name: 'A very long collection name '.repeat(20),
        path: ['Root', 'A very long collection name '.repeat(20)],
        depth: 1,
      })),
    }
  }

  it('drops the rows of an over-budget page and keeps every page fact', () => {
    // The card states an exact count from `kind`/`returned`/`total`, so this
    // invariant is pinned here rather than assumed in a client comment.
    const page = heavyBrowsePage()
    expect(presentationMetaBytes(page as never)).toBeGreaterThan(MAX_PRESENTATION_META_BYTES)

    const reduced = boundedPresentationMeta(page, ['items']) as Record<string, unknown>
    expect(reduced['detailOmitted']).toBe(true)
    expect(reduced['items']).toBeUndefined()
    expect(reduced['kind']).toBe('collections')
    expect(reduced['returned']).toBe(20)
    expect(reduced['total']).toBe(5000)
    expect(reduced['nextOffset']).toBe(20)
  })

  it('leaves an ordinary page whole', () => {
    const page = {
      kind: 'collections',
      total: 2,
      offset: 0,
      returned: 2,
      items: [{ ref: 'r1', name: 'Reading', path: ['Reading'], depth: 0 }],
    }
    expect(boundedPresentationMeta(page, ['items'])).toBe(page)
  })
})
