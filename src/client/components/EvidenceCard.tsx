/**
 * One source's evidence card: the header with the in-app PDF read action and
 * the clipboard locate actions (the read is gated when the item's
 * evidenceMatch is a mismatch, the clipboard actions never are), the indexing
 * coverage line, the budget note, the deduplicated passages with their source
 * tags and page labels, and the per-source availability lines. Everything
 * here is provable session facts: the panel never claims the passages
 * supported the answer.
 * @module dsh-zotero/client/components/EvidenceCard
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroAttachmentLocationView } from '../../contract.ts'
import { joinNonEmpty, shortKeyOf } from '../presenters.ts'
import { pdfUrlOf, selectUrlOf } from '../actions/open-zotero.ts'
import {
  availabilityLineOf,
  coverageLineOf,
  emptyEvidenceNoteOf,
  sourceLabelKeyOf,
} from '../evidence-labels.ts'
import type { EvidenceMatchStatus, EvidencePassage, SourceItem } from '../sources/model.ts'
import { pdfCapabilityOf, type PdfCapability } from '../sources/source-capabilities.ts'
import { CopyButton } from './CopyButton.tsx'
import { BlockedReadAction } from './open/BlockedReadAction.tsx'
import { PdfReadButton } from './open/PdfReadButton.tsx'
import { ZoteroLocateActions } from './open/ZoteroLocateActions.tsx'
import css from './cards.module.css'

/** One deduplicated passage with its tags and optional annotation deep link. */
function PassageRow({
  passage,
  pdfRef,
  pdfFilePath,
  evidenceMatch,
  onOpenFile,
  resolveAttachment,
  t,
}: {
  readonly passage: EvidencePassage
  /** The source's file-PDF ref; annotation jumps prefer the passage's own parent attachment. */
  readonly pdfRef: string | null
  readonly pdfFilePath?: string
  readonly evidenceMatch: EvidenceMatchStatus
  readonly onOpenFile?: (path: string) => void
  readonly resolveAttachment?: (ref: string) => Promise<RemoteResult<ZoteroAttachmentLocationView>>
  readonly t: TranslateNS<'zotero'>
}) {
  const targetPdfRef = passage.attachmentRef ?? pdfRef
  const targetFilePath = targetPdfRef === pdfRef ? pdfFilePath : undefined
  const annotationKey = passage.source === 'annotation' ? shortKeyOf(passage.sourceRef) : null
  const annotationUrl =
    annotationKey !== null && targetPdfRef !== null
      ? pdfUrlOf(targetPdfRef, { annotation: annotationKey })
      : null
  return (
    <li className={css.passage} data-source={passage.source}>
      <p className={css.passageHead}>
        <span className={css.sourceTag}>{t(sourceLabelKeyOf(passage.source))}</span>
        {passage.pageLabel !== undefined && (
          <span className={css.note}>{t('pageLabel', { label: passage.pageLabel })}</span>
        )}
        {targetPdfRef !== null &&
          (evidenceMatch === 'mismatch' ? (
            <BlockedReadAction label={t('readPdf')} t={t} className={css.link} />
          ) : (
            <PdfReadButton
              attachmentRef={targetPdfRef}
              filePath={targetFilePath}
              onOpenFile={onOpenFile}
              resolveAttachment={resolveAttachment}
              t={t}
              variant="link"
              className={css.link}
            />
          ))}
        {annotationUrl !== null && (
          <CopyButton
            value={annotationUrl}
            label={t('copyZoteroLink')}
            copiedLabel={t('copied')}
            title={t('copyZoteroLinkTooltip')}
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
  readonly openFile?: (path: string) => void
  readonly onOpenFile?: (path: string) => void
  readonly resolveAttachment?: (ref: string) => Promise<RemoteResult<ZoteroAttachmentLocationView>>
}

/** The source's file-PDF ref for annotation jumps; a web PDF cannot jump to annotations. */
function pdfRefOf(capability: PdfCapability | null): string | null {
  return capability !== null && capability.kind === 'file' ? capability.ref : null
}

/** One source's evidence card. */
export function EvidenceCard({
  item,
  t,
  openFile,
  onOpenFile,
  resolveAttachment,
}: EvidenceCardProps) {
  const handleOpenFile = openFile ?? onOpenFile
  const evidenceMatch = item.evidenceMatch
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
    <section className={css.card} data-evidence-match={item.evidenceMatch}>
      <header className={css.cardHead}>
        <span className={css.cardTitle}>{item.title ?? item.ref}</span>
        <span className={css.note}>{joinNonEmpty(item.creators, item.year)}</span>
        {pdfCapability !== null &&
          (evidenceMatch === 'mismatch' ? (
            <BlockedReadAction label={t('readPdf')} t={t} className={css.link} />
          ) : (
            <PdfReadButton
              capability={pdfCapability}
              onOpenFile={handleOpenFile}
              resolveAttachment={resolveAttachment}
              t={t}
              variant="link"
              className={css.link}
            />
          ))}
        {selectUrl !== null && (
          <ZoteroLocateActions
            title={item.title}
            itemRef={item.ref}
            selectUrl={selectUrl}
            t={t}
            variant="link"
            className={css.link}
          />
        )}
        <CopyButton value={item.ref} label={t('copyRef')} copiedLabel={t('copied')} />
        {evidenceMatch === 'unknown' && (
          <span className={css.badge} title={t('instanceUnverified')}>
            {t('instanceUnverified')}
          </span>
        )}
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
            pdfFilePath={pdfCapability?.kind === 'file' ? pdfCapability.filePath : undefined}
            evidenceMatch={evidenceMatch}
            onOpenFile={handleOpenFile}
            resolveAttachment={resolveAttachment}
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
