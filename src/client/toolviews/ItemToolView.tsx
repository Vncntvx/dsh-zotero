/**
 * Dedicated toolview card for `zotero_get`.
 * Renders paper metadata, publication venues, attachments, and Zotero open links.
 * @module dsh-zotero/client/toolviews/ItemToolView
 */

import { useMemo } from 'react'
import { IconDeliverDocRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { getMetaOf } from '../sources/decoders.ts'
import { pdfUrlOf, selectUrlOf } from '../actions/open-zotero.ts'
import { ZoteroOpenLink } from '../components/open/ZoteroOpenLink.tsx'
import { argsOf, errorSummaryOf, metaOf, resultTextOf, stringField } from '../presenters.ts'
import { RawTextFallback, RunningNotice, ZoteroToolRow } from './ZoteroToolRow.tsx'
import css from './toolviews.module.css'

export type ItemToolViewProps = PropsRuntime<'tool.call.toolview', 'zotero_get'> &
  PropsLocale<'zotero'>

export function ItemToolView(props: ItemToolViewProps) {
  const { toolName, block, useDisclosure, inspect, t } = props

  const { ref, summary, errorSummary, getItemView, selectUrl, pdfUrl, rawText } = useMemo(() => {
    const args = argsOf(block)
    const itemRef = stringField(args ?? {}, 'ref') ?? ''
    const meta = metaOf(block)
    const view = meta !== null ? getMetaOf(meta) : null
    const raw = (resultTextOf(block) ?? '').trim()

    let sum = ''
    if ('phase' in block && block.phase === 'start') {
      sum = itemRef || t('toolTitleGet')
    } else if (view?.title) {
      sum =
        view.year !== null && view.year !== undefined && !view.title.includes(String(view.year))
          ? t('toolSummaryItem', {
              title: view.title,
              year: String(view.year),
            })
          : view.title
    } else {
      sum = itemRef || t('toolTitleGet')
    }

    const errSummary = errorSummaryOf(block, raw)
    const sUrl = itemRef ? selectUrlOf(itemRef) : null
    const pUrl = view?.bestAttachment?.ref ? pdfUrlOf(view.bestAttachment.ref) : null

    return {
      ref: itemRef,
      summary: sum,
      errorSummary: errSummary,
      getItemView: view,
      selectUrl: sUrl,
      pdfUrl: pUrl,
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
      icon={<IconDeliverDocRegular size={14} />}
      title={t('toolTitleGet')}
      summary={summary}
      summarySuffix={null}
      errorSummary={errorSummary}
    >
      {({ isRunning }) => {
        if (isRunning) {
          return <RunningNotice text={t('toolRunning')} />
        }

        return (
          <>
            <div className={css.itemCard}>
              <div className={css.itemHeader}>
                {getItemView?.year !== null && getItemView?.year !== undefined && (
                  <span className={css.badge}>{getItemView.year}</span>
                )}
                {getItemView?.bestAttachment && (
                  <span className={css.badge} data-tone="pdf">
                    {t('badgePdf')}
                  </span>
                )}
                <span className={css.itemTitle}>{getItemView?.title ?? ref}</span>
              </div>

              {getItemView?.creators && <div className={css.itemMeta}>{getItemView.creators}</div>}
              {getItemView?.venue && <div className={css.itemMeta}>{getItemView.venue}</div>}

              <div className={css.itemActions}>
                {selectUrl && (
                  <ZoteroOpenLink
                    url={selectUrl}
                    verdict="open"
                    label={t('openInZotero')}
                    t={t}
                    className={css.actionLink}
                  />
                )}
                {pdfUrl && (
                  <ZoteroOpenLink
                    url={pdfUrl}
                    verdict="open"
                    label={t('openPdf')}
                    t={t}
                    className={css.actionLink}
                  />
                )}
              </div>
            </div>

            {rawText && <RawTextFallback text={rawText} />}
          </>
        )
      }}
    </ZoteroToolRow>
  )
}
