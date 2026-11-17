import { filterSources } from '../../../src/sources/filters.ts'
/** Broadcast size is independent of evidence and export body sizes. */
import { expect, it } from 'vitest'
import { createSourceWireView } from '../../../src/sources/window.ts'
import { sourceWorkspaceSchema } from '../../../src/sources/workspace-schema.ts'
import { sourceOf, workspaceOf, passageOf, artifactOf } from '../helpers/source-fixtures.ts'

it('broadcasts exact summaries for a 200 × 50 trail without any body rows', () => {
  const sources = Array.from({ length: 200 }, (_, index) =>
    sourceOf({
      key: `source-${index}`,
      ref: `zotero://user/0/item/K${String(index).padStart(7, '0')}`,
      title: `Paper ${index}`,
      evidenceTotal: 50,
      evidence: Array.from({ length: 50 }, () => passageOf({ text: 'x'.repeat(750) })),
      exports: [artifactOf({ text: 'y'.repeat(100_000) })],
      exportsTotal: 1,
    }),
  )
  const full = workspaceOf(sources, {
    exports: [artifactOf({ text: 'z'.repeat(1_000_000) })],
    exportTotal: 1,
  })
  const wire = createSourceWireView()(full, 42)
  expect(sourceWorkspaceSchema.safeParse(wire).success).toBe(true)
  expect(wire.detailsRevision).toBe(42)
  expect(wire.sources).toHaveLength(200)
  expect(
    wire.sources.every(
      (source) =>
        source.evidence.length === 0 &&
        source.exports.length === 0 &&
        source.searches.length === 0 &&
        source.fulltextReads.length === 0,
    ),
  ).toBe(true)
  expect(
    wire.sources.every((source) => source.evidenceTotal === 50 && source.exportsTotal === 1),
  ).toBe(true)
  expect(filterSources(wire.sources, 'evidence')).toHaveLength(200)
  expect(filterSources(wire.sources, 'exported')).toHaveLength(200)
  expect(wire.exports).toEqual([])
  expect(wire.exportTotal).toBe(1)
  expect(new TextEncoder().encode(JSON.stringify(wire)).byteLength).toBeLessThan(128_000)
  expect(JSON.stringify(full).length).toBeGreaterThan(7_500_000)
  expect(full.sources[0]?.evidence).toHaveLength(50)
  expect(full.exports[0]?.text.length).toBe(1_000_000)
})

it('reuses unchanged broadcast summaries and invalidates the changed source only', () => {
  const project = createSourceWireView()
  const first = sourceOf({ key: 'one' }),
    second = sourceOf({ key: 'two' })
  const full = workspaceOf([first, second])
  const wire = project(full, 1)
  expect(project(full, 1)).toBe(wire)
  const next = project(workspaceOf([first, { ...second, title: 'Changed' }]), 2)
  expect(next.sources[0]).toBe(wire.sources[0])
  expect(next.sources[1]).not.toBe(wire.sources[1])
  expect(next.detailsRevision).toBe(2)
})
