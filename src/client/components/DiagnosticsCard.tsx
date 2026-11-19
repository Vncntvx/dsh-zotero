/**
 * The diagnostics log card inside the plugin manager detail page's service
 * status section. It renders the host ring newest-first with a level filter,
 * and one "copy diagnostics" action that assembles the bundle a bug report
 * wants: plugin identity, the section's Zotero facts, the debug flag, and the
 * retained entries.
 *
 * The card lives in the settings plane on purpose: the conversation tab is the
 * surface most likely to be down when these entries matter, and a diagnostics
 * view that dies with the tab is unreadable when it is needed. It carries its
 * own `surface="diagnostics"` boundary so a crash here files under its own
 * surface and leaves the connection card above it rendering. It paints only
 * after the first answer arrives, so a diagnostics-off page never flashes an
 * empty card.
 * @module dsh-zotero/client/components/DiagnosticsCard
 */

import { useMemo, useState, type ReactNode } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  Button,
  DisclosureRow,
  IconInspectOutlineRegular,
  JsonTree,
  type JsonTreeLabels,
  SegmentedControl,
  type SegmentedControlOption,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  ZOTERO_REMOTE_PACKAGE,
  type ZoteroDiagnosticEntry,
  type ZoteroDiagnosticsView,
  type ZoteroStatusView,
} from '../../contract.ts'
import { buildInfoOf } from '../build-info.ts'
import type { ErrorReporter } from '../actions/error-reporter.ts'
import { formatTime } from '../../sources/presenters.js'
import { useDiagnosticsFeed } from './useDiagnosticsFeed.ts'
import { ZoteroSurfaceBoundary } from './ZoteroSurfaceBoundary.tsx'
import { CopyButton } from './CopyButton.tsx'
import css from './plugin/plugin-cards.module.css'

/** How many filtered entries render before the "latest N" note takes over. */
const RENDER_LIMIT = 100

export interface DiagnosticsCardProps {
  readonly t: TranslateNS<'zotero'>
  readonly diagnostics: () => Promise<RemoteResult<ZoteroDiagnosticsView>>
  /** The service status section's latest probe answer, for the copied facts. */
  readonly status?: ZoteroStatusView
  readonly report: ErrorReporter
}

/** `HH:MM:SS` of one entry timestamp, local time. */
function timeOf(ts: number): string {
  return formatTime(ts, true)
}

/** The plain-text bundle a bug report pastes: header facts plus every served entry. */
function bundleOf(
  data: ZoteroDiagnosticsView,
  status: ZoteroStatusView | undefined,
  t: TranslateNS<'zotero'>,
): string {
  const facts = [
    'dsh-zotero diagnostics',
    `plugin: ${buildInfoOf()}`,
    status === undefined
      ? undefined
      : `zotero: ${status.zoteroVersion ?? '-'} · ${status.endpoint ?? '-'} · ${
          status.connected ? 'connected' : 'disconnected'
        }`,
    t('diagnosticsDebugOn'),
    `${data.total} retained · ${data.entries.length} served`,
  ]
    .filter((line) => line !== undefined)
    .join('\n')
  const body = data.entries.map((entry) => entryText(entry)).join('\n')
  return `${facts}\n\n${body}`
}

/** One entry as bundle text: header line, message, detail JSON. */
function entryText(entry: ZoteroDiagnosticEntry): string {
  const head = `#${entry.seq} ${timeOf(entry.ts)} ${entry.level.toUpperCase()} ${entry.event}${
    entry.count > 1 ? ` (×${entry.count})` : ''
  }`
  const detail = entry.detail === undefined ? undefined : `  ${JSON.stringify(entry.detail)}`
  return detail === undefined ? `${head}\n${entry.message}` : `${head}\n${entry.message}\n${detail}`
}

/**
 * The log card, under its own surface boundary. The service status section
 * supplies the shared probe answer so the copied facts never drift from the
 * connection card above.
 */
export function DiagnosticsCard({
  t,
  diagnostics,
  status,
  report,
}: DiagnosticsCardProps): ReactNode {
  return (
    <ZoteroSurfaceBoundary
      t={t}
      surface="diagnostics"
      resetKey={ZOTERO_REMOTE_PACKAGE}
      report={report}
    >
      <DiagnosticsCardBody t={t} diagnostics={diagnostics} status={status} />
    </ZoteroSurfaceBoundary>
  )
}

function DiagnosticsCardBody({
  t,
  diagnostics,
  status,
}: Omit<DiagnosticsCardProps, 'report'>): ReactNode {
  const { state: feed, refresh } = useDiagnosticsFeed(diagnostics)
  const [problemsOnly, setProblemsOnly] = useState(false)

  const filterOptions: readonly SegmentedControlOption<'all' | 'problems'>[] = useMemo(
    () => [
      { value: 'all', label: t('diagnosticsLevelAll') },
      { value: 'problems', label: t('diagnosticsLevelProblems') },
    ],
    [t],
  )

  const jsonLabels: JsonTreeLabels = useMemo(
    () => ({
      copyValue: t('jsonCopyValue'),
      copyJson: t('jsonCopyJson'),
      copyPath: t('jsonCopyPath'),
      copyPrettyJson: t('jsonCopyPrettyJson'),
      copyCompactJson: t('jsonCopyCompactJson'),
      copied: t('copied'),
      copyFailed: t('jsonCopyFailed'),
      collapseNode: t('jsonCollapseNode'),
      expandNode: t('jsonExpandNode'),
      copyButtonTitle: (action: string) => action,
    }),
    [t],
  )

  const data = feed.data
  if (data !== undefined && !data.debug) return null
  // The first answer is the only source of the debug flag: render nothing
  // until it arrives, so a diagnostics-off page never flashes an empty card.
  if (data === undefined && feed.error === undefined) return null

  const filtered =
    data?.entries.filter(
      (entry) => !problemsOnly || entry.level === 'warn' || entry.level === 'error',
    ) ?? []
  const shown = filtered.slice(0, RENDER_LIMIT)

  return (
    <div className={css.card} data-zotero-diagnostics>
      <div className={css.cardHead}>
        <span className={css.cardTitle}>{t('diagnosticsLogLabel')}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={feed.loading}
          onClick={() => {
            void refresh()
          }}
        >
          {feed.loading ? t('checking') : t('refresh')}
        </Button>
      </div>

      {data === undefined ? (
        <p className={css.diagFetchError}>{feed.error}</p>
      ) : (
        <>
          <div className={css.diagToolbar}>
            <SegmentedControl
              id="diagnostics-level-filter"
              value={problemsOnly ? 'problems' : 'all'}
              options={filterOptions}
              onChange={(next) => setProblemsOnly(next === 'problems')}
              label={t('diagnosticsFilterLabel')}
            />
            <CopyButton
              value={bundleOf(data, status, t)}
              identityKey="diagnostics-bundle"
              label={t('diagnosticsCopyBundle')}
              copiedLabel={t('copied')}
            />
          </div>

          {filtered.length === 0 ? (
            <p className={css.diagEmpty}>
              {problemsOnly && data.entries.length > 0
                ? t('diagnosticsNoProblems')
                : t('diagnosticsEmpty')}
            </p>
          ) : (
            <div className={css.diagList}>
              {shown.map((entry) => (
                <div key={entry.seq} className={css.diagRow}>
                  <span className={css.diagTime}>{timeOf(entry.ts)}</span>
                  <StateDot
                    state={
                      entry.level === 'error'
                        ? 'error'
                        : entry.level === 'warn'
                          ? 'warning'
                          : 'done'
                    }
                  />
                  <div className={css.diagBody}>
                    <span className={css.diagEvent}>{entry.event}</span>
                    {entry.count > 1 ? <span className={css.diagCount}>×{entry.count}</span> : null}
                    <p className={css.diagMessage}>{entry.message}</p>
                    {entry.detail === undefined ? null : (
                      <DiagnosticsDetail detail={entry.detail} jsonLabels={jsonLabels} t={t} />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {filtered.length > RENDER_LIMIT ? (
            <p className={css.diagFooter}>
              {t('diagnosticsShowLatest', { shown: RENDER_LIMIT, total: filtered.length })}
            </p>
          ) : null}
          <p className={css.diagFooter}>{t('diagnosticsDebugOn')}</p>
        </>
      )}
    </div>
  )
}

/** One log entry's detail JSON, behind its own controlled disclosure. */
function DiagnosticsDetail({
  detail,
  jsonLabels,
  t,
}: {
  readonly detail: ZoteroDiagnosticEntry['detail']
  readonly jsonLabels: JsonTreeLabels
  readonly t: TranslateNS<'zotero'>
}) {
  const [open, setOpen] = useState(false)
  return (
    <DisclosureRow
      icon={<IconInspectOutlineRegular />}
      title={t('diagnosticsDetail')}
      open={open}
      expandable
      onToggle={() => setOpen((value) => !value)}
      className={css.diagDetail}
    >
      <JsonTree
        data={
          typeof detail === 'object' && detail !== null ? (detail as object) : { value: detail }
        }
        label={t('diagnosticsDetail')}
        labels={jsonLabels}
        collapsedStringLines={3}
      />
    </DisclosureRow>
  )
}
