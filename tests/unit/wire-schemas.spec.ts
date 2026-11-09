/**
 * The wire boundary schemas' single-source pins: the panel's sort and export
 * enums and the updatable field set derive from `src/constants.ts`, and the
 * year interval is the shared closed range. A drift between constants and
 * schema fails here instead of at runtime.
 * @module tests/unit/wire-schemas
 */

import { describe, expect, it } from 'vitest'
import {
  ZOTERO_EXPORT_FORMATS,
  ZOTERO_SORT_FIELDS,
  ZOTERO_ITEMIZED_EXPORT_FORMATS,
  ZOTERO_UPDATABLE_ITEM_FIELDS,
  ZOTERO_YEAR_MAX,
  ZOTERO_YEAR_MIN,
  ZOTERO_SOURCE_WORKSPACE_MAX_SOURCES,
  ZOTERO_SOURCE_WORKSPACE_MAX_ITEM_ROWS,
} from '../../src/constants.js'
import {
  zoteroLibraryExportFormatSchema,
  zoteroLibrarySearchRequestSchema,
  zoteroLibrarySortSchema,
  zoteroLibraryItemizedExportFormatSchema,
  zoteroLibraryWriteRequestSchema,
  zoteroSourcePageResultSchema,
} from '../../src/wire-schemas.js'

const SESSION = { sessionId: 'test-session' }

describe('the panel wire schemas derive from the domain constants', () => {
  it('offers exactly the domain sort fields, in domain order', () => {
    expect(zoteroLibrarySortSchema.options).toEqual([...ZOTERO_SORT_FIELDS])
  })

  it('offers exactly the domain export formats, in domain order', () => {
    expect(zoteroLibraryExportFormatSchema.options).toEqual([...ZOTERO_EXPORT_FORMATS])
  })

  it('offers exactly the translator export formats, in domain order', () => {
    expect(zoteroLibraryItemizedExportFormatSchema.options).toEqual([
      ...ZOTERO_ITEMIZED_EXPORT_FORMATS,
    ])
  })

  it('accepts every updatable item field in an updateItem set', () => {
    for (const field of ZOTERO_UPDATABLE_ITEM_FIELDS) {
      expect(
        zoteroLibraryWriteRequestSchema.parse({
          ...SESSION,
          operation: 'updateItem',
          args: { ref: 'zotero://user/0/item/ABCD1234', set: { [field]: 'x' } },
        }),
      ).toBeTruthy()
    }
  })

  it('refuses a set field outside the updatable set', () => {
    expect(() =>
      zoteroLibraryWriteRequestSchema.parse({
        ...SESSION,
        operation: 'updateItem',
        args: { ref: 'zotero://user/0/item/ABCD1234', set: { notAnUpdatableField: 'x' } },
      }),
    ).toThrow()
  })

  it('bounds years to the shared closed interval', () => {
    const withYear = (year: number) => ({
      scope: { kind: 'library' },
      sort: 'title',
      direction: 'asc',
      offset: 0,
      limit: 50,
      yearFrom: year,
    })
    expect(zoteroLibrarySearchRequestSchema.parse(withYear(ZOTERO_YEAR_MIN))).toBeTruthy()
    expect(zoteroLibrarySearchRequestSchema.parse(withYear(ZOTERO_YEAR_MAX))).toBeTruthy()
    expect(() => zoteroLibrarySearchRequestSchema.parse(withYear(ZOTERO_YEAR_MIN - 1))).toThrow()
    expect(() => zoteroLibrarySearchRequestSchema.parse(withYear(ZOTERO_YEAR_MAX + 1))).toThrow()
  })

  it('validates bounded source page results and enforces row caps via refinement', () => {
    const minimalSource = (overrides = {}) => ({
      key: 'k-1',
      ref: 'zotero://user/0/item/ABCD1234',
      serverIds: ['s1'],
      evidenceMatch: 'verified' as const,
      facts: { reportedEvidenceCount: 0 },
      operations: { running: 0, failed: 0, stopped: 0 },
      searches: [],
      searchesTotal: 0,
      evidence: [],
      evidenceTotal: 0,
      exports: [],
      exportsTotal: 0,
      firstSeenAt: 1,
      lastTouchedAt: 1,
      ...overrides,
    })

    const minimalSearch = {
      callId: 'c1',
      mode: 'metadata' as const,
      scope: { kind: 'library' as const },
      itemTypes: [],
      tags: [],
      excludeTags: [],
      includeTrashed: false,
      returned: 0,
    }

    const minimalPassage = {
      source: 'pdf',
      sourceRef: 'zotero://user/0/item/ABCD1234',
      text: 'passage text',
      previewTruncated: false,
      callIds: ['c1'],
    }

    const minimalExport = {
      callId: 'e1',
      format: 'bibtex',
      refs: ['zotero://user/0/item/ABCD1234'],
      refsOmitted: 0,
      text: '@article{...}',
    }

    const makePage = (workspaceOverrides = {}) => ({
      sessionId: 'session-1',
      target: { kind: 'sources' as const, filter: 'all' as const },
      revision: 1,
      offset: 0,
      limit: 50,
      total: 1,
      workspace: {
        sources: [minimalSource()],
        sourceTotal: 1,
        exports: [],
        exportTotal: 0,
        exportOperations: { running: 0, failed: 0, stopped: 0 },
        omittedRows: 0,
        filterCounts: { all: 1, pdf: 0, retrieved: 0, evidence: 0, exported: 0, issues: 0 },
        evidencePassageTotal: 0,
        exportedRefCount: 0,
        ...workspaceOverrides,
      },
    })

    // Valid bounded page parses cleanly
    expect(zoteroSourcePageResultSchema.parse(makePage())).toBeTruthy()

    // Bounded source limit refinement
    const excessSources = Array.from({ length: ZOTERO_SOURCE_WORKSPACE_MAX_SOURCES + 1 }, (_, i) =>
      minimalSource({ key: `k-${i}` }),
    )
    expect(() => zoteroSourcePageResultSchema.parse(makePage({ sources: excessSources }))).toThrow(
      'Source pages must remain bounded.',
    )

    // Bounded workspace exports limit refinement
    const excessExports = Array.from(
      { length: ZOTERO_SOURCE_WORKSPACE_MAX_ITEM_ROWS + 1 },
      (_, i) => ({
        ...minimalExport,
        callId: `e-${i}`,
      }),
    )
    expect(() => zoteroSourcePageResultSchema.parse(makePage({ exports: excessExports }))).toThrow(
      'Source pages must remain bounded.',
    )

    // Per-source searches refinement
    const excessSearches = Array.from(
      { length: ZOTERO_SOURCE_WORKSPACE_MAX_ITEM_ROWS + 1 },
      (_, i) => ({ ...minimalSearch, callId: `c-${i}` }),
    )
    expect(() =>
      zoteroSourcePageResultSchema.parse(
        makePage({ sources: [minimalSource({ searches: excessSearches })] }),
      ),
    ).toThrow('Source pages must remain bounded.')

    // Per-source evidence refinement
    const excessEvidence = Array.from(
      { length: ZOTERO_SOURCE_WORKSPACE_MAX_ITEM_ROWS + 1 },
      (_, i) => ({ ...minimalPassage, callIds: [`c-${i}`] }),
    )
    expect(() =>
      zoteroSourcePageResultSchema.parse(
        makePage({ sources: [minimalSource({ evidence: excessEvidence })] }),
      ),
    ).toThrow('Source pages must remain bounded.')

    // Per-source exports refinement
    expect(() =>
      zoteroSourcePageResultSchema.parse(
        makePage({ sources: [minimalSource({ exports: excessExports })] }),
      ),
    ).toThrow('Source pages must remain bounded.')
  })
})
