/**
 * The source audit panel: displays the retrieval timeline, indexing coverage
 * progress, and an in-place citation code preview (BibTeX / GB/T 7714) with
 * one-click copy feedback. Rendered in the 3rd column on wide containers and
 * embedded at the bottom of the inspector feed on narrower surfaces.
 * @module dsh-zotero/client/components/workspace/SourceAuditPanel
 */

import { useMemo, useState } from 'react'
import {
  Button,
  IconCheckOutlineRegular,
  IconCopyOutlineRegular,
  SegmentedTabs,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SourceItem } from '../../../sources/model.js'
import { mapTuple } from '../../segmented-tabs.ts'
import { coverageLineOf } from '../../evidence-labels.ts'
import { useCopyFeedback } from '../useCopyFeedback.ts'
import { filterLineOf, modeLabelOf, scopeLabelOf } from './SourceOverview.tsx'
import css from './workspace.module.css'

type CitationTab = 'bibtex' | 'gbt7714'

const CITATION_TABS: readonly [
  { readonly id: 'bibtex'; readonly key: 'bibtexFormat' },
  { readonly id: 'gbt7714'; readonly key: 'gbt7714Format' },
] = [
  { id: 'bibtex', key: 'bibtexFormat' },
  { id: 'gbt7714', key: 'gbt7714Format' },
]

interface SourceAuditPanelProps {
  readonly item: SourceItem
  readonly t: TranslateNS<'zotero'>
}

function synthesizeBibtex(item: SourceItem): string {
  // Use existing export artifact text when available
  const existingArtifact = item.exports.find(
    (exp) => exp.format === 'bibtex' || exp.format === 'biblatex',
  )
  if (existingArtifact !== undefined && existingArtifact.text.trim() !== '') {
    return existingArtifact.text.trim()
  }

  const citeKey =
    item.exports[0]?.items?.[0]?.citationKey ??
    item.key.replace(/^zotero:\/\/user\/0\/item\//, 'zotero_')
  const author = item.creators ?? 'Unknown'
  const title = item.title ?? 'Untitled'
  const year = item.year !== undefined ? String(item.year) : ''
  const venue = item.venue ?? ''

  const lines = [`@article{${citeKey},`, `  title = {${title}},`, `  author = {${author}},`]
  if (year !== '') lines.push(`  year = {${year}},`)
  if (venue !== '') lines.push(`  journal = {${venue}},`)
  lines.push(`  url = {${item.ref}}`)
  lines.push(`}`)
  return lines.join('\n')
}

function synthesizeGbt7714(item: SourceItem): string {
  const author = item.creators
    ? item.creators.replace(/([a-zA-Z])(和)([a-zA-Z])/g, '$1 $2 $3')
    : '佚名'
  const title = item.title ?? '无题'
  const venue = item.venue ? ` ${item.venue},` : ''
  const year = item.year !== undefined ? ` ${item.year}.` : '.'
  return `${author}. ${title}[J/OL].${venue}${year}`
}

export function SourceAuditPanel({ item, t }: SourceAuditPanelProps) {
  const [format, setFormat] = useState<CitationTab>('bibtex')
  const citationCopyFeedback = useCopyFeedback(`${item.key}-cite`)
  const refCopyFeedback = useCopyFeedback(`${item.key}-ref`)

  const citationText = useMemo(
    () => (format === 'bibtex' ? synthesizeBibtex(item) : synthesizeGbt7714(item)),
    [item, format],
  )

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
        <pre className={css.citationPre}>
          <code>{citationText}</code>
        </pre>
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
