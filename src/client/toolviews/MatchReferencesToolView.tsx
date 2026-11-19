import { ToolItemRow } from './ToolItemRow.tsx'
/** Compact card for local reference reconciliation results. */

import { useMemo } from 'react'
import { IconSearchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  argsViewOf,
  errorSummaryOf,
  isToolRunning,
  metaOf,
  resultTextOf,
  valueArg,
} from '../../sources/presenters.js'
import { matchReferencesMetaOf } from '../../sources/decoders.js'
import { RunningNotice, RawTextFallback, ZoteroToolRow } from './ZoteroToolRow.tsx'
import { CitationKeyConflictNotice } from '../components/CitationKeyConflictNotice.tsx'
import css from './toolviews.module.css'

type Props = PropsRuntime<'tool.call.toolview', 'zotero_match_references'> & PropsLocale<'zotero'>

export function MatchReferencesToolView(props: Props) {
  const { block, toolName, useDisclosure, inspect, t } = props
  const icon = useMemo(() => <IconSearchOutlineRegular size={14} />, [])
  const view = useMemo(() => {
    const refs = valueArg(argsViewOf(block), 'references')
    const decoded = matchReferencesMetaOf(
      metaOf(block) ?? {},
      Array.isArray(refs) ? refs.length : 0,
    )
    const raw = (resultTextOf(block) ?? '').trim()
    const rows = decoded.items?.filter((row) => row.inputId) ?? []
    return { ...decoded, rows, raw, error: errorSummaryOf(block, raw) }
  }, [block])

  return (
    <ZoteroToolRow
      toolName={toolName}
      block={block}
      useDisclosure={useDisclosure}
      inspect={inspect}
      t={t}
      icon={icon}
      title={t('toolTitleMatchReferences')}
      summary={
        isToolRunning(block)
          ? t('toolMatchReferencesRunning')
          : view.matched === undefined
            ? t('toolTitleMatchReferences')
            : t('toolSummaryMatchReferences', { matched: view.matched, input: view.requested })
      }
      errorSummary={view.error}
    >
      {({ isRunning }) =>
        isRunning ? (
          <RunningNotice text={t('toolMatchReferencesRunning')} />
        ) : (
          <>
            {view.detailOmitted && (
              <div className={css.coverageNotice}>{t('detailOmittedNote')}</div>
            )}
            <div className={css.cardList}>
              {view.rows.map((row, index) => (
                <ToolItemRow
                  data-match-row
                  key={`${row.inputId}-${index}`}
                  title={<>{row.inputId}</>}
                  trailing={
                    <>
                      <span className={css.itemMeta}>{row.status}</span>
                    </>
                  }
                >
                  {row.reason && <div className={css.coverageNotice}>{row.reason}</div>}
                  {(row.selected.length > 0 ? row.selected : row.candidates).map(
                    (candidate, index) => (
                      <div key={`${candidate.ref ?? ''}-${index}`}>
                        <div className={css.itemMeta}>
                          {[
                            candidate.ref,
                            candidate.citationKey &&
                              t('toolCitationKeyField', { key: candidate.citationKey }),
                            candidate.exportKey &&
                              t('toolExportKeyField', { key: candidate.exportKey }),
                            candidate.title,
                            candidate.matchMethod,
                            candidate.confidence,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                        {/* The stricter both-fields-truthy guard stays: an empty
                        field renders as nothing, as before. */}
                        {candidate.citationKeyConflict?.native &&
                          candidate.citationKeyConflict.extra && (
                            <CitationKeyConflictNotice
                              conflict={candidate.citationKeyConflict}
                              t={t}
                            />
                          )}
                      </div>
                    ),
                  )}
                </ToolItemRow>
              ))}
              {view.omitted > 0 && (
                <div className={css.coverageNotice}>
                  {t('omittedRowsNote', { count: view.omitted })}
                </div>
              )}
              {(view.rows.length === 0 ||
                view.omitted > 0 ||
                view.detailOmitted ||
                view.rows.length < view.requested ||
                view.rows.length !== view.items?.length) &&
                view.raw && (
                  <RawTextFallback
                    text={view.raw}
                    copyLabel={t('copy')}
                    copiedLabel={t('copied')}
                  />
                )}
            </div>
            {view.rows.length === 0 && !view.raw && !view.detailOmitted && view.omitted === 0 && (
              <div className={css.coverageNotice}>{t('toolMatchCandidatesEmpty')}</div>
            )}
          </>
        )
      }
    </ZoteroToolRow>
  )
}
