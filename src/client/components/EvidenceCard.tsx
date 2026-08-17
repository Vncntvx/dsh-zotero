/**
 * One source's evidence card: the header with open-in-Zotero actions (each
 * gated by the item's provenance verdict), the indexing coverage line, the
 * budget note, the deduplicated passages with their source tags and page
 * labels, and the per-source availability lines. Everything here is provable
 * session facts — the panel never claims the passages supported the answer.
 * @module dsh-zotero/client/components/EvidenceCard
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { interpolate, joinNonEmpty } from '../presenters.ts'
import {
  annotationKeyOf,
  attachmentRefOf,
  openVerdictOf,
  pdfUrlOf,
  selectUrlOf,
  type OpenVerdict,
} from '../actions/open-zotero.ts'
import type {
  EvidencePassage,
  SourceAvailabilityEntry,
  SourceCoverage,
  SourceItem,
} from '../sources/model.ts'
import { CopyButton } from './SourceRow.tsx'
import css from './SourcesList.module.css'

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
    return `${t('coverageLabel')} ${interpolate(t('coveragePages'), {
      indexed: coverage.indexedPages,
      total: coverage.totalPages,
    })}${suffix}`
  }
  if (coverage.indexedChars !== undefined && coverage.totalChars !== undefined) {
    return `${t('coverageLabel')} ${interpolate(t('coverageChars'), {
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
  if (entry.returnedPassages > 0)
    return interpolate(t('availReturned'), { count: entry.returnedPassages })
  return t('availNoMatch')
}

/** One deep link with its provenance guard; blocked links become a note. */
export function OpenLink({
  url,
  verdict,
  label,
  t,
}: {
  readonly url: string
  readonly verdict: OpenVerdict
  readonly label: string
  readonly t: TranslateNS<'zotero'>
}) {
  if (verdict === 'blocked') {
    return (
      <span className={css.warning} title={t('provenanceMismatch')}>
        {label}（{t('provenanceMismatch')}）
      </span>
    )
  }
  return (
    <span className={css.linkWrap}>
      <a className={css.link} href={url} target="_blank" rel="noreferrer">
        {label}
      </a>
      {verdict === 'unverified' && <span className={css.note}>（{t('instanceUnverified')}）</span>}
    </span>
  )
}

/** One deduplicated passage with its tags and optional annotation deep link. */
function PassageRow({
  passage,
  pdfRef,
  verdict,
  t,
}: {
  readonly passage: EvidencePassage
  readonly pdfRef: string | null
  readonly verdict: OpenVerdict
  readonly t: TranslateNS<'zotero'>
}) {
  const annotationKey = passage.source === 'annotation' ? annotationKeyOf(passage.sourceRef) : null
  const annotationUrl =
    annotationKey !== null && pdfRef !== null
      ? pdfUrlOf(pdfRef, { page: passage.pageLabel, annotation: annotationKey })
      : null
  return (
    <li className={css.passage} data-source={passage.source}>
      <p className={css.passageHead}>
        <span className={css.sourceTag}>{t(sourceLabelKeyOf(passage.source))}</span>
        {passage.pageLabel !== undefined && (
          <span className={css.note}>
            {interpolate(t('pageLabel'), { label: passage.pageLabel })}
          </span>
        )}
        {annotationUrl !== null && verdict !== 'blocked' && (
          <a className={css.link} href={annotationUrl} target="_blank" rel="noreferrer">
            {t('openAnnotation')}
          </a>
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

export interface EvidenceCardProps {
  readonly item: SourceItem
  readonly t: TranslateNS<'zotero'>
}

/** One source's evidence card. */
export function EvidenceCard({ item, t }: EvidenceCardProps) {
  const verdict = openVerdictOf(item)
  const selectUrl = selectUrlOf(item.ref)
  const pdfRef = attachmentRefOf(item)
  const pdfUrl = pdfRef === null ? null : pdfUrlOf(pdfRef)
  const coverageLine =
    item.retrievalFacts?.coverage === undefined
      ? ''
      : coverageLineOf(item.retrievalFacts.coverage, t)
  const availabilityEntries =
    item.retrievalFacts === undefined ? [] : Object.entries(item.retrievalFacts.sourceAvailability)
  return (
    <section className={css.card} data-provenance={item.provenance}>
      <header className={css.cardHead}>
        <span className={css.cardTitle}>{item.title ?? item.ref}</span>
        <span className={css.note}>{joinNonEmpty(item.creators, item.year)}</span>
        {selectUrl !== null && (
          <OpenLink url={selectUrl} verdict={verdict} label={t('openInZotero')} t={t} />
        )}
        {pdfUrl !== null && <OpenLink url={pdfUrl} verdict={verdict} label={t('openPdf')} t={t} />}
        <CopyButton value={item.ref} label={t('copyRef')} t={t} />
      </header>
      {coverageLine !== '' && <p className={css.note}>{coverageLine}</p>}
      {item.retrievalFacts?.truncated === true && (
        <p className={css.note}>{t('budgetLimitedNote')}</p>
      )}
      <ul className={css.passages}>
        {item.evidence.map((passage, index) => (
          <PassageRow
            key={`${passage.sourceRef}-${index}`}
            passage={passage}
            pdfRef={pdfRef}
            verdict={verdict}
            t={t}
          />
        ))}
      </ul>
      {availabilityEntries.length > 0 && (
        <ul className={css.availability}>
          {availabilityEntries.map(([source, entry]) => (
            <li key={source} className={css.note}>
              {t(sourceLabelKeyOf(source))}：{availabilityLineOf(entry, t)}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
