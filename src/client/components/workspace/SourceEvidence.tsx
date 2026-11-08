/**
 * The inspector's passages panel: one source's retrieved passages rendered
 * as rich passage cards with reader-scale typography, page labels,
 * jump-to-sidebar PDF actions, and grounding relation notes.
 * Facts only; nothing here implies the final answer used the passages.
 * @module dsh-zotero/client/components/workspace/SourceEvidence
 */

import { Button, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroAttachmentLocationView } from '../../../contract.ts'
import type { EvidencePassage, SourceItem } from '../../../sources/model.js'
import { emptyEvidenceNoteOf, sourceLabelKeyOf } from '../../evidence-labels.ts'
import css from './workspace.module.css'

/** The summary line of one item's retrieves: runs, kept, reported, truncated. */
export function retrievalSummaryLineOf(item: SourceItem, t: TranslateNS<'zotero'>): string {
  const summary = item.retrievalSummary
  if (summary === undefined) return ''
  const parts = [
    t('retrievalRunCount', { count: summary.runCount }),
    t('retrievalKeptCount', { count: item.evidenceTotal }),
    t('retrievalReportedCount', { count: item.facts.reportedEvidenceCount }),
  ]
  if (summary.truncated) parts.push(t('budgetLimitedNote'))
  return parts.join(' · ')
}

interface SourceEvidenceProps {
  readonly item: SourceItem
  readonly t: TranslateNS<'zotero'>
  readonly openFile?: (path: string) => void
  readonly resolveAttachment?: (ref: string) => Promise<RemoteResult<ZoteroAttachmentLocationView>>
}

interface PassageCardProps {
  readonly passage: EvidencePassage
  readonly item: SourceItem
  readonly openFile?: (path: string) => void
  readonly resolveAttachment?: (ref: string) => Promise<RemoteResult<ZoteroAttachmentLocationView>>
  readonly t: TranslateNS<'zotero'>
}

/** One rich passage card with its source tag, page label, jump action, and grounding context. */
function PassageCard({ passage, item, openFile, resolveAttachment, t }: PassageCardProps) {
  const targetPdfRef =
    passage.attachmentRef ?? item.retrievalFacts?.attachmentRef ?? item.attachment?.ref
  const filePath = item.attachment?.location

  const handleJump = async () => {
    if (filePath && openFile) {
      openFile(filePath)
      return
    }
    if (targetPdfRef && resolveAttachment && openFile) {
      const res = await resolveAttachment(targetPdfRef)
      if (res.ok && res.value.kind === 'file' && res.value.path) {
        openFile(res.value.path)
      }
    }
  }

  return (
    <article className={css.passageCard} data-source={passage.source}>
      <div className={css.passageHeader}>
        <div className={css.passageBadgeRow}>
          <Tag tone="neutral">{t(sourceLabelKeyOf(passage.source))}</Tag>
          {passage.pageLabel !== undefined && (
            <span className={css.note}>{t('pageLabel', { label: passage.pageLabel })}</span>
          )}
        </div>
        {targetPdfRef !== undefined && openFile !== undefined && (
          <Button
            variant="ghost"
            size="sm"
            className={css.jumpButton}
            onClick={() => {
              void handleJump()
            }}
          >
            {t('jumpToPageInSidebar')}
          </Button>
        )}
      </div>

      <blockquote className={css.quoteBody}>
        “{passage.text}”{passage.previewTruncated ? ` ${t('truncatedPreview')}` : ''}
      </blockquote>

      {passage.callIds.length > 1 && (
        <p className={css.note}>{t('retrievedMultiple', { count: passage.callIds.length })}</p>
      )}

      {passage.callIds.length > 0 && (
        <div className={css.groundingContext}>
          <span className={css.groundingDot} />
          <span>{t('groundingRelationHint', { calls: passage.callIds.length })}</span>
        </div>
      )}
    </article>
  )
}

/** The passages feed: summary head and the list of rich passage cards. */
export function SourceEvidence({ item, t, openFile, resolveAttachment }: SourceEvidenceProps) {
  if (item.retrievalFacts === undefined) {
    return (
      <div className={css.panel}>
        <p className={css.note}>{t('evidenceNotRetrieved')}</p>
      </div>
    )
  }

  const summaryLine = retrievalSummaryLineOf(item, t)

  return (
    <div className={css.panel}>
      {summaryLine !== '' && <p className={css.summaryLine}>{summaryLine}</p>}
      {item.evidence.length === 0 ? (
        <p className={css.note}>{emptyEvidenceNoteOf(item.facts.reportedEvidenceCount, t)}</p>
      ) : (
        <div className={css.passages}>
          {item.evidence.map((passage, index) => (
            <PassageCard
              key={`${passage.sourceRef}-${index}`}
              passage={passage}
              item={item}
              openFile={openFile}
              resolveAttachment={resolveAttachment}
              t={t}
            />
          ))}
        </div>
      )}
      {item.evidenceTotal > item.evidence.length && (
        <p className={css.note}>{t('evidenceOmittedNote', { count: item.evidenceTotal })}</p>
      )}
    </div>
  )
}
