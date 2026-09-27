/**
 * The shared label copy every Zotero surface renders: the evidence source
 * keys, the coverage and availability lines the cross-source board
 * (`EvidenceCard`) and the inspector passages panel (`SourceEvidence`) show,
 * and the bounded-listing count the browse, children, item, and changes cards
 * all report. Kept here rather than inside a view file so those surfaces stay
 * consistent without a component-layer dependency in any direction.
 * @module dsh-zotero/client/evidence-labels
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ZoteroLocaleKey } from './locales.ts'
import type { ChildRow } from './sources/decoders.ts'
import type { SourceAvailabilityEntry, SourceCoverage } from './sources/model.ts'

/** The locale key of one evidence source kind; unknown kinds read as fulltext. */
export function sourceLabelKeyOf(
  source: string,
): 'sourceAnnotation' | 'sourceNote' | 'sourceAbstract' | 'sourceFulltext' {
  switch (source) {
    case 'annotation':
      return 'sourceAnnotation'
    case 'note':
      return 'sourceNote'
    case 'abstract':
      return 'sourceAbstract'
    default:
      return 'sourceFulltext'
  }
}

/** The coverage line of one retrieve: pages when reported, else chars, else nothing. */
export function coverageLineOf(coverage: SourceCoverage, t: TranslateNS<'zotero'>): string {
  const suffix = coverage.complete ? t('coverageComplete') : t('coverageIncomplete')
  if (coverage.indexedPages !== undefined && coverage.totalPages !== undefined) {
    return `${t('coverageLabel')} ${t('coveragePages', {
      indexed: coverage.indexedPages,
      total: coverage.totalPages,
    })}${suffix}`
  }
  if (coverage.indexedChars !== undefined && coverage.totalChars !== undefined) {
    return `${t('coverageLabel')} ${t('coverageChars', {
      indexed: coverage.indexedChars,
      total: coverage.totalChars,
    })}${suffix}`
  }
  return ''
}

/**
 * The heading each child kind is named by, wherever a card mentions it: the
 * `zotero_children` section headings and the `zotero_get` count badge and
 * preview sections. One mapping, so a kind cannot be renamed in a section and
 * left stale in a badge.
 */
export const CHILD_KIND_LABEL = {
  note: 'toolChildrenNotes',
  attachment: 'toolChildrenAttachments',
  annotation: 'toolChildrenAnnotations',
} as const satisfies Record<ChildRow['kind'], ZoteroLocaleKey>

/**
 * The "how many of how many" line every card that shows a bounded listing
 * uses: the bare number when the listing is whole, the pair when it was
 * capped, and the shown count when the true total is unknown. One helper so
 * those cards cannot drift into different spellings of the same number pair.
 * Both numbers ride the phrase, because their order is a property of the
 * language rather than of the caller.
 * @param total - the true count behind the listing, or null when unreported.
 * @param shown - how many entries the card actually renders.
 * @returns the count line.
 */
export function countOfLabel(
  total: number | null,
  shown: number,
  t: TranslateNS<'zotero'>,
): string {
  if (total === null) return String(shown)
  if (total === shown) return String(total)
  return t('countOfReturned', { total, shown })
}

/** The per-source availability line: unavailable, returned, or no match. */
export function availabilityLineOf(
  entry: SourceAvailabilityEntry,
  t: TranslateNS<'zotero'>,
): string {
  if (entry.unavailable) return t('availUnavailable')
  if (entry.returnedPassages > 0) return t('availReturned', { count: entry.returnedPassages })
  return t('availNoMatch')
}

/** The honest empty-passages note: reported-but-unkept count, or no match. */
export function emptyEvidenceNoteOf(
  reportedEvidenceCount: number,
  t: TranslateNS<'zotero'>,
): string {
  return reportedEvidenceCount > 0
    ? t('evidenceReportedNoPreview', { count: reportedEvidenceCount })
    : t('evidenceRetrievedNone')
}
