/**
 * Shared evidence copy helpers: the locale-key mapping and the coverage,
 * availability, and empty-state lines both the cross-source board
 * (`EvidenceCard`) and the inspector passages panel (`SourceEvidence`) render.
 * Kept here (not inside either view file) so the two surfaces stay consistent
 * without a component-layer dependency in either direction.
 * @module dsh-zotero/client/evidence-labels
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
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
