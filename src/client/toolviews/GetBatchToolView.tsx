/** Compact per-ref result card for `zotero_get_batch`. */

import { useMemo } from 'react'
import { IconDeliverDocRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  argsViewOf,
  errorSummaryOf,
  isToolRunning,
  listArg,
  metaOf,
  resultTextOf,
} from '../../sources/presenters.js'
import { isRecord, numberField, stringField } from '../../json.ts'
import { RunningNotice, RawTextFallback, ZoteroToolRow } from './ZoteroToolRow.tsx'
import css from './toolviews.module.css'

type Props = PropsRuntime<'tool.call.toolview', 'zotero_get_batch'> & PropsLocale<'zotero'>

export function GetBatchToolView(props: Props) {
  const { block, toolName, useDisclosure, inspect, t } = props
  const icon = useMemo(() => <IconDeliverDocRegular size={14} />, [])
  const view = useMemo(() => {
    const meta = metaOf(block)
    const counts = meta !== null && isRecord(meta['counts']) ? meta['counts'] : null
    const rows =
      meta !== null && Array.isArray(meta['items'])
        ? meta['items']
            .filter(isRecord)
            .map((item) => ({
              ref: stringField(item, 'ref') ?? '',
              status: stringField(item, 'status') ?? 'unknown',
              title: stringField(item, 'title'),
              code: stringField(item, 'code'),
              message: stringField(item, 'message'),
              citationKey: stringField(item, 'citationKey'),
            }))
            .filter((item) => item.ref !== '')
        : []
    const raw = (resultTextOf(block) ?? '').trim()
    return {
      rows,
      requested:
        numberField(counts ?? {}, 'requested') ?? listArg(argsViewOf(block), 'refs').length,
      succeeded: numberField(counts ?? {}, 'succeeded'),
      failed: numberField(counts ?? {}, 'failed'),
      raw,
      error: errorSummaryOf(block, raw),
    }
  }, [block])

  const summary =
    view.succeeded === undefined
      ? t('toolSummaryGetBatch', { requested: view.requested })
      : t('toolSummaryGetBatchDone', {
          succeeded: view.succeeded,
          requested: view.requested,
          failed: view.failed ?? 0,
        })

  return (
    <ZoteroToolRow
      toolName={toolName}
      block={block}
      useDisclosure={useDisclosure}
      inspect={inspect}
      t={t}
      icon={icon}
      title={t('toolTitleGetBatch')}
      summary={isToolRunning(block) ? t('toolGetBatchRunning') : summary}
      errorSummary={view.error}
    >
      {({ isRunning }) =>
        isRunning ? (
          <RunningNotice text={t('toolGetBatchRunning')} />
        ) : view.rows.length > 0 ? (
          <div className={css.cardList}>
            {view.rows.map((row, index) => (
              <div className={css.itemCard} data-batch-row key={`${row.ref}-${index}`}>
                <div className={css.itemHeader}>
                  <span className={css.itemTitle}>{row.title ?? row.ref}</span>
                  <span className={css.itemMeta}>
                    {row.status === 'ok'
                      ? (row.citationKey ?? t('toolGetBatchRowOk'))
                      : (row.code ?? t('toolGetBatchRowError'))}
                  </span>
                </div>
                {row.status === 'error' && row.message && (
                  <div className={css.coverageNotice}>{row.message}</div>
                )}
                <div className={css.itemMeta}>{row.ref}</div>
              </div>
            ))}
          </div>
        ) : view.raw ? (
          <RawTextFallback text={view.raw} copyLabel={t('copy')} copiedLabel={t('copied')} />
        ) : null
      }
    </ZoteroToolRow>
  )
}
