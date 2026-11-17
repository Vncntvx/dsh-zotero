/** Export locations are complete spans at the domain, projection and wire boundaries. */
import { describe, expect, expectTypeOf, it } from 'vitest'
import { buildSourceWorkspace } from '../../src/sources/ledger.js'
import { sourceWorkspaceSchema } from '../../src/sources/workspace-schema.js'
import { exportMetaOf } from '../../src/sources/export-decoder.js'
import { projectExportMeta } from '../../src/presentation-meta.js'
import type { ZoteroExportItem } from '../../src/types.js'

const ref = 'zotero://user/0/item/AAAA1111'
const workspace = (item: unknown) => ({
  ...buildSourceWorkspace([]),
  exports: [
    {
      callId: 'export-1',
      format: 'bibtex',
      refs: [ref],
      refsOmitted: 0,
      text: 'abcdef',
      items: [item],
    },
  ],
  exportTotal: 1,
})

describe('export text location contract', () => {
  it('requires both offsets in the domain type', () => {
    expectTypeOf<{ ref: string; start: number }>().not.toExtend<ZoteroExportItem>()
    expectTypeOf<{ ref: string; end: number }>().not.toExtend<ZoteroExportItem>()
    expectTypeOf<{ ref: string; start: number; end: number }>().toExtend<ZoteroExportItem>()
    expect(sourceWorkspaceSchema.safeParse(workspace({ ref, start: 0, end: 6 })).success).toBe(true)
    expect(sourceWorkspaceSchema.safeParse(workspace({ ref })).success).toBe(true)
  })

  it.each([
    { start: 0 },
    { end: 6 },
    { start: -1, end: 6 },
    { start: 5, end: 2 },
    { start: 0, end: 0 },
    { start: 0.5, end: 6 },
  ])('rejects invalid wire and replay locations %j', (span) => {
    expect(sourceWorkspaceSchema.safeParse(workspace({ ref, ...span })).success).toBe(false)
    expect(exportMetaOf({ format: 'bibtex', items: [{ ref, ...span }] }).items).toEqual([])
  })

  it.each([{ start: 0 }, { end: 6 }])(
    'never emits a half-pair from an untyped projection input %j',
    (span) => {
      // Tool replay can be untyped; the public domain type prevents new typed producers doing this.
      const meta = Reflect.apply(projectExportMeta, undefined, [
        { format: 'bibtex', items: [{ ref, ...span }] },
        [ref],
      ])
      expect(meta.items).toEqual([{ ref }])
    },
  )

  it('preserves both located and unlocated export items across presentation and replay', () => {
    const items: ZoteroExportItem[] = [
      { ref, start: 0, end: 6 },
      { ref: 'zotero://user/0/item/BBBB2222', entryIndex: 1 },
    ]
    const meta = projectExportMeta(
      { format: 'bibtex', items },
      items.map((item) => item.ref),
    )
    expect(meta.items).toEqual(items)
    expect(exportMetaOf({ ...meta }).items).toEqual(items)
  })
})
