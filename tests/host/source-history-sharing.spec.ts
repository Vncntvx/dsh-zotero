/** Search continuation changes one history list without copying unrelated histories. */
import { expect, it } from 'vitest'
import { SourceWorkspaceIndex } from '../../src/sources/ledger.js'
import { REF, searchMetaOf, settledBlock } from './support/source-ledger-arms.js'

it('shares evidence, fulltext windows, exports and older search occurrences across continuation pages', () => {
  const ref = REF('AAAA1111')
  const index = new SourceWorkspaceIndex()
  let seq = 0
  const fold = (name: string, args: Record<string, unknown>, meta: unknown, text?: string) =>
    index.apply(
      settledBlock(`c${seq}`, name, args, meta, seq++, text ? [{ type: 'text', text }] : []),
    )
  fold('zotero_search', { query: 'older' }, searchMetaOf([{ ref }]))
  fold(
    'zotero_retrieve',
    { ref, query: 'evidence' },
    {
      kind: 'evidence',
      count: 1,
      displayed: 1,
      omitted: 0,
      items: [
        {
          source: 'fulltext',
          sourceRef: ref,
          preview: 'A preserved passage',
          previewTruncated: false,
        },
      ],
    },
  )
  fold(
    'zotero_export',
    { refs: [ref], format: 'ris' },
    { delivery: 'inline', format: 'ris', refs: [ref], refsOmitted: 0 },
    'TY  - JOUR\nTI  - Paper\nER  -',
  )
  fold('zotero_search', { query: 'current', offset: 0 }, { ...searchMetaOf([{ ref }]), total: 2 })
  const before = index.workspace([], { windowed: false }).sources[0]!
  fold('zotero_search', { query: 'current', offset: 1 }, searchMetaOf([{ ref: REF('BBBB2222') }]))
  const after = index.workspace([], { windowed: false }).sources[0]!
  expect(after.searches).not.toBe(before.searches)
  expect(after.searches[0]).toBe(before.searches[0])
  expect(after.searches[1]?.returned).toBe(2)
  expect(before.searches[1]?.returned).toBe(1)
  expect(after.evidence).toBe(before.evidence)
  expect(after.evidence[0]?.text).toBe('A preserved passage')
  expect(after.fulltextReads).toBe(before.fulltextReads)
  expect(after.exports).toBe(before.exports)
  expect(after.exports).toHaveLength(1)
  const qualified = index.workspace([], { windowed: false, currentServerId: 'S2' }).sources[0]!
  expect(qualified.evidence).toBe(after.evidence)
  expect(qualified.exports).toBe(after.exports)
})

it('copies changed evidence once and leaves previously published call attribution intact', () => {
  const ref = REF('AAAA1111')
  const index = new SourceWorkspaceIndex()
  const meta = {
    kind: 'evidence',
    count: 1,
    displayed: 1,
    omitted: 0,
    items: [
      { source: 'fulltext', sourceRef: ref, preview: 'Repeated passage', previewTruncated: false },
    ],
  }
  index.apply(settledBlock('r1', 'zotero_retrieve', { ref, query: 'one' }, meta, 1))
  const before = index.workspace([], { windowed: false }).sources[0]!
  index.apply(settledBlock('r2', 'zotero_retrieve', { ref, query: 'two' }, meta, 2))
  const after = index.workspace([], { windowed: false }).sources[0]!
  expect(after.evidence).not.toBe(before.evidence)
  expect(before.evidence[0]?.callIds).toEqual(['r1'])
  expect(after.evidence[0]?.callIds).toEqual(['r1', 'r2'])
  expect(after.searches).toBe(before.searches)
})
