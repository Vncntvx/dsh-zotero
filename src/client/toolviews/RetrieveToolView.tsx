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
import { errorSummaryOf, metaOf, resultTextOf } from '../presenters.ts'
import { RawTextFallback, RunningNotice, ZoteroToolRow } from './ZoteroToolRow.tsx'
import css from './toolviews.module.css'

export type RetrieveToolViewProps = PropsRuntime<'tool.call.toolview', 'zotero_retrieve'> &
  PropsLocale<'zotero'>

export function RetrieveToolView(props: RetrieveToolViewProps) {
  const { toolName, block, useDisclosure, inspect, t } = props

  const { summary, errorSummary, items, coverageLine, rawText } = useMemo(() => {
    const raw = (resultTextOf(block) ?? '').trim()
    const errSummary = errorSummaryOf(block, raw)
    const meta = metaOf(block)
    const retrieveView = meta !== null ? retrieveMetaOf(meta) : null

    let sum = ''
    if ('phase' in block && block.phase === 'start') {
      sum = t('toolRetrieveRunning')
    } else if (retrieveView?.items !== null && retrieveView?.items !== undefined) {
      sum = t('toolSummaryEvidence', { count: retrieveView.items.length })
    } else {
      sum = t('toolTitleRetrieve')
    }

    const covLine = retrieveView?.coverage ? coverageLineOf(retrieveView.coverage, t) : null
    const mappedItems = (retrieveView?.items ?? []).map((item) => ({
      ...item,
      selectUrl: selectUrlOf(item.sourceRef),
      pdfUrl: item.attachmentRef ? pdfUrlOf(item.attachmentRef, { page: item.pageLabel }) : null,
    }))

    return {
      summary: sum,
      errorSummary: errSummary,
      items: mappedItems,
      coverageLine: covLine,
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
      icon={<IconBrowseOutlineRegular size={14} />}
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

            {items.length > 0 ? (
              <div className={css.cardList}>
                {items.map((item, index) => (
                  <div key={`${item.sourceRef}-${index}`} className={css.evidenceItem}>
                    <div className={css.evidenceHeader}>
                      <div className={css.evidenceBadges}>
                        <span
                          className={css.badge}
                          data-tone={item.source === 'pdf' ? 'pdf' : 'info'}
                        >
                          {t(sourceLabelKeyOf(item.source))}
                        </span>
                        {item.pageLabel && <span className={css.badge}>{item.pageLabel}</span>}
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
