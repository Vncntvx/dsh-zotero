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
import type { EvidenceMatchKind } from '../evidence-item.js'
import type { SourceAvailabilityEntry, SourceCoverage } from '../sources/model.js'

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

/**
 * The locale key of one fulltext window's source kind. The card states what
 * kind of source was read; the concrete ref stays out of the sentence (long
 * refs would break the line in the narrow panel) and rides the card's title.
 * @param kind - the window's source kind.
 * @returns the locale key naming it.
 */
export function fulltextSourceKeyOf(
  kind: 'attachment' | 'url',
): 'fulltextSourceAttachment' | 'fulltextSourceUrl' {
  return kind === 'url' ? 'fulltextSourceUrl' : 'fulltextSourceAttachment'
}

/**
 * The locale key of one fulltext window's text format, so `markdown` never
 * reaches the reader as a bare wire enum.
 * @param format - the window's text format.
 * @returns the locale key naming it.
 */
export function fulltextFormatKeyOf(
  format: 'markdown' | 'text',
): 'fulltextFormatMarkdown' | 'fulltextFormatText' {
  return format === 'markdown' ? 'fulltextFormatMarkdown' : 'fulltextFormatText'
}

/**
 * The locale key of one match kind. Only a `lexical` passage's own text may be
 * quoted as carrying the query's words; the label marks that distinction.
 */
export function matchLabelKeyOf(
  kind: EvidenceMatchKind,
): 'matchLexical' | 'matchSemantic' | 'matchHybrid' {
  switch (kind) {
    case 'semantic':
      return 'matchSemantic'
    case 'hybrid':
      return 'matchHybrid'
    default:
      return 'matchLexical'
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
 * the panel child-page reader section headings and the `zotero_get` count badge and
 * preview sections. One mapping, so a kind cannot be renamed in a section and
 * left stale in a badge.
 */
export const CHILD_KIND_LABEL = {
  note: 'toolChildrenNotes',
  attachment: 'toolChildrenAttachments',
  annotation: 'toolChildrenAnnotations',
} as const satisfies Record<'note' | 'attachment' | 'annotation', ZoteroLocaleKey>

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

/** The per-source availability line reports how many passages were returned. */
export function availabilityLineOf(
  entry: SourceAvailabilityEntry,
  t: TranslateNS<'zotero'>,
): string {
  if (entry.unavailable) return t('availUnavailable')
  if (entry.returnedPassages > 0) return t('availReturned', { count: entry.returnedPassages })
  return t('availNoMatch')
}

/** Distinguish an empty retrieval from an incomplete one and from omitted previews. */
export function emptyEvidenceNoteOf(
  reportedEvidenceCount: number,
  t: TranslateNS<'zotero'>,
  truncated = false,
): string {
  if (reportedEvidenceCount > 0)
    return t('evidenceReportedNoPreview', { count: reportedEvidenceCount })
  return t(truncated ? 'evidenceRetrievedNonePartial' : 'evidenceRetrievedNone')
}
