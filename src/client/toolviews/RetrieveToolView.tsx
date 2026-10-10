/**
 * Dedicated toolview card for `zotero_retrieve`.
 * Renders extracted evidence passages, source badges, page numbers, and copy actions.
 * @module dsh-zotero/client/toolviews/RetrieveToolView
 */

import { useMemo } from 'react'
import { IconBrowseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { retrieveMetaOf } from '../sources/decoders.ts'
import { pdfUrlOf, selectUrlOf } from '../actions/open-zotero.ts'
import { ZoteroOpenLink } from '../components/open/ZoteroOpenLink.tsx'
import { coverageLineOf, sourceLabelKeyOf } from '../evidence-labels.ts'
import { CopyButton } from '../components/CopyButton.tsx'
import { errorSummaryOf, isToolRunning, metaOf, resultTextOf } from '../presenters.ts'
import { RawTextFallback, RunningNotice, ZoteroToolRow } from './ZoteroToolRow.tsx'
import css from './toolviews.module.css'

export type RetrieveToolViewProps = PropsRuntime<'tool.call.toolview', 'zotero_retrieve'> &
  PropsLocale<'zotero'>

export function RetrieveToolView(props: RetrieveToolViewProps) {
  const { toolName, block, useDisclosure, inspect, t } = props

  const { icon, summary, errorSummary, items, coverageLine, omittedNote, detailOmitted, rawText } =
    useMemo(() => {
      const raw = (resultTextOf(block) ?? '').trim()
      const errSummary = errorSummaryOf(block, raw)
      const meta = metaOf(block)
      const retrieveView = meta !== null ? retrieveMetaOf(meta) : null

      let sum = ''
      if (isToolRunning(block)) {
        sum = t('toolRetrieveRunning')
      } else if (retrieveView?.items !== null && retrieveView?.items !== undefined) {
        // `items` is the bounded page the card draws, capped at four regardless of
        // `maxEvidencePassages`; `count` is the call's own total. Counting rows
        // would report "4 passages" over a body listing 4 of 20, the same
        // bounded-listing mistake the search card had.
        sum = t('toolSummaryEvidence', { count: retrieveView.count ?? retrieveView.items.length })
      } else {
        sum = t('toolTitleRetrieve')
      }

      const covLine = retrieveView?.coverage ? coverageLineOf(retrieveView.coverage, t) : null
      // Passages the call found but the projection could not carry. The card
      // cannot show them, and a reader who sees "20 passages" above four rows
      // deserves to be told the four are all the card kept.
      const shown = retrieveView?.items?.length ?? 0
      const omitted =
        retrieveView?.count != null && retrieveView.count > shown ? retrieveView.count - shown : 0
      const omittedNote = omitted > 0 ? t('toolOmittedPassages', { count: omitted }) : null
      const mappedItems = (retrieveView?.items ?? []).map((item) => ({
        ...item,
        selectUrl: selectUrlOf(item.sourceRef),
        pdfUrl: item.attachmentRef ? pdfUrlOf(item.attachmentRef, { page: item.pageLabel }) : null,
      }))

      return {
        // The icon rides the memo with the rest of the header, so a re-render
        // that leaves this call's facts alone reuses the same node and the
        // memo'd `DisclosureRow` above it can skip the work.
        icon: <IconBrowseOutlineRegular size={14} />,
        summary: sum,
        errorSummary: errSummary,
        items: mappedItems,
        coverageLine: covLine,
        omittedNote,
        detailOmitted: retrieveView?.detailOmitted === true,
        rawText: raw,
      }
    }, [block, t])

  return (
    <ZoteroToolRow
      toolName={toolName}
      block={block}
      useDisclosure={useDisclosure}
      inspect={inspect}
      t={t}
      icon={icon}
      title={t('toolTitleRetrieve')}
      summary={summary}
      summarySuffix={null}
      errorSummary={errorSummary}
    >
      {({ isRunning }) => {
        if (isRunning) {
          return <RunningNotice text={t('toolRetrieveRunning')} />
        }

        return (
          <>
            {coverageLine && <div className={css.coverageNotice}>{coverageLine}</div>}

            {/* The projection is capped independently of the call's own count,
                so a card that listed the cap in its summary would leave the
                reader unable to tell a short answer from a truncated one. */}
            {omittedNote && <div className={css.coverageNotice}>{omittedNote}</div>}

            {detailOmitted && <div className={css.coverageNotice}>{t('detailOmittedNote')}</div>}

            {items.length > 0 ? (
              <div className={css.cardList}>
                {items.map((item, index) => (
                  <div key={`${item.sourceRef}-${index}`} className={css.evidenceItem}>
                    <div className={css.evidenceHeader}>
                      <div className={css.evidenceBadges}>
                        <span
                          className={css.badge}
                          data-tone={item.source === 'fulltext' ? 'pdf' : 'info'}
                        >
                          {t(sourceLabelKeyOf(item.source))}
                        </span>
                        {item.pageLabel && <span className={css.badge}>{item.pageLabel}</span>}
                        {/* A match found only in the annotator's own comment is
                            the annotator's view, not the paper's text; the
                            badge says which field carried the query. */}
                        {item.matchedFields?.map((field) => (
                          <span key={field} className={css.badge} data-tone="warning">
                            {t(field === 'comment' ? 'matchedInComment' : 'matchedInText')}
                          </span>
                        ))}
                      </div>
                      <div className={css.itemActions}>
                        <CopyButton
                          value={item.preview}
                          label={t('copy')}
                          copiedLabel={t('copied')}
                          className={css.lineAction}
                        />
                        {item.pdfUrl && (
                          <ZoteroOpenLink
                            url={item.pdfUrl}
                            verdict="open"
                            label={t('openPdf')}
                            t={t}
                            className={css.actionLink}
                          />
                        )}
                        {item.selectUrl && (
                          <ZoteroOpenLink
                            url={item.selectUrl}
                            verdict="open"
                            label={t('openInZotero')}
                            t={t}
                            className={css.actionLink}
                          />
                        )}
                      </div>
                    </div>
                    <div className={css.evidenceText}>
                      {item.preview}
                      {item.previewTruncated ? ` ${t('truncatedPreview')}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            ) : rawText ? (
              <RawTextFallback text={rawText} />
            ) : (
              <div className={css.coverageNotice}>{t('toolNoResults')}</div>
            )}
          </>
        )
      }}
    </ZoteroToolRow>
  )
}
