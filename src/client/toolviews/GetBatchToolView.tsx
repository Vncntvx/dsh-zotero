import { ToolItemRow } from './ToolItemRow.tsx'
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
import { getBatchMetaOf } from '../../sources/decoders.js'
import { RunningNotice, RawTextFallback, ZoteroToolRow } from './ZoteroToolRow.tsx'
import css from './toolviews.module.css'

type Props = PropsRuntime<'tool.call.toolview', 'zotero_get_batch'> & PropsLocale<'zotero'>

export function GetBatchToolView(props: Props) {
  const { block, toolName, useDisclosure, inspect, t } = props
  const icon = useMemo(() => <IconDeliverDocRegular size={14} />, [])
  const view = useMemo(() => {
    const decoded = getBatchMetaOf(metaOf(block) ?? {}, listArg(argsViewOf(block), 'refs'))
    const raw = (resultTextOf(block) ?? '').trim()
    return {
      ...decoded,
      rows: [...(decoded.rows?.values() ?? [])],
      raw,
      error: errorSummaryOf(block, raw),
    }
  }, [block])

  const summary =
    view.succeeded === undefined || view.failed === undefined
      ? t('toolSummaryGetBatch', { requested: view.requested })
      : t('toolSummaryGetBatchDone', {
          succeeded: view.succeeded,
          requested: view.requested,
          failed: view.failed,
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
        ) : (
          <>
            {view.rows.length > 0 && (
              <div className={css.cardList}>
                {view.rows.map((row, index) => (
                  <ToolItemRow
                    data-batch-row
                    key={`${row.ref}-${index}`}
                    title={<>{row.title ?? row.ref}</>}
                    trailing={
                      <>
                        <span className={css.itemMeta}>
                          {row.status === 'ok'
                            ? (row.citationKey ?? t('toolGetBatchRowOk'))
                            : row.status === 'error'
                              ? (row.code ?? t('toolGetBatchRowError'))
                              : null}
                        </span>
                      </>
                    }
                  >
                    {row.status === 'error' && row.message && (
                      <div className={css.coverageNotice}>{row.message}</div>
                    )}
                    <div className={css.itemMeta}>{row.ref}</div>
                  </ToolItemRow>
                ))}
              </div>
            )}
            {view.omitted > 0 && (
              <div className={css.coverageNotice}>
                {t('omittedRowsNote', { count: view.omitted })}
              </div>
            )}
            {(view.rows.length === 0 || view.omitted > 0 || view.detailOmitted) && view.raw && (
              <RawTextFallback text={view.raw} copyLabel={t('copy')} copiedLabel={t('copied')} />
            )}
          </>
        )
      }
    </ZoteroToolRow>
  )
}
