/** Compact card for local reference reconciliation results. */

import { useMemo } from 'react'
import { IconSearchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { argsViewOf, errorSummaryOf, isToolRunning, metaOf, resultTextOf } from '../presenters.ts'
import { isRecord, numberField, stringField } from '../../json.ts'
import { RunningNotice, RawTextFallback, ZoteroToolRow } from './ZoteroToolRow.tsx'
import css from './toolviews.module.css'

type Props = PropsRuntime<'tool.call.toolview', 'zotero_match_references'> & PropsLocale<'zotero'>

export function MatchReferencesToolView(props: Props) {
  const { block, toolName, useDisclosure, inspect, t } = props
  const icon = useMemo(() => <IconSearchOutlineRegular size={14} />, [])
  const view = useMemo(() => {
    const args = argsViewOf(block)
    const argsRecord = args as unknown as Record<string, unknown>
    const input = Array.isArray(argsRecord['references']) ? argsRecord['references'].length : 0
    const meta = metaOf(block)
    const items =
      meta !== null && Array.isArray(meta['items']) ? meta['items'].filter(isRecord) : []
    const inputCount = meta === null ? 0 : (numberField(meta, 'requested') ?? items.length)
    const rows = items
      .map((item) => {
        const selected = isRecord(item['selected']) ? item['selected'] : null
        const rawCandidates = Array.isArray(item['candidates'])
          ? item['candidates'].filter(isRecord)
          : []
        const candidates = selected !== null ? [selected] : rawCandidates
        return {
          inputId: stringField(item, 'inputId') ?? '',
          status: stringField(item, 'status') ?? 'unknown',
          reason: stringField(item, 'reason'),
          candidates: candidates.map((candidate) => ({
            ref: stringField(candidate, 'ref'),
            title: stringField(candidate, 'title'),
            citationKey: stringField(candidate, 'citationKey'),
            exportKey: stringField(candidate, 'exportKey'),
            matchMethod: stringField(candidate, 'matchMethod'),
            confidence: stringField(candidate, 'confidence'),
            citationKeyConflict: isRecord(candidate['citationKeyConflict'])
              ? {
                  native: stringField(candidate['citationKeyConflict'], 'native'),
                  extra: stringField(candidate['citationKeyConflict'], 'extra'),
                }
              : null,
          })),
        }
      })
      .filter((item) => item.inputId !== '')
    const matched =
      meta === null
        ? 0
        : (numberField(meta, 'matched') ??
          items.filter((item) => item['status'] === 'matched').length)
    const raw = (resultTextOf(block) ?? '').trim()
    return { input: inputCount || input, matched, rows, raw, error: errorSummaryOf(block, raw) }
  }, [block])

  return (
    <ZoteroToolRow
      toolName={toolName}
      block={block}
      useDisclosure={useDisclosure}
      inspect={inspect}
      t={t}
      icon={icon}
      title="Match Zotero references"
      summary={
        isToolRunning(block)
          ? 'Matching local references'
          : `${view.matched} matched of ${view.input}`
      }
      errorSummary={view.error}
    >
      {({ isRunning }) =>
        isRunning ? (
          <RunningNotice text="Matching local references" />
        ) : view.rows.length > 0 ? (
          <div className={css.cardList}>
            {view.rows.map((row) => (
              <div className={css.itemCard} data-match-row key={row.inputId}>
                <div className={css.itemHeader}>
                  <span className={css.itemTitle}>{row.inputId}</span>
                  <span className={css.itemMeta}>{row.status}</span>
                </div>
                {row.reason && <div className={css.coverageNotice}>{row.reason}</div>}
                {row.candidates.map((candidate, index) => (
                  <div key={`${candidate.ref ?? 'candidate'}-${index}`}>
                    <div className={css.itemMeta}>
                      {[
                        candidate.ref,
                        candidate.citationKey && `citationKey=${candidate.citationKey}`,
                        candidate.exportKey && `exportKey=${candidate.exportKey}`,
                        candidate.title,
                        candidate.matchMethod,
                        candidate.confidence,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                    {candidate.citationKeyConflict?.native &&
                      candidate.citationKeyConflict.extra && (
                        <div className={css.coverageNotice}>
                          Citation key conflict: native={candidate.citationKeyConflict.native};
                          extra={candidate.citationKeyConflict.extra}
                        </div>
                      )}
                  </div>
                ))}
              </div>
            ))}
            {view.raw && <RawTextFallback text={view.raw} />}
          </div>
        ) : view.raw ? (
          <RawTextFallback text={view.raw} />
        ) : (
          <div className={css.coverageNotice}>No reference matches returned.</div>
        )
      }
    </ZoteroToolRow>
  )
}
