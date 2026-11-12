/**
 * The source audit panel: displays the retrieval timeline, indexing coverage
 * progress, and an in-place citation code preview (BibTeX / GB/T 7714) with
 * one-click copy feedback. Rendered in the 3rd column on wide containers and
 * embedded at the bottom of the inspector feed on narrower surfaces.
 * @module dsh-zotero/client/components/workspace/SourceAuditPanel
 */

import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  IconCheckOutlineRegular,
  IconCopyOutlineRegular,
  SegmentedTabs,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ZoteroLibraryExportRequestView,
  ZoteroLibraryExportResultView,
} from '../../../contract.ts'
import type { SourceItem } from '../../../sources/model.js'
import { mapTuple } from '../../segmented-tabs.ts'
import { coverageLineOf } from '../../evidence-labels.ts'
import { messageOf } from '../../error-text.ts'
import { useCopyFeedback } from '../useCopyFeedback.ts'
import { SourcePageControls } from './SourcePageControls.tsx'
import type { SourcePager } from './useSourcePage.ts'
import { filterLineOf, modeLabelOf, scopeLabelOf } from './source-labels.ts'
import css from './workspace.module.css'

type CitationTab = 'bibtex' | 'gbt7714'

const CITATION_TABS: readonly [
  { readonly id: 'bibtex'; readonly key: 'bibtexFormat' },
  { readonly id: 'gbt7714'; readonly key: 'gbt7714Format' },
] = [
  { id: 'bibtex', key: 'bibtexFormat' },
  { id: 'gbt7714', key: 'gbt7714Format' },
]

type CitationState =
  | { readonly key: string; readonly format: CitationTab; readonly phase: 'loading' }
  | {
      readonly key: string
      readonly format: CitationTab
      readonly phase: 'ready'
      readonly text: string
    }
  | { readonly key: string; readonly format: CitationTab; readonly phase: 'denied' }
  | { readonly key: string; readonly format: CitationTab; readonly phase: 'unavailable' }
  | { readonly key: string; readonly format: CitationTab; readonly phase: 'empty' }
  | {
      readonly key: string
      readonly format: CitationTab
      readonly phase: 'error'
      readonly message: string
    }

interface SourceAuditPanelProps {
  readonly item: SourceItem
  readonly t: TranslateNS<'zotero'>
  readonly canExport?: boolean
  readonly exportCitation?: (
    request: ZoteroLibraryExportRequestView,
  ) => Promise<RemoteResult<ZoteroLibraryExportResultView>>
  /** The pager that appends the retrieval episodes behind the timeline's head. */
  readonly pager?: SourcePager
}

function citationRequestOf(ref: string, format: CitationTab): ZoteroLibraryExportRequestView {
  return format === 'bibtex'
    ? { refs: [ref], format: 'bibtex' }
    : {
        refs: [ref],
        format: 'bibliography',
        style: 'china-national-standard-gb-t-7714-2015-numeric',
        locale: 'zh-CN',
      }
}

function citationTextOf(
  expected: CitationTab,
  result: ZoteroLibraryExportResultView,
): string | undefined {
  if (expected === 'bibtex' && result.format === 'bibtex') return result.text.trim() || undefined
  if (expected === 'gbt7714' && result.format === 'bibliography') {
    const document = new DOMParser().parseFromString(result.text, 'text/html')
    return document.body.textContent?.trim() || undefined
  }
  return undefined
}

export function SourceAuditPanel({
  item,
  t,
  canExport = false,
  exportCitation,
  pager,
}: SourceAuditPanelProps) {
  const [format, setFormat] = useState<CitationTab>('bibtex')
  const [citationState, setCitationState] = useState<CitationState>()
  const citationCopyFeedback = useCopyFeedback(`${item.key}-cite-${format}`)
  const refCopyFeedback = useCopyFeedback(`${item.key}-ref`)
  const request = useMemo(() => citationRequestOf(item.ref, format), [item.ref, format])

  useEffect(() => {
    let current = true
    const settle = (next: CitationState): void => {
      if (current) setCitationState(next)
    }
    if (!canExport) {
      settle({ key: item.key, format, phase: 'denied' })
      return () => {
        current = false
      }
    }
    if (exportCitation === undefined) {
      settle({ key: item.key, format, phase: 'unavailable' })
      return () => {
        current = false
      }
    }
    settle({ key: item.key, format, phase: 'loading' })
    void exportCitation(request).then(
      (result) => {
        if (!current) return
        if (!result.ok) {
          settle({ key: item.key, format, phase: 'error', message: messageOf(result.error) })
          return
        }
        const text = citationTextOf(format, result.value)
        settle(
          text === undefined
            ? { key: item.key, format, phase: 'empty' }
            : { key: item.key, format, phase: 'ready', text },
        )
      },
      (error: unknown) => {
        settle({ key: item.key, format, phase: 'error', message: messageOf(error) })
      },
    )
    return () => {
      current = false
    }
  }, [canExport, exportCitation, format, item.key, request])

  const activeCitationState: CitationState =
    citationState?.key === item.key && citationState.format === format
      ? citationState
      : canExport
        ? { key: item.key, format, phase: 'loading' }
        : { key: item.key, format, phase: 'denied' }
  const citationText = activeCitationState.phase === 'ready' ? activeCitationState.text : ''
  const citationMessage =
    activeCitationState.phase === 'loading'
      ? t('sourceCitationLoading')
      : activeCitationState.phase === 'denied'
        ? t('sourceCitationDenied')
        : activeCitationState.phase === 'unavailable'
          ? t('sourceCitationUnavailable')
          : activeCitationState.phase === 'empty'
            ? t('sourceCitationEmpty')
            : activeCitationState.phase === 'error'
              ? t('sourceCitationFailed', { message: activeCitationState.message })
              : undefined

  const facts = item.retrievalFacts
  const coverage = facts?.coverage
  const coveragePercent = useMemo(() => {
    if (!coverage) return 0
    if (coverage.complete) return 100
    if (coverage.totalPages !== undefined && coverage.totalPages > 0) {
      return Math.min(100, Math.round(((coverage.indexedPages ?? 0) / coverage.totalPages) * 100))
    }
    if (coverage.totalChars !== undefined && coverage.totalChars > 0) {
      return Math.min(100, Math.round(((coverage.indexedChars ?? 0) / coverage.totalChars) * 100))
    }
    return coverage.complete ? 100 : 0
  }, [coverage])

  const coverageLine = coverage !== undefined ? coverageLineOf(coverage, t) : ''
  const availabilityEntries = facts !== undefined ? Object.entries(facts.sourceAvailability) : []

  const searchRows = useMemo(
    () =>
      item.searches.map((search, index) => {
        const scope = scopeLabelOf(search.scope, t)
        const mode = modeLabelOf(search.mode, t)
        const filters = filterLineOf(search.itemTypes, search.tags, t)
        const hits =
          search.total === undefined || search.total === search.returned
            ? t('searchEpisodeHitsNoTotal', { returned: search.returned })
            : t('searchEpisodeHitsLine', { returned: search.returned, total: search.total })
        const hitsWithNotes =
          search.noteMatches === undefined
            ? hits
            : `${hits} · ${t('searchEpisodeNoteHits', { noteMatches: search.noteMatches })}`
        const hasQuery = search.query !== undefined && search.query.trim().length > 0
        const queryLine = hasQuery
          ? t('searchEpisodeQueryLine', { query: search.query!.trim(), scope, mode })
          : t('searchEpisodeNoQueryLine', { scope, mode })
        return (
          <li key={`${search.callId}-${index}`} className={css.searchEpisodeCard}>
            <p className={css.line}>{queryLine}</p>
            {filters !== '' && (
              <p className={css.note}>{t('searchEpisodeFilterLine', { filters })}</p>
            )}
            <p className={css.hitsNote}>{hitsWithNotes}</p>
          </li>
        )
      }),
    [item.searches, t],
  )

  const citationTabItems = useMemo(
    () =>
      mapTuple(CITATION_TABS, (entry) => ({
        value: entry.id,
        label: <span>{t(entry.key)}</span>,
        id: `cite-tab-${entry.id}`,
        panelId: `cite-panel-${entry.id}`,
      })),
    [t],
  )

  return (
    <div className={css.auditCard}>
      {/* 1. In-place citation generator */}
      <div className={css.citationBox}>
        <div className={css.citationTabsRow}>
          <SegmentedTabs
            items={citationTabItems}
            value={format}
            onChange={setFormat}
            label={t('citationPreviewTitle')}
            size="sm"
          />
          <Button
            variant="outline"
            size="sm"
            className={css.citationCopyBtn}
            disabled={activeCitationState.phase !== 'ready'}
            onClick={() => {
              citationCopyFeedback.copyText(citationText)
            }}
            icon={
              citationCopyFeedback.phase === 'done' ? (
                <IconCheckOutlineRegular size={12} />
              ) : (
                <IconCopyOutlineRegular size={12} />
              )
            }
          >
            {citationCopyFeedback.phase === 'done' ? t('copied') : t('copy')}
          </Button>
        </div>
        {citationMessage !== undefined ? (
          <p className={css.note} role={activeCitationState.phase === 'error' ? 'alert' : 'status'}>
            {citationMessage}
          </p>
        ) : (
          <pre className={css.citationPre}>
            <code>{citationText}</code>
          </pre>
        )}
      </div>

      {/* 2. Full-text index coverage */}
      {coverage !== undefined && (
        <div className={css.coverageBarWrap}>
          <div className={css.coverageStats}>
            <span className={css.sectionLabel}>{t('coverageProgressBar')}</span>
            <span>{coveragePercent}%</span>
          </div>
          <div className={css.coverageBarTrack}>
            <div className={css.coverageBarFill} style={{ width: `${coveragePercent}%` }} />
          </div>
          {coverageLine !== '' && <span className={css.note}>{coverageLine}</span>}
        </div>
      )}

      {/* 3. Retrieval audit occurrences */}
      {searchRows.length > 0 ? (
        <div className={css.section}>
          <h4 className={css.auditSectionTitle}>{t('retrievalTimeline')}</h4>
          <ul className={css.passages}>{searchRows}</ul>
          {pager !== undefined && (
            <SourcePageControls pager={pager} label={t('retrievalTimeline')} t={t} />
          )}
        </div>
      ) : (
        <div className={css.section}>
          <p className={css.note}>{t('overviewNoSearch')}</p>
        </div>
      )}

      {/* 4. Availability by source */}
      {availabilityEntries.length > 0 && (
        <div className={css.section}>
          <span className={css.sectionLabel}>{t('availabilityTitle')}</span>
          <ul className={css.availability}>
            {availabilityEntries.map(([source, entry]) => (
              <li key={source} className={css.line}>
                <Tag tone="neutral">{source}</Tag>{' '}
                {entry.unavailable
                  ? t('availUnavailable')
                  : entry.returnedPassages === 0
                    ? t('availNoMatch')
                    : t('availReturned', { count: entry.returnedPassages })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 5. Technical ref identifier (always visible, no disclosure needed) */}
      <div className={css.refCard}>
        <div className={css.refHeader}>
          <span className={css.refLabel}>{t('refLine')}</span>
          <Button
            variant="ghost"
            size="sm"
            className={css.refCopyBtn}
            onClick={() => {
              refCopyFeedback.copyText(item.ref)
            }}
            icon={
              refCopyFeedback.phase === 'done' ? (
                <IconCheckOutlineRegular size={11} />
              ) : (
                <IconCopyOutlineRegular size={11} />
              )
            }
          >
            {refCopyFeedback.phase === 'done' ? t('copied') : t('copy')}
          </Button>
        </div>
        <div className={css.refValue}>{item.ref}</div>
      </div>
    </div>
  )
}
