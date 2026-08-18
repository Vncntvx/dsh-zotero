/**
 * The Sources panel: the plugin's conversation tab (id `zotero`, order 30).
 * The front page is the session's source list — the stable union of every
 * successful search's hits and every directly referenced item, filterable
 * but never replaced; the evidence and exports lenses follow. The status
 * strip is low-key when connected (a connectivity probe is one fact, not a
 * developer console); API/schema/Server ID live in a collapsible diagnostic
 * block. The probe runs once on mount and once per explicit refresh — no
 * timers — and its cancellation is ignore-stale: the Remote face carries no
 * signal by contract, so the aborted probe's result is dropped after settle.
 * Composer prefills go through the injected inputActions.setDraft and never
 * submit. The built-in chat and trajectory views are untouched; per-call
 * diagnostics stay with the built-in Trajectory view.
 * @module dsh-zotero/client/components/SourcesTab
 */

import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { Pill, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ConversationSnapshot,
  ToolCallBlock,
  ToolResultNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroStatusView } from '../remote.ts'
import { callNameOf, orderKeyOf } from '../presenters.ts'
import { buildSourceWorkspace } from '../sources/reducer.ts'
import { EmptyState } from './EmptyState.tsx'
import { EvidenceLens } from './EvidenceLens.tsx'
import { ExportsLens } from './ExportsLens.tsx'
import { SourceList } from './SourceList.tsx'
import { SourcesHeader } from './SourcesHeader.tsx'
import css from './SourcesTab.module.css'

/** The inject face the tab's slot entry provides. */
export interface SourcesTabFace {
  /** Live connectivity view through the plugin's Remote namespace. */
  status: () => Promise<RemoteResult<ZoteroStatusView>>
}

/** Props the conversation view ring binds for this tab. */
export type SourcesTabProps = PropsRuntime<'conversation.view'> &
  PropsLocale<'zotero'> &
  InjectFace<SourcesTabFace>

/** The status strip's state: the connectivity view plus the two transport-level outcomes. */
export type TabStatusState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'connected'
      readonly data: ZoteroStatusView
      readonly checkedAt: string
    }
  | {
      readonly kind: 'unavailable'
      readonly data: ZoteroStatusView
      readonly checkedAt: string
    }
  | { readonly kind: 'remote-error'; readonly message: string }

/** The panel's lenses; sources is the front page. */
export type SourcesLensId = 'sources' | 'evidence' | 'exports'

/** The lens bar's entries: id plus its locale key. */
const LENSES: readonly {
  readonly id: SourcesLensId
  readonly key: 'lensSources' | 'lensEvidence' | 'lensExports'
}[] = [
  { id: 'sources', key: 'lensSources' },
  { id: 'evidence', key: 'lensEvidence' },
  { id: 'exports', key: 'lensExports' },
]

/** Clock formatter: absolute time, updated per acquisition (no relative timers). */
export function currentTime(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

/**
 * A cheap content signature of the zotero-relevant slice: the settled-node
 * count and tail position plus the running-call ids. Streaming chunk
 * publications change neither, so the call collection (and with it the
 * workspace rebuild) skips them.
 * @param snapshot - the conversation snapshot, undefined while none is open.
 * @returns the signature string.
 */
export function sessionSignatureOf(snapshot: ConversationSnapshot | undefined): string {
  if (snapshot === undefined) return ''
  const last =
    snapshot.nodes.length === 0
      ? -1
      : orderKeyOf(snapshot.nodes[snapshot.nodes.length - 1] as ToolCallBlock)
  const running = snapshot.runningCalls.map((call) => call.callId).join(',')
  return `${snapshot.nodes.length}:${last}:${snapshot.runningCalls.length}:${running}`
}

/**
 * Project one settled Remote result into the strip's state. The component
 * checks its own signal before calling this — an aborted request never
 * reaches it.
 * @param result - the settled remote result.
 * @param checkedAt - the absolute acquisition time to display.
 * @returns the state to render.
 */
export function stateOf(result: RemoteResult<ZoteroStatusView>, checkedAt: string): TabStatusState {
  if (!result.ok) return { kind: 'remote-error', message: result.error.message }
  if (result.value.connected) {
    return { kind: 'connected', data: result.value, checkedAt }
  }
  return { kind: 'unavailable', data: result.value, checkedAt }
}

/**
 * Collect the session's Zotero tool calls: settled results and in-flight
 * calls, including nested dispatch (Code mode), deduplicated by callId and
 * ordered by transcript position. Pure over the snapshot — the same log
 * slice renders the same list.
 * @param snapshot - the conversation snapshot, undefined while none is open.
 * @returns the ordered zotero call blocks.
 */
export function collectZoteroCalls(snapshot: ConversationSnapshot | undefined): ToolCallBlock[] {
  if (snapshot === undefined) return []
  const out: ToolCallBlock[] = []
  const seen = new Set<string>()
  const visit = (block: ToolCallBlock): void => {
    const name = callNameOf(block)
    if (name !== null && name.startsWith('zotero_') && !seen.has(block.callId)) {
      seen.add(block.callId)
      out.push(block)
    }
    for (const child of block.subCalls) visit(child)
  }
  for (const node of snapshot.nodes) {
    if (node.kind === 'tool-result') visit(node as ToolResultNode)
  }
  for (const call of snapshot.runningCalls) visit(call)
  out.sort((a, b) => orderKeyOf(a) - orderKeyOf(b))
  return out
}

/** The failure diagnosis line of one non-connected strip state. */
export function diagnosisOf(state: TabStatusState, t: SourcesTabProps['t']): string {
  if (state.kind === 'remote-error') return state.message
  if (state.kind === 'unavailable') {
    const diagnosis = state.data.diagnosis
    return diagnosis === '' ? t('statusUnavailable') : `${t('diagnosisLabel')}: ${diagnosis}`
  }
  return ''
}

/** The Sources panel body: status strip, diagnostics, lens bar, and the active lens. */
export function SourcesTab({ status, t, useSession, inputActions }: SourcesTabProps) {
  const session = useSession((snapshot) => snapshot)
  const [lens, setLens] = useState<SourcesLensId>('sources')
  const [statusState, setStatusState] = useState<TabStatusState>({ kind: 'loading' })
  const [requestId, setRequestId] = useState(0)
  // The last verified instance id feeds the provenance verdicts. It updates
  // only when a connected probe settles — a refresh's loading flip must not
  // drop it, or the workspace would rebuild twice per probe.
  const [serverId, setServerId] = useState<string | undefined>(undefined)
  const signature = useMemo(() => sessionSignatureOf(session), [session])
  const blocks = useMemo(() => collectZoteroCalls(session), [signature])
  const workspace = useMemo(
    () => buildSourceWorkspace(blocks, { currentServerId: serverId }),
    [blocks, serverId],
  )
  const setDraft = inputActions?.setDraft.bind(inputActions)

  useEffect(() => {
    if (status === undefined) return
    const controller = new AbortController()
    setStatusState({ kind: 'loading' })
    void (async () => {
      const result = await status()
      // The Remote face carries no signal by contract, so cancellation is
      // ignore-stale: the aborted probe settles normally and its result is
      // dropped here, never mistaken for a connectivity problem.
      if (controller.signal.aborted) return
      const next = stateOf(result, currentTime())
      setStatusState(next)
      if (next.kind === 'connected' && next.data.serverId !== undefined) {
        setServerId(next.data.serverId)
      } else {
        setServerId(undefined)
      }
    })()
    return () => {
      controller.abort()
    }
  }, [status, requestId])

  const refresh = (): void => {
    setRequestId((id) => id + 1)
  }

  const connected = statusState.kind === 'connected' ? statusState.data : undefined
  const failed = statusState.kind === 'unavailable' || statusState.kind === 'remote-error'
  const checkedAt =
    statusState.kind === 'connected' || statusState.kind === 'unavailable'
      ? statusState.checkedAt
      : undefined

  return (
    <div className={css.view} data-conversation-composer-overlay>
      <div
        className={css.toolbar}
        role="status"
        aria-live="polite"
        aria-busy={statusState.kind === 'loading'}
      >
        <StateDot
          state={
            statusState.kind === 'loading'
              ? 'ongoing'
              : statusState.kind === 'connected'
                ? 'done'
                : 'error'
          }
        />
        <span className={css.statusText}>
          {statusState.kind === 'loading' && t('checking')}
          {statusState.kind === 'connected' && t('statusConnectedNote')}
          {failed && t('statusUnavailable')}
        </span>
        {failed && (
          <span className={css.diagnosis} title={diagnosisOf(statusState, t)}>
            {diagnosisOf(statusState, t)}
          </span>
        )}
        <span className={css.spacer} />
        {checkedAt !== undefined && (
          <span className={css.checkedAt}>
            {t('lastCheckedLabel')} {checkedAt}
          </span>
        )}
        <button
          type="button"
          className={css.refresh}
          onClick={refresh}
          disabled={statusState.kind === 'loading'}
        >
          {t('refresh')}
        </button>
      </div>
      {statusState.kind !== 'loading' && (
        <details className={css.details}>
          <summary className={css.detailsLabel}>{t('detailsLabel')}</summary>
          <div className={css.detailsBody}>
            {connected?.apiVersion !== undefined && (
              <span className={css.chip}>
                {t('apiVersionLabel')} {connected.apiVersion}
              </span>
            )}
            {connected?.schemaVersion !== undefined && (
              <span className={css.chip}>
                {t('schemaVersionLabel')} {connected.schemaVersion}
              </span>
            )}
            {connected?.serverId !== undefined && (
              <span className={clsx(css.chip, css.chipMono)} title={connected.serverId}>
                {t('serverIdLabel')} {connected.serverId}
              </span>
            )}
          </div>
        </details>
      )}
      {blocks.length === 0 ? (
        <EmptyState t={t} setDraft={setDraft} />
      ) : (
        <>
          <div className={css.lensBar} role="group">
            {LENSES.map((entry) => (
              <Pill
                key={entry.id}
                active={lens === entry.id}
                aria-pressed={lens === entry.id}
                onClick={() => {
                  setLens(entry.id)
                }}
              >
                {t(entry.key)}
              </Pill>
            ))}
          </div>
          <div className={css.scroller}>
            <div className={css.list}>
              {lens === 'sources' ? (
                <>
                  <SourcesHeader workspace={workspace} t={t} />
                  <SourceList workspace={workspace} t={t} setDraft={setDraft} />
                </>
              ) : lens === 'evidence' ? (
                <EvidenceLens workspace={workspace} t={t} />
              ) : (
                <ExportsLens workspace={workspace} t={t} />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
