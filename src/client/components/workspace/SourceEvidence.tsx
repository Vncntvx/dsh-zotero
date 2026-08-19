/**
 * The inspector's passages panel: one source's retrieved passages. Three
 * states come apart honestly: an item never retrieved shows the onboarding
 * note (how passages come to exist), a retrieved item with no kept passage
 * says so without inventing a cause, and a retrieved item with passages
 * renders them. The head carries the RetrievalSummary — run count, kept/
 * reported passage counts, and the truncation note — then the deduplicated
 * passages with their source tags and page labels, the indexing coverage
 * line, and the per-source availability list titled for the latest
 * retrieve. Facts only; nothing here implies the final answer used the
 * passages.
 * @module dsh-zotero/client/components/workspace/SourceEvidence
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { interpolate } from '../../presenters.ts'
import type { EvidencePassage, SourceItem } from '../../sources/model.ts'
import { availabilityLineOf, coverageLineOf, sourceLabelKeyOf } from '../EvidenceCard.tsx'
import css from './workspace.module.css'

/** The summary line of one item's retrieves: runs, kept, reported, truncated. */
function retrievalSummaryLineOf(item: SourceItem, t: TranslateNS<'zotero'>): string {
  const summary = item.retrievalSummary
  if (summary === undefined) return ''
  const parts = [
    interpolate(t('retrievalRunCount'), { count: summary.runCount }),
    interpolate(t('retrievalKeptCount'), { count: summary.keptPassageCount }),
    interpolate(t('retrievalReportedCount'), { count: summary.reportedPassageCount }),
  ]
  if (summary.truncated) parts.push(t('budgetLimitedNote'))
  return parts.join(' · ')
}

export interface SourceEvidenceProps {
  readonly item: SourceItem
  readonly t: TranslateNS<'zotero'>
}

/** One passage row with its source tag, page label, and truncated note. */
function PassageRow({
  passage,
  t,
}: {
  readonly passage: EvidencePassage
  readonly t: TranslateNS<'zotero'>
}) {
  return (
    <li className={css.passage} data-source={passage.source}>
      <p className={css.passageHead}>
        <span className={css.sourceTag}>{t(sourceLabelKeyOf(passage.source))}</span>
        {passage.pageLabel !== undefined && (
          <span className={css.note}>
            {interpolate(t('pageLabel'), { label: passage.pageLabel })}
          </span>
        )}
      </p>
      <p className={css.line}>
        {passage.text}
        {passage.previewTruncated ? ` ${t('truncatedPreview')}` : ''}
      </p>
      {passage.callIds.length > 1 && (
        <p className={css.note}>
          {interpolate(t('retrievedMultiple'), { count: passage.callIds.length })}
        </p>
      )}
    </li>
  )
}

/** The passages panel: summary head, passages, coverage, and availability. */
export function SourceEvidence({ item, t }: SourceEvidenceProps) {
  if (item.retrievalFacts === undefined) {
    return (
      <div className={css.panel}>
        <p className={css.note}>{t('evidenceNotRetrieved')}</p>
      </div>
    )
  }
  const summaryLine = retrievalSummaryLineOf(item, t)
  const facts = item.retrievalFacts
  const coverageLine = facts.coverage === undefined ? '' : coverageLineOf(facts.coverage, t)
  const availabilityEntries = Object.entries(facts.sourceAvailability)
  return (
    <div className={css.panel}>
      {summaryLine !== '' && <p className={css.summaryLine}>{summaryLine}</p>}
      {coverageLine !== '' && <p className={css.note}>{coverageLine}</p>}
      {item.evidence.length === 0 ? (
        <p className={css.note}>
          {item.facts.reportedEvidenceCount > 0
            ? interpolate(t('evidenceReportedNoPreview'), {
                count: item.facts.reportedEvidenceCount,
              })
            : t('evidenceRetrievedNone')}
        </p>
      ) : (
        <ul className={css.passages}>
          {item.evidence.map((passage, index) => (
            <PassageRow key={`${passage.sourceRef}-${index}`} passage={passage} t={t} />
          ))}
        </ul>
      )}
      {availabilityEntries.length > 0 && (
        <div className={css.section}>
          <p className={css.sectionLabel}>{t('availabilityTitle')}</p>
          <ul className={css.availability}>
            {availabilityEntries.map(([source, entry]) => (
              <li key={source} className={css.note}>
                {interpolate(t('availabilityEntry'), {
                  source: t(sourceLabelKeyOf(source)),
                  detail: availabilityLineOf(entry, t),
                })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
