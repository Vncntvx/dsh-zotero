/**
 * The dedicated Zotero web view: one tab in the conversation view ring
 * (id `zotero`, order 30 — right of Chat, Trajectory, and dsh-context).
 * The view renders the session's Zotero tool calls as rich cards through
 * the shared presenters, replay-driven from the conversation snapshot, and
 * leads with a request-driven connectivity strip (one status probe on
 * mount, another per explicit Refresh; no recurring timers). The built-in
 * chat and trajectory views are untouched — nothing here registers into
 * their render holes.
 * @module dsh-zotero/client/ZoteroTab
 */

import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ConversationSnapshot,
  ToolCallBlock,
  ToolResultNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroStatusView } from './remote.ts'
import {
  ZoteroAttachmentRow,
  ZoteroExportRow,
  ZoteroGetRow,
  ZoteroRetrieveRow,
  ZoteroSearchRow,
} from './ZoteroToolViews.tsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

/** The inject face the tab's slot entry provides. */
export interface ZoteroTabFace {
  /** Live connectivity view through the plugin's Remote namespace. */
  status: () => Promise<RemoteResult<ZoteroStatusView>>
}

/** Props the conversation view ring binds for this tab. */
export type ZoteroTabProps = PropsRuntime<'conversation.view'> &
  PropsLocale<'zotero'> &
  InjectFace<ZoteroTabFace>

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

/** Clock formatter: absolute time, updated per acquisition (no relative timers). */
export function currentTime(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

/** Short display form of an instance id; the full value stays in the title attribute. */
export function shortServerId(serverId: string): string {
  return serverId.slice(0, 8)
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

/** The wire name of one tool call block (settled and running forms). */
export function callNameOf(block: ToolCallBlock): string | null {
  return 'kind' in block ? (block.call?.name ?? null) : block.name
}

/** Stable order key: settled blocks by seq, in-flight calls after them by time. */
function orderOf(block: ToolCallBlock): number {
  return 'kind' in block ? block.seq : 1_000_000_000 + block.time
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
  out.sort((a, b) => orderOf(a) - orderOf(b))
  return out
}

/** One Zotero call rendered by its matching card component. */
function CardFor({
  block,
  t,
}: {
  readonly block: ToolCallBlock
  readonly t: TranslateNS<'zotero'>
}) {
  switch (callNameOf(block)) {
    case 'zotero_search':
      return <ZoteroSearchRow block={block} t={t} />
    case 'zotero_get':
      return <ZoteroGetRow block={block} t={t} />
    case 'zotero_retrieve':
      return <ZoteroRetrieveRow block={block} t={t} />
    case 'zotero_attachment':
      return <ZoteroAttachmentRow block={block} t={t} />
    case 'zotero_export':
      return <ZoteroExportRow block={block} t={t} />
    default:
      return null
  }
}

const page: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  maxWidth: 720,
  boxSizing: 'border-box',
  padding: '8px 12px 16px',
}

const strip: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '4px 10px',
  padding: '8px 10px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-base)',
}

const stripText: CSSProperties = {
  margin: 0,
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 13,
  lineHeight: 1.4,
}

const stripMono: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--ds-font-family-code)',
  fontSize: 12,
  lineHeight: 1.4,
  color: 'var(--dsw-alias-label-tertiary)',
}

const refreshButton: CSSProperties = {
  marginLeft: 'auto',
  fontFamily: 'inherit',
  fontSize: 12,
  lineHeight: 18,
  color: 'var(--dsw-alias-state-business-primary)',
  background: 'transparent',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 4,
  padding: '0 8px',
  cursor: 'pointer',
}

const list: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
}

const empty: CSSProperties = {
  margin: 0,
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 13,
  lineHeight: 1.5,
}

/** The Zotero tab body: connectivity strip plus the session's zotero cards. */
export function ZoteroTab({ status, t, useSession }: ZoteroTabProps) {
  const session = useSession((snapshot) => snapshot)
  const blocks = useMemo(() => collectZoteroCalls(session), [session])
  const [statusState, setStatusState] = useState<TabStatusState>({ kind: 'loading' })
  const [requestId, setRequestId] = useState(0)

  useEffect(() => {
    if (status === undefined) return
    const controller = new AbortController()
    setStatusState({ kind: 'loading' })
    void (async () => {
      const result = await status()
      // Remote cancellation is detected from caller-signal ownership, not
      // from assuming the promise rejects (the carrier converts failures).
      if (controller.signal.aborted) return
      setStatusState(stateOf(result, currentTime()))
    })()
    return () => {
      controller.abort()
    }
  }, [status, requestId])

  const refresh = (): void => {
    setRequestId((id) => id + 1)
  }

  const serverId = statusState.kind === 'connected' ? statusState.data.serverId : undefined
  const checkedAt =
    statusState.kind === 'connected' || statusState.kind === 'unavailable'
      ? statusState.checkedAt
      : undefined

  return (
    <div style={page}>
      <div style={strip} aria-live="polite" aria-busy={statusState.kind === 'loading'}>
        <StateDot
          state={
            statusState.kind === 'loading'
              ? 'ongoing'
              : statusState.kind === 'connected'
                ? 'done'
                : 'error'
          }
        />
        <span style={stripText}>
          {statusState.kind === 'loading' && t('checking')}
          {statusState.kind === 'connected' && t('statusConnected')}
          {(statusState.kind === 'unavailable' || statusState.kind === 'remote-error') &&
            t('statusUnavailable')}
        </span>
        {statusState.kind === 'connected' && statusState.data.apiVersion !== undefined && (
          <span style={stripText}>
            {t('apiVersionLabel')} {statusState.data.apiVersion}
          </span>
        )}
        {statusState.kind === 'connected' && statusState.data.schemaVersion !== undefined && (
          <span style={stripText}>
            {t('schemaVersionLabel')} {statusState.data.schemaVersion}
          </span>
        )}
        {serverId !== undefined && (
          <span style={stripMono} title={serverId}>
            {t('serverIdLabel')} {shortServerId(serverId)}
          </span>
        )}
        {(statusState.kind === 'unavailable' || statusState.kind === 'remote-error') && (
          <span style={stripText}>
            {statusState.kind === 'remote-error'
              ? statusState.message
              : `${t('diagnosisLabel')}: ${statusState.data.diagnosis}`}
          </span>
        )}
        {checkedAt !== undefined && (
          <span style={stripMono}>
            {t('lastCheckedLabel')} {checkedAt}
          </span>
        )}
        <button
          type="button"
          style={refreshButton}
          onClick={refresh}
          disabled={statusState.kind === 'loading'}
        >
          {t('refresh')}
        </button>
      </div>
      {blocks.length === 0 ? (
        <p style={empty}>{t('noActivity')}</p>
      ) : (
        <div style={list}>
          {blocks.map((block) => (
            <CardFor key={block.callId} block={block} t={t} />
          ))}
        </div>
      )}
    </div>
  )
}
