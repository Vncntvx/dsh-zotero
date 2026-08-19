/**
 * Shared source fixtures for the panel specs and the visual baseline.
 * Beyond the neutral `sourceOf`/`workspaceOf` builders (the spec convention,
 * same as blocks.ts), this module exports a deterministic fixture gallery of
 * eight named workspaces — one item, a mixed 12, a large 30, a zero-match
 * retrieve, a provenance mismatch, repeated retrieves with truncation, a
 * large BibTeX artifact, and a disconnected session with history. Each is
 * renderable as-is by `ZoteroWorkspaceView`, so visual iteration never needs
 * a live session or a real Zotero.
 * @module tests/client/helpers/source-fixtures
 */

import type { SourceItem, SourceWorkspace } from '../../../src/client/sources/model.ts'

/** The mutable twin of SourceItem; fixture builders assign per-scenario fields. */
type MutableSourceItem = { -readonly [K in keyof SourceItem]: SourceItem[K] }

/** A neutral base source; override per-spec fields to build a scenario. */
export function sourceOf(overrides: Partial<SourceItem> = {}): SourceItem {
  return {
    key: 'zotero://user/0/item/a',
    ref: 'zotero://user/0/item/A',
    provenance: 'unknown',
    facts: {
      inspected: false,
      evidenceCount: 0,
      reportedEvidenceCount: 0,
      attachmentResolved: false,
      exportCount: 0,
    },
    operations: { running: 0, failed: 0, stopped: 0 },
    searches: [],
    evidence: [],
    exports: [],
    firstSeenAt: 1,
    lastTouchedAt: 1,
    ...overrides,
  }
}

/** A workspace over the given sources with neutral session facts. */
export function workspaceOf(
  sources: readonly SourceItem[],
  overrides: Partial<Omit<SourceWorkspace, 'sources'>> = {},
): SourceWorkspace {
  return {
    sources,
    exports: [],
    exportOperations: { running: 0, failed: 0, stopped: 0 },
    omittedRows: 0,
    ...overrides,
  }
}

/** A neutral evidence passage; override per scenario. */
export function passageOf(
  overrides: Partial<SourceItem['evidence'][number]> = {},
): SourceItem['evidence'][number] {
  return {
    source: 'PDF',
    sourceRef: 'zotero://user/0/attachment/ABCD1234',
    text: 'The policy applies to all covered entities.',
    previewTruncated: false,
    callIds: ['call-1'],
    ...overrides,
  }
}

/** A neutral export artifact; override per scenario. */
export function artifactOf(
  overrides: Partial<SourceWorkspace['exports'][number]> = {},
): SourceWorkspace['exports'][number] {
  const text = '@article{a,\n  title = {A},\n}'
  return {
    callId: 'call-export-1',
    format: 'bibtex',
    refs: ['zotero://user/0/item/QRST3456'],
    refsOmitted: 0,
    // The default itemization must locate its entry in the default body,
    // or the artifact would fall back to a whole-text row everywhere.
    text,
    items: [
      {
        ref: 'zotero://user/0/item/QRST3456',
        key: 'a',
        title: 'A',
        start: 0,
        end: text.length,
      },
    ],
    ...overrides,
  }
}

/** One confirmed-PDF item, the fixture gallery's shared building block. */
function pdfItemOf(overrides: Partial<SourceItem> = {}): SourceItem {
  return sourceOf({
    ref: 'zotero://user/0/item/P',
    key: 'zotero://user/0/item/p',
    title: 'Risk policy in practice',
    creators: 'Xu, Wenjie',
    year: 2024,
    venue: 'Policy Studies Journal',
    provenance: 'verified',
    facts: {
      inspected: true,
      evidenceCount: 2,
      reportedEvidenceCount: 4,
      attachmentResolved: true,
      exportCount: 1,
    },
    bestAttachment: { ref: 'zotero://user/0/attachment/ABCD1234', contentType: 'application/pdf' },
    attachment: {
      ref: 'zotero://user/0/attachment/ABCD1234',
      kind: 'file',
      contentType: 'application/pdf',
      title: 'Risk policy in practice.pdf',
      location: 'storage:risk-policy.pdf',
    },
    ...overrides,
  })
}

/** A neutral search provenance; override per scenario. */
export function searchOf(
  overrides: Partial<SourceItem['searches'][number]> = {},
): SourceItem['searches'][number] {
  return {
    callId: 'call-1',
    query: 'risk policy',
    mode: 'everything',
    scope: { kind: 'library' },
    itemTypes: [],
    tags: [],
    ...overrides,
  }
}

/** A neutral retrieval-facts block; override per scenario. */
function retrievalFactsOf(
  overrides: Partial<NonNullable<SourceItem['retrievalFacts']>> = {},
): NonNullable<SourceItem['retrievalFacts']> {
  return {
    attachmentRef: 'zotero://user/0/attachment/ABCD1234',
    attachmentContentType: 'application/pdf',
    truncated: false,
    sourceAvailability: {},
    ...overrides,
  }
}

/**
 * 1/8 — one item, everything present: inspected, PDF, evidence, exports.
 * The smallest workspace the visual baseline renders.
 */
export function singleFixture(): SourceWorkspace {
  const artifact = artifactOf()
  return workspaceOf(
    [
      pdfItemOf({
        evidence: [
          passageOf({ callIds: ['call-1'] }),
          passageOf({ text: 'A second passage on data retention.', callIds: ['call-1'] }),
        ],
        retrievalFacts: retrievalFactsOf({
          sourceAvailability: {
            PDF: { requested: true, returnedPassages: 2, unavailable: false },
          },
        }),
        retrievalSummary: {
          runCount: 1,
          latestCallId: 'call-1',
          latestRetrievedAt: 1720000000000,
          keptPassageCount: 2,
          reportedPassageCount: 4,
          truncated: false,
        },
        searches: [searchOf()],
        exports: [artifact],
        firstSeenAt: 1,
        lastTouchedAt: 2,
      }),
    ],
    { exports: [artifact] },
  )
}

/**
 * 2/8 — twelve items in mixed states: fresh, inspected, PDF vs no-PDF
 * (untyped hints are never promised), evidence, exports, issues, and a
 * mismatch. The main visual sweep.
 */
export function mixedFixture(): SourceWorkspace {
  const items: SourceItem[] = []
  for (let i = 0; i < 12; i += 1) {
    const letter = String.fromCharCode(65 + i)
    const overrides: Partial<MutableSourceItem> = {
      ref: `zotero://user/0/item/${letter}`,
      key: `zotero://user/0/item/${letter.toLowerCase()}`,
      title: `Source item ${i + 1}: mixed states`,
      creators: `Creator ${letter}, A.`,
      year: 2010 + i,
      venue: 'Journal of Mixed States',
      firstSeenAt: i + 1,
      lastTouchedAt: i + 1,
    }
    if (i % 2 === 0) {
      // Even indexes: confirmed PDF with evidence.
      const evidenceCount = i % 4 === 0 ? 3 : 1
      overrides.provenance = 'verified'
      overrides.facts = {
        inspected: true,
        evidenceCount,
        reportedEvidenceCount: i % 4 === 0 ? 6 : 2,
        attachmentResolved: true,
        exportCount: i % 3 === 0 ? 1 : 0,
      }
      overrides.bestAttachment = {
        ref: 'zotero://user/0/attachment/ABCD1234',
        contentType: 'application/pdf',
      }
      overrides.retrievalFacts = retrievalFactsOf({
        attachmentRef: 'zotero://user/0/attachment/ABCD1234',
        sourceAvailability: {
          PDF: { requested: true, returnedPassages: evidenceCount, unavailable: false },
        },
      })
      overrides.evidence = Array.from({ length: evidenceCount }, (_, p) =>
        passageOf({
          sourceRef: 'zotero://user/0/attachment/ABCD1234',
          callIds: ['call-2'],
          text: `Passage ${p + 1} of item ${i + 1}.`,
        }),
      )
      overrides.searches = [searchOf({ callId: 'call-2', query: 'mixed' })]
    } else if (i % 3 === 0) {
      // Every third index: a mismatch.
      overrides.provenance = 'mismatch'
      overrides.bestAttachment = {
        ref: 'zotero://user/0/attachment/ABCD1234',
        contentType: 'application/pdf',
      }
      overrides.retrievalFacts = retrievalFactsOf()
      overrides.evidence = [
        passageOf({ sourceRef: 'zotero://user/0/attachment/ABCD1234', callIds: ['call-3'] }),
      ]
      overrides.facts = {
        inspected: true,
        evidenceCount: 1,
        reportedEvidenceCount: 1,
        attachmentResolved: false,
        exportCount: 0,
      }
      overrides.searches = [searchOf({ callId: 'call-3', query: 'mismatch' })]
    } else {
      // Odd indexes: a fresh hit whose untyped hint promises no PDF.
      overrides.bestAttachment = { ref: 'zotero://user/0/attachment/ABCD1234' }
      overrides.searches = [searchOf({ callId: 'call-1', query: 'fresh' })]
    }
    items.push(sourceOf(overrides))
  }
  items[0] = sourceOf({ ...items[0], operations: { running: 0, failed: 1, stopped: 0 } })
  items[1] = sourceOf({ ...items[1], operations: { running: 0, failed: 0, stopped: 1 } })
  items[2] = sourceOf({ ...items[2], operations: { running: 1, failed: 0, stopped: 0 } })
  return workspaceOf(items, {
    exports: [
      artifactOf({ callId: 'call-export-1', refs: items.slice(0, 3).map((item) => item.ref) }),
    ],
  })
}

/**
 * 3/8 — thirty items: the large-list workspace for scrolling and density.
 * Half confirmed PDF with evidence, half fresh hits without a PDF promise.
 */
export function largeFixture(): SourceWorkspace {
  const items: SourceItem[] = []
  for (let i = 0; i < 30; i += 1) {
    const letter = String.fromCharCode(65 + (i % 26))
    const overrides: Partial<MutableSourceItem> = {
      ref: `zotero://user/0/item/L${i}`,
      key: `zotero://user/0/item/l${i}`,
      title: `Large list item ${i + 1}: a title long enough to wrap`,
      creators: `Creator ${letter} ${letter}.`,
      year: 1990 + i,
      venue: 'Journal of Large Lists',
      firstSeenAt: i + 1,
      lastTouchedAt: i + 1,
      searches: [searchOf({ callId: `call-${i}`, query: 'large' })],
    }
    if (i % 2 === 0) {
      overrides.provenance = 'verified'
      overrides.facts = {
        inspected: true,
        evidenceCount: 1,
        reportedEvidenceCount: 2,
        attachmentResolved: true,
        exportCount: 0,
      }
      overrides.bestAttachment = {
        ref: 'zotero://user/0/attachment/ABCD1234',
        contentType: 'application/pdf',
      }
      overrides.evidence = [
        passageOf({ sourceRef: 'zotero://user/0/attachment/ABCD1234', callIds: [`call-${i}`] }),
      ]
    }
    items.push(sourceOf(overrides))
  }
  return workspaceOf(items)
}

/**
 * 4/8 — a retrieve that matched nothing: the item exists but no source
 * returned passages. Exercises the zero-evidence empty states.
 */
export function zeroMatchFixture(): SourceWorkspace {
  return workspaceOf([
    pdfItemOf({
      facts: {
        inspected: true,
        evidenceCount: 0,
        reportedEvidenceCount: 0,
        attachmentResolved: true,
        exportCount: 0,
      },
      evidence: [],
      retrievalFacts: retrievalFactsOf({
        attachmentRef: undefined,
        attachmentContentType: undefined,
        sourceAvailability: {
          PDF: { requested: true, returnedPassages: 0, unavailable: true },
          'Full text': { requested: true, returnedPassages: 0, unavailable: true },
        },
      }),
      searches: [searchOf({ callId: 'call-1', query: 'no such phrase' })],
    }),
  ])
}

/**
 * 5/8 — a provenance mismatch: the open action is present but blocked, and
 * the item still counts as "has PDF" for the badge and filter.
 */
export function mismatchFixture(): SourceWorkspace {
  return workspaceOf([
    sourceOf({
      ref: 'zotero://user/0/item/MNOP5678',
      key: 'zotero://user/0/item/mnop5678',
      title: 'Mismatched item',
      creators: 'Other, B.',
      year: 2020,
      provenance: 'mismatch',
      facts: {
        inspected: true,
        evidenceCount: 1,
        reportedEvidenceCount: 1,
        attachmentResolved: true,
        exportCount: 0,
      },
      bestAttachment: {
        ref: 'zotero://user/0/attachment/EFGH9012',
        contentType: 'application/pdf',
      },
      attachment: {
        ref: 'zotero://user/0/attachment/EFGH9012',
        kind: 'file',
        contentType: 'application/pdf',
        title: 'Mismatched item.pdf',
        location: 'storage:mismatched.pdf',
      },
      retrievalFacts: retrievalFactsOf(),
      evidence: [
        passageOf({ sourceRef: 'zotero://user/0/attachment/EFGH9012', callIds: ['call-4'] }),
      ],
      searches: [searchOf({ callId: 'call-4', query: 'mismatch' })],
      firstSeenAt: 1,
      lastTouchedAt: 2,
    }),
  ])
}

/**
 * 6/8 — repeated retrieves with truncation: run count three, truncated once,
 * evidence survives. Exercises the RetrievalSummary block and the truncated
 * hint without a truncated-badge regression.
 */
export function repeatedRetrieveFixture(): SourceWorkspace {
  const item = pdfItemOf({
    facts: {
      inspected: true,
      evidenceCount: 3,
      reportedEvidenceCount: 7,
      attachmentResolved: true,
      exportCount: 0,
    },
    evidence: [
      passageOf({ callIds: ['call-1', 'call-2', 'call-3'] }),
      passageOf({
        text: 'Retained across all three retrieves.',
        callIds: ['call-1', 'call-2', 'call-3'],
      }),
      passageOf({ text: 'A later-only passage.', callIds: ['call-3'] }),
    ],
    retrievalFacts: retrievalFactsOf({
      truncated: true,
      sourceAvailability: {
        PDF: { requested: true, returnedPassages: 3, unavailable: false },
        'Full text': { requested: true, returnedPassages: 1, unavailable: false },
      },
    }),
    retrievalSummary: {
      runCount: 3,
      latestCallId: 'call-3',
      latestRetrievedAt: 1720000002000,
      keptPassageCount: 3,
      reportedPassageCount: 7,
      truncated: true,
    },
    searches: [
      searchOf({ callId: 'call-1', query: 'first' }),
      searchOf({ callId: 'call-2', query: 'second' }),
      searchOf({ callId: 'call-3', query: 'third' }),
    ],
    firstSeenAt: 1,
    lastTouchedAt: 4,
  })
  return workspaceOf([item])
}

/** A large BibTeX artifact body; big enough to exercise the expand/collapse. */
const LARGE_BIBTEX = Array.from(
  { length: 120 },
  (_, i) =>
    `@article{key${i},\n  title = {Large export entry ${i + 1}},\n  author = {Creator ${String.fromCharCode(65 + (i % 26))}.},\n  year = {${1990 + (i % 30)}},\n}`,
).join('\n\n')

/**
 * 7/8 — a large BibTeX artifact: the exports lens shows the file with a
 * bounded preview and a full-text expand, never a truncating layout. The
 * artifact stays item-less on purpose, so the page also exercises the
 * whole-text fallback row.
 */
export function largeArtifactFixture(): SourceWorkspace {
  return workspaceOf([pdfItemOf()], {
    exports: [
      artifactOf({
        callId: 'call-export-1',
        format: 'bibtex',
        refs: ['zotero://user/0/item/QRST3456'],
        refsOmitted: 19,
        text: LARGE_BIBTEX,
        items: undefined,
      }),
    ],
  })
}

/**
 * 8/8 — disconnected but with history: the workspace is fully populated
 * while the connection view reports the probe's failure. The panel must
 * render the data, not an empty shell.
 */
export function offlineFixture(): SourceWorkspace {
  return singleFixture()
}
