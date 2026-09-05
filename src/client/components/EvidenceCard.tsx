/**
 * One source's evidence card: the header with open-in-Zotero actions (each
 * gated by the item's provenance verdict and the source's PDF capability),
 * the indexing coverage line, the budget note, the deduplicated passages
 * with their source tags and page labels, and the per-source availability
 * lines. Everything here is provable session facts — the panel never claims
 * the passages supported the answer.
 * @module dsh-zotero/client/components/EvidenceCard
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { joinNonEmpty, shortKeyOf } from '../presenters.ts'
import { openVerdictOf, pdfUrlOf, selectUrlOf, type OpenVerdict } from '../actions/open-zotero.ts'
import {
  availabilityLineOf,
  coverageLineOf,
  emptyEvidenceNoteOf,
  sourceLabelKeyOf,
} from '../evidence-labels.ts'
import type { EvidencePassage, SourceItem } from '../sources/model.ts'
import { pdfCapabilityOf, type PdfCapability } from '../sources/source-capabilities.ts'
import { CopyButton } from './CopyButton.tsx'
import { BlockedOpenAction } from './open/BlockedOpenAction.tsx'
import { ZoteroOpenLink } from './open/ZoteroOpenLink.tsx'
import css from './cards.module.css'

export {
  availabilityLineOf,
  coverageLineOf,
  emptyEvidenceNoteOf,
  sourceLabelKeyOf,
} from '../evidence-labels.ts'

/** One deduplicated passage with its tags and optional annotation deep link. */
function PassageRow({
  passage,
  pdfRef,
  verdict,
  t,
}: {
  readonly passage: EvidencePassage
  /** The source's file-PDF ref; annotation jumps prefer the passage's own parent attachment. */
  readonly pdfRef: string | null
  readonly verdict: OpenVerdict
  readonly t: TranslateNS<'zotero'>
}) {
  const annotationKey = passage.source === 'annotation' ? shortKeyOf(passage.sourceRef) : null
  const annotationUrl =
    annotationKey !== null && pdfRef !== null
      ? pdfUrlOf(passage.attachmentRef ?? pdfRef, { annotation: annotationKey })
      : null
  return (
    <li className={css.passage} data-source={passage.source}>
      <p className={css.passageHead}>
        <span className={css.sourceTag}>{t(sourceLabelKeyOf(passage.source))}</span>
        {passage.pageLabel !== undefined && (
          <span className={css.note}>{t('pageLabel', { label: passage.pageLabel })}</span>
        )}
        {annotationUrl !== null && verdict !== 'blocked' && (
          <ZoteroOpenLink
            url={annotationUrl}
            verdict={verdict}
            label={t('openAnnotation')}
            t={t}
            className={css.link}
          />
        )}
      </p>
      <p className={css.line}>
        {passage.text}
        {passage.previewTruncated ? ` ${t('truncatedPreview')}` : ''}
      </p>
      {passage.callIds.length > 1 && (
        <p className={css.note}>{t('retrievedMultiple', { count: passage.callIds.length })}</p>
      )}
    </li>
  )
}

export interface EvidenceCardProps {
  readonly item: SourceItem
  readonly t: TranslateNS<'zotero'>
}

/** The source's file-PDF ref for annotation jumps; a web PDF cannot jump to annotations. */
function pdfRefOf(capability: PdfCapability | null): string | null {
  return capability !== null && capability.kind === 'file' ? capability.ref : null
}

/** One source's evidence card. */
export function EvidenceCard({ item, t }: EvidenceCardProps) {
  const verdict = openVerdictOf(item)
  const selectUrl = selectUrlOf(item.ref)
  const pdfCapability = pdfCapabilityOf(item)
  const pdfRef = pdfRefOf(pdfCapability)
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
        {selectUrl !== null &&
          (verdict === 'blocked' ? (
            <BlockedOpenAction label={t('openInZotero')} t={t} />
          ) : (
            <ZoteroOpenLink url={selectUrl} verdict={verdict} label={t('openInZotero')} t={t} />
          ))}
        {pdfCapability !== null &&
          (verdict === 'blocked' ? (
            <BlockedOpenAction label={t('openPdf')} t={t} />
          ) : (
            <ZoteroOpenLink url={pdfCapability.url} verdict={verdict} label={t('openPdf')} t={t} />
          ))}
        <CopyButton value={item.ref} label={t('copyRef')} copiedLabel={t('copied')} />
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
              {t('availabilityEntry', {
                source: t(sourceLabelKeyOf(source)),
                detail: availabilityLineOf(entry, t),
              })}
            </li>
          ))}
        </ul>
      )}
      {item.retrievalFacts !== undefined && item.evidence.length === 0 && (
        <p className={css.note}>{emptyEvidenceNoteOf(item.facts.reportedEvidenceCount, t)}</p>
      )}
    </section>
  )
}
