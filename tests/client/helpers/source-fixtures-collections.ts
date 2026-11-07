/**
 * The multi-item source fixtures: the named workspaces that exercise list
 * behavior (a mixed sweep of states, a large list for density, and the
 * disconnected-with-history case). The single-item scenes live in
 * `source-fixtures-gallery.ts`; the neutral builders both halves compose
 * live in `source-fixtures.ts`.
 * @module tests/client/helpers/source-fixtures-collections
 */

import type { SourceItem, SourceWorkspace } from '../../../src/sources/model.js'
import { singleFixture } from './source-fixtures-gallery.ts'
import { artifactOf, passageOf, searchOf, sourceOf, workspaceOf } from './source-fixtures.ts'

/** The mutable twin of SourceItem; fixture builders assign per-scenario fields. */
type MutableSourceItem = { -readonly [K in keyof SourceItem]: SourceItem[K] }

/**
 * 2/8 (twelve items in mixed states): fresh, inspected, PDF vs no-PDF
 * (untyped hints are never promised), evidence, exports, issues, and a
 * mismatch. The main visual sweep.
 */
export function mixedFixture(): SourceWorkspace {
  const items: SourceItem[] = []
  // One session export covering the first three items; those items carry it
  // in their own `exports` array, which is what the badge and the exported
  // filter read. Fixture and session view stay the same fact.
  const artifact = artifactOf({
    callId: 'call-export-1',
    refs: [0, 1, 2].map((i) => `zotero://user/0/item/${String.fromCharCode(65 + i)}`),
  })
  const exportedRefs = new Set(artifact.refs)
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
      overrides.evidenceMatch = 'verified'
      overrides.facts = {
        reportedEvidenceCount: i % 4 === 0 ? 6 : 2,
      }
      overrides.bestAttachment = {
        ref: 'zotero://user/0/attachment/ABCD1234',
        contentType: 'application/pdf',
      }
      overrides.retrievalFacts = {
        attachmentRef: 'zotero://user/0/attachment/ABCD1234',
        attachmentContentType: 'application/pdf',
        truncated: false,
        sourceAvailability: {
          PDF: { requested: true, returnedPassages: evidenceCount, unavailable: false },
        },
      }
      overrides.evidence = Array.from({ length: evidenceCount }, (_, p) =>
        passageOf({
          sourceRef: 'zotero://user/0/attachment/ABCD1234',
          callIds: ['call-2'],
          text: `Passage ${p + 1} of item ${i + 1}.`,
        }),
      )
      overrides.searches = [searchOf({ callId: 'call-2', query: 'mixed' })]
      if (exportedRefs.has(overrides.ref!)) overrides.exports = [artifact]
    } else if (i % 3 === 0) {
      // Every third index: a mismatch.
      overrides.evidenceMatch = 'mismatch'
      overrides.bestAttachment = {
        ref: 'zotero://user/0/attachment/ABCD1234',
        contentType: 'application/pdf',
      }
      overrides.retrievalFacts = {
        attachmentRef: 'zotero://user/0/attachment/ABCD1234',
        attachmentContentType: 'application/pdf',
        truncated: false,
        sourceAvailability: {},
      }
      overrides.evidence = [
        passageOf({ sourceRef: 'zotero://user/0/attachment/ABCD1234', callIds: ['call-3'] }),
      ]
      overrides.facts = {
        reportedEvidenceCount: 1,
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
  return workspaceOf(items, { exports: [artifact] })
}

/**
 * 3/8 (thirty items): the large-list workspace for scrolling and density.
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
      overrides.evidenceMatch = 'verified'
      overrides.facts = {
        reportedEvidenceCount: 2,
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
 * 8/8 (disconnected but with history): the workspace is fully populated
 * while the connection view reports the probe's failure. The panel must
 * render the data, not an empty shell.
 */
export function offlineFixture(): SourceWorkspace {
  return singleFixture()
}
