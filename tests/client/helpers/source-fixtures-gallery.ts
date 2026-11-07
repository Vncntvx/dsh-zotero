/**
 * The single-item source fixtures: one confirmed-PDF building block and the
 * named workspaces that exercise one behavior each (everything present, a
 * zero-match retrieve, an instance mismatch, repeated retrieves with
 * truncation, and a large whole-text artifact). The multi-item collections
 * live in `source-fixtures-collections.ts`; the neutral builders both halves
 * compose live in `source-fixtures.ts`.
 * @module tests/client/helpers/source-fixtures-gallery
 */

import type { SourceItem, SourceWorkspace } from '../../../src/sources/model.js'
import { artifactOf, passageOf, sourceOf, workspaceOf, searchOf } from './source-fixtures.ts'

/** One confirmed-PDF item, the gallery's shared building block. */
function pdfItemOf(overrides: Partial<SourceItem> = {}): SourceItem {
  return sourceOf({
    ref: 'zotero://user/0/item/PPPP0001',
    key: 'zotero://user/0/item/p',
    title: 'Risk policy in practice',
    creators: 'Xu, Wenjie',
    year: 2024,
    venue: 'Policy Studies Journal',
    evidenceMatch: 'verified',
    facts: {
      reportedEvidenceCount: 4,
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
 * 1/8 (one item, everything present): inspected, PDF, evidence, exports.
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
 * 4/8 (a retrieve that matched nothing): the item exists but no source
 * returned passages. Exercises the zero-evidence empty states.
 */
export function zeroMatchFixture(): SourceWorkspace {
  return workspaceOf([
    pdfItemOf({
      facts: {
        reportedEvidenceCount: 0,
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
 * 5/8 (an instance mismatch): the PDF read is present but blocked, and
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
      evidenceMatch: 'mismatch',
      facts: {
        reportedEvidenceCount: 1,
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
 * 6/8 (repeated retrieves with truncation): run count three, truncated once,
 * evidence survives. Exercises the RetrievalSummary block and the truncated
 * hint without a truncated-badge regression.
 */
export function repeatedRetrieveFixture(): SourceWorkspace {
  const item = pdfItemOf({
    facts: {
      reportedEvidenceCount: 7,
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
 * 7/8 (a large BibTeX artifact): the exports lens shows the file with a
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
