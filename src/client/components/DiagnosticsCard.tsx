/**
 * The diagnostics card in the plugin manager's detail page
 * (plugins.detail.section). It renders the host ring newest-first with a
 * level filter, and one "copy diagnostics" action that assembles the bundle a
 * bug report wants: plugin identity, the probe's Zotero facts, the debug
 * flag, and the retained entries.
 *
 * The panel lives in the settings plane on purpose: the conversation tab is
 * the surface most likely to be down when these entries matter, and a
 * diagnostics view that dies with the tab is unreadable when it is needed.
 * The card carries its own surface boundary for the same reason: a crash
 * inside it files under the `diagnostics` surface and offers the retry
 * button instead of vanishing with the slot.
 * @module dsh-zotero/client/components/DiagnosticsCard
 */

import { useMemo, useState, type ReactNode } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  Button,
  JsonTree,
  type JsonTreeLabels,
  SegmentedControl,
  type SegmentedControlOption,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginDetailProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import {
  ZOTERO_REMOTE_PACKAGE,
  type ZoteroDiagnosticEntry,
  type ZoteroDiagnosticsView,
  type ZoteroStatusView,
} from '../../contract.ts'
import { buildInfoOf } from '../build-info.ts'
import { formatTime } from '../presenters.ts'
import { useZoteroProbe } from './useZoteroProbe.ts'
import { useDiagnosticsFeed } from './useDiagnosticsFeed.ts'
import { ZoteroSurfaceBoundary } from './ZoteroSurfaceBoundary.tsx'
import { CopyButton } from './CopyButton.tsx'
import css from './plugin/plugin-cards.module.css'

/** How many filtered entries render before the "latest N" note takes over. */
const RENDER_LIMIT = 100

interface ZoteroDiagnosticsCardProps extends PluginDetailProps, PropsLocale<'zotero'> {
  readonly probe: () => Promise<RemoteResult<ZoteroStatusView>>
  readonly diagnostics: () => Promise<RemoteResult<ZoteroDiagnosticsView>>
}

interface DiagnosticsCardBodyProps {
  readonly t: TranslateNS<'zotero'>
  readonly probe: () => Promise<RemoteResult<ZoteroStatusView>>
  readonly diagnostics: () => Promise<RemoteResult<ZoteroDiagnosticsView>>
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
    t(data.debug ? 'diagnosticsDebugOn' : 'diagnosticsDebugOff'),
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
 * Slot entry: subject guard, then the body under its own surface boundary.
 * The panel must not die silently with the slot that renders it.
 */
export function DiagnosticsCard({
  subject,
  t,
  probe,
  diagnostics,
}: ZoteroDiagnosticsCardProps): ReactNode {
  const pkgName = subject.kind === 'bundle' || subject.kind === 'row' ? subject.pkg.name : undefined
  if (pkgName !== ZOTERO_REMOTE_PACKAGE) {
    return null
  }
  return (
    <ZoteroSurfaceBoundary t={t} surface="diagnostics" resetKey={pkgName}>
      <DiagnosticsCardBody t={t} probe={probe} diagnostics={diagnostics} />
    </ZoteroSurfaceBoundary>
  )
}

function DiagnosticsCardBody({ t, probe, diagnostics }: DiagnosticsCardBodyProps): ReactNode {
  const { state: feed, refresh } = useDiagnosticsFeed(diagnostics)
  const { state: probeState } = useZoteroProbe(probe, { initialAutoRun: true })
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
  if (data !== undefined && !data.debug) {
    return null
  }

  const filtered =
    data?.entries.filter(
      (entry) => !problemsOnly || entry.level === 'warn' || entry.level === 'error',
    ) ?? []
  const shown = filtered.slice(0, RENDER_LIMIT)

  return (
    <section className={css.section} data-zotero-diagnostics>
      <div className={css.sectionHead}>
        <h4 className={css.sectionTitle}>{t('diagnosticsTitle')}</h4>
      </div>
      <div className={css.card}>
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

        <div className={css.diagToolbar}>
          <SegmentedControl
            id="diagnostics-level-filter"
            value={problemsOnly ? 'problems' : 'all'}
            options={filterOptions}
            onChange={(next) => setProblemsOnly(next === 'problems')}
            label={t('diagnosticsFilterLabel')}
          />
          <CopyButton
            value={data !== undefined ? bundleOf(data, probeState.data, t) : ''}
            label={t('diagnosticsCopyBundle')}
            copiedLabel={t('copied')}
            asButton
            disabled={data === undefined}
          />
        </div>

        {feed.error !== undefined ? (
          <p className={css.diagFetchError}>{feed.error}</p>
        ) : data === undefined ? null : filtered.length === 0 ? (
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
                  size={6}
                  state={
                    entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warning' : 'done'
                  }
                />
                <div className={css.diagBody}>
                  <span className={css.diagEvent}>{entry.event}</span>
                  {entry.count > 1 ? <span className={css.diagCount}>×{entry.count}</span> : null}
                  <p className={css.diagMessage}>{entry.message}</p>
                  {entry.detail === undefined ? null : (
                    <details className={css.diagDetail}>
                      <summary>{t('diagnosticsDetail')}</summary>
                      <JsonTree
                        data={
                          typeof entry.detail === 'object' && entry.detail !== null
                            ? (entry.detail as object)
                            : { value: entry.detail }
                        }
                        label={t('diagnosticsDetail')}
                        labels={jsonLabels}
                        collapsedStringLines={3}
                      />
                    </details>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {data !== undefined && filtered.length > RENDER_LIMIT ? (
          <p className={css.diagFooter}>
            {t('diagnosticsShowLatest', { shown: RENDER_LIMIT, total: filtered.length })}
          </p>
        ) : null}
        {data !== undefined ? (
          <p className={css.diagFooter}>
            {data.debug ? t('diagnosticsDebugOn') : t('diagnosticsDebugOff')}
          </p>
        ) : null}
      </div>
    </section>
  )
}
