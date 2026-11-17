/** Card limits never change the canonical page or its continuation. */
import { describe, expect, it } from 'vitest'
import {
  boundedPresentationMeta,
  MAX_PRESENTATION_BROWSE_ROWS,
  MAX_PRESENTATION_BROWSE_ROWS_BYTES,
  MAX_PRESENTATION_META_BYTES,
  presentationMetaBytes,
  projectBrowseMeta,
} from '../../src/presentation-meta.js'
import type { ZoteroBrowseResult } from '../../src/types.js'

function page(depth = 1, width = 16): ZoteroBrowseResult {
  return {
    kind: 'collections',
    total: 100,
    offset: 0,
    returned: 50,
    nextOffset: 50,
    items: Array.from({ length: 50 }, (_, index) => ({
      ref: `zotero://user/0/collection/COLL${String(index).padStart(4, '0')}`,
      name: `Collection ${index}`,
      depth: depth - 1,
      path: Array.from({ length: depth }, (_, level) => `${level}-${index}-${'文'.repeat(width)}`),
    })),
  }
}

describe('browse presentation', () => {
  it('caps a complete page at twenty rows and preserves the actual next page', () => {
    const source = page()
    const meta = projectBrowseMeta(source)
    expect(meta.items).toEqual(source.items.slice(0, MAX_PRESENTATION_BROWSE_ROWS))
    expect(meta).toMatchObject({
      total: 100,
      returned: 50,
      offset: 0,
      nextOffset: 50,
      displayed: 20,
      omitted: 30,
    })
    expect(source.items).toHaveLength(50)
  })

  it('keeps a prefix of complete deep breadcrumbs within the byte budget', () => {
    const source = page(8, 60)
    const before = JSON.stringify(source)
    const meta = projectBrowseMeta(source)
    expect(meta.displayed).toBeGreaterThan(0)
    expect(meta.displayed).toBeLessThan(MAX_PRESENTATION_BROWSE_ROWS)
    expect(meta.items).toEqual(source.items.slice(0, meta.displayed))
    expect(presentationMetaBytes(meta.items)).toBeLessThanOrEqual(
      MAX_PRESENTATION_BROWSE_ROWS_BYTES,
    )
    expect(presentationMetaBytes(meta)).toBeLessThanOrEqual(MAX_PRESENTATION_META_BYTES)
    expect(boundedPresentationMeta(meta, ['items'])).not.toHaveProperty('detailOmitted')
    expect(meta.omitted).toBe(50 - meta.displayed)
    expect(JSON.stringify(source)).toBe(before)
  })

  it('reports an oversized first row as omitted rather than an empty page', () => {
    const meta = projectBrowseMeta(page(1, 10_000))
    expect(meta).toMatchObject({
      items: [],
      displayed: 0,
      returned: 50,
      omitted: 50,
      nextOffset: 50,
    })
    expect(presentationMetaBytes(meta)).toBeLessThan(MAX_PRESENTATION_META_BYTES)
  })

  it('keeps an actually empty page empty without reporting omitted rows', () => {
    expect(
      projectBrowseMeta({ kind: 'tags', items: [], total: 0, returned: 0, offset: 0 }),
    ).toMatchObject({ items: [], displayed: 0, omitted: 0 })
  })
})
