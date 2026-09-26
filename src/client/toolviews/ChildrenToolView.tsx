/**
 * Dedicated toolview card for `zotero_children` and `zotero_attachment`.
 * Renders child notes, PDF attachments, and deep links.
 * @module dsh-zotero/client/toolviews/ChildrenToolView
 */

import { useMemo } from 'react'
import { IconLinkOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { attachmentMetaOf } from '../sources/decoders.ts'
import { pdfUrlOf } from '../actions/open-zotero.ts'
import { ZoteroOpenLink } from '../components/open/ZoteroOpenLink.tsx'
import {
  argsOf,
  errorSummaryOf,
  isRecord,
  metaOf,
  resultTextOf,
  stringField,
} from '../presenters.ts'
import { RawTextFallback, RunningNotice, ZoteroToolRow } from './ZoteroToolRow.tsx'
import css from './toolviews.module.css'

export type ChildrenToolViewProps = PropsRuntime<
  'tool.call.toolview',
  'zotero_children' | 'zotero_attachment'
> &
  PropsLocale<'zotero'>

export function ChildrenToolView(props: ChildrenToolViewProps) {
  const { toolName, block, useDisclosure, inspect, t } = props

  const isAttachment = toolName === 'zotero_attachment'
  const title = isAttachment ? t('toolTitleAttachment') : t('toolTitleChildren')

  const { ref, summary, errorSummary, attachView, pdfUrl, rawText } = useMemo(() => {
    const args = argsOf(block)
    const itemRef = stringField(args ?? {}, 'ref') ?? ''
    const meta = metaOf(block)
    const attachmentView = isAttachment && meta !== null ? attachmentMetaOf(meta) : null
    const raw = (resultTextOf(block) ?? '').trim()

    let sum = ''
    if ('phase' in block && block.phase === 'start') {
      sum = itemRef || title
    } else if (attachmentView?.title) {
      sum = t('toolSummaryAttachment', { title: attachmentView.title })
    } else if (!isAttachment && meta) {
      let totalCount = 0
      let hasCount = false
      for (const key of ['notes', 'attachments', 'annotations'] as const) {
        const val = meta[key]
        const sec = isRecord(val) ? val : null
        if (typeof sec?.total === 'number') {
          totalCount += sec.total
          hasCount = true
        }
      }
      sum = hasCount ? t('toolSummaryChildren', { count: totalCount }) : itemRef || title
    } else {
      sum = itemRef || title
    }

    const errSummary = errorSummaryOf(block, raw)
    const pUrl = attachmentView?.ref ? pdfUrlOf(attachmentView.ref) : null

    return {
      ref: itemRef,
      summary: sum,
      errorSummary: errSummary,
      attachView: attachmentView,
      pdfUrl: pUrl,
      rawText: raw,
    }
  }, [block, isAttachment, t, title])

  return (
    <ZoteroToolRow
      toolName={toolName}
      block={block}
      useDisclosure={useDisclosure}
      inspect={inspect}
      t={t}
      icon={<IconLinkOutlineMedium size={14} />}
      title={title}
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
            {attachView && (
              <div className={css.itemCard}>
                <div className={css.itemHeader}>
                  {attachView.kind && (
                    <span className={css.badge}>{attachView.kind.toUpperCase()}</span>
                  )}
                  {attachView.contentType && (
                    <span className={css.badge} data-tone="pdf">
                      {attachView.contentType}
                    </span>
                  )}
                  <span className={css.itemTitle}>{attachView.title ?? ref}</span>
                </div>
                {attachView.location && <div className={css.itemMeta}>{attachView.location}</div>}
                <div className={css.itemActions}>
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
            )}

            {rawText && <RawTextFallback text={rawText} />}
          </>
        )
      }}
    </ZoteroToolRow>
  )
}
