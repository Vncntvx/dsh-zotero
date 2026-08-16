/**
 * The dedicated Zotero web view: one tab in the conversation view ring
 * (id `zotero`, order 30 — right of Chat, Trajectory, and dsh-context).
 * The view owns its area like the native views: a slim status toolbar
 * (StateDot + fact chips + refresh) above a lens bar and a centered reading
 * column. The lens bar switches between the corpus views — items (one record
 * per library item), citations (the session's export artifacts), and the
 * per-call activity replay — with the activity ledger as the front page and
 * a manual pick overriding it. The cards are replay-driven from the
 * conversation snapshot; the status probe is request-driven (one on mount,
 * one per explicit Refresh; no timers). Composer prefills go through the
 * injected inputActions.setDraft and never submit. The built-in chat and
 * trajectory views are untouched.
 * @module dsh-zotero/client/ZoteroTab
 */

import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { IconBrowseOutline16, Pill, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ConversationSnapshot,
  ToolCallBlock,
  ToolResultNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroStatusView } from './remote.ts'
import { buildCorpus, type ZoteroLensId } from './corpus.ts'
import { callNameOf, callToneOf, interpolate, orderKeyOf, rowStateOf } from './presenters.ts'
import { ZoteroCiteLens } from './ZoteroCiteLens.tsx'
import { ZoteroItemsLens } from './ZoteroItemsLens.tsx'
import { CardFor } from './ZoteroToolViews.tsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ZoteroTab.module.css'

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

/** The lens bar's entries: id plus its locale key. */
const LENSES: readonly {
  readonly id: ZoteroLensId
  readonly key: 'lensItems' | 'lensCitations' | 'lensActivity'
}[] = [
  { id: 'items', key: 'lensItems' },
  { id: 'citations', key: 'lensCitations' },
  { id: 'activity', key: 'lensActivity' },
]

/** Clock formatter: absolute time, updated per acquisition (no relative timers). */
export function currentTime(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

/**
 * The activity strip segment's width: grow by the settled call's duration
 * (a waterfall like the trajectory overview). In-flight calls and settled
 * blocks whose call head left the window have no duration and fall back to
 * the minimum width.
 * @param block - one collected call block.
 * @returns the inline grow style, or undefined for the minimum-width fallback.
 */
function activityGrowOf(block: ToolCallBlock): { readonly flexGrow: number } | undefined {
  if (!('kind' in block) || block.callTime === null) return undefined
  const duration = Math.max(0, block.time - block.callTime)
  return duration > 0 ? { flexGrow: duration } : undefined
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

/** The Zotero tab body: status toolbar, lens bar, and the active lens. */
export function ZoteroTab({ status, t, useSession, inputActions }: ZoteroTabProps) {
  const session = useSession((snapshot) => snapshot)
  const blocks = useMemo(() => collectZoteroCalls(session), [session])
  const corpus = useMemo(() => buildCorpus(blocks), [blocks])
  const [manualLens, setManualLens] = useState<ZoteroLensId | undefined>(undefined)
  const [statusState, setStatusState] = useState<TabStatusState>({ kind: 'loading' })
  const [requestId, setRequestId] = useState(0)
  const [hoveredCall, setHoveredCall] = useState<string | undefined>(undefined)
  // The activity ledger is the tab's front page; a manual pick overrides it.
  const lens = manualLens ?? 'activity'
  const setDraft = inputActions?.setDraft.bind(inputActions)

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
          {statusState.kind === 'connected' && t('statusConnected')}
          {failed && t('statusUnavailable')}
        </span>
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
            {t('serverIdLabel')} {shortServerId(connected.serverId)}
          </span>
        )}
        {failed && (
          <span
            className={css.diagnosis}
            title={
              statusState.kind === 'remote-error'
                ? statusState.message
                : `${t('diagnosisLabel')}: ${statusState.data.diagnosis}`
            }
          >
            {statusState.kind === 'remote-error'
              ? statusState.message
              : `${t('diagnosisLabel')}: ${statusState.data.diagnosis}`}
          </span>
        )}
        {!failed && <span className={css.spacer} />}
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
      {blocks.length === 0 ? (
        <div className={css.scrollerEmpty}>
          <div className={css.empty}>
            <IconBrowseOutline16 size={16} className={css.emptyIcon} />
            <p className={css.emptyText}>{t('noActivity')}</p>
            {setDraft !== undefined && (
              <div className={css.starterRow}>
                <Pill
                  onClick={() => {
                    setDraft(t('starterFindTemplate'))
                  }}
                >
                  {t('starterFind')}
                </Pill>
                <Pill
                  onClick={() => {
                    setDraft(t('starterCiteTemplate'))
                  }}
                >
                  {t('starterCite')}
                </Pill>
                <Pill
                  onClick={() => {
                    setDraft(t('starterTidyTemplate'))
                  }}
                >
                  {t('starterTidy')}
                </Pill>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className={css.lensBar} role="group">
            <div className={css.lensGroup}>
              {LENSES.map((entry) => (
                <Pill
                  key={entry.id}
                  active={lens === entry.id}
                  aria-pressed={lens === entry.id}
                  onClick={() => {
                    setManualLens(entry.id)
                  }}
                >
                  {t(entry.key)}
                </Pill>
              ))}
            </div>
            {corpus.funnel !== null && (
              <div className={css.funnel}>
                {corpus.funnel.searched > 0 && (
                  <span className={css.funnelChip} data-stage="searched">
                    {interpolate(t('funnelSearched'), { count: corpus.funnel.searched })}
                  </span>
                )}
                {corpus.funnel.read > 0 && (
                  <span className={css.funnelChip} data-stage="read">
                    {interpolate(t('funnelRead'), { count: corpus.funnel.read })}
                  </span>
                )}
                {corpus.funnel.cited > 0 && (
                  <span className={css.funnelChip} data-stage="cited">
                    {interpolate(t('funnelCited'), { count: corpus.funnel.cited })}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className={css.scroller}>
            <div className={css.list}>
              {lens === 'items' ? (
                <ZoteroItemsLens corpus={corpus} t={t} setDraft={setDraft} />
              ) : lens === 'citations' ? (
                <ZoteroCiteLens corpus={corpus} t={t} setDraft={setDraft} />
              ) : (
                <>
                  <div className={css.activityLedger} aria-hidden>
                    <p className={css.activityNote}>
                      {interpolate(t('activityNote'), { count: blocks.length })}
                    </p>
                    <div className={css.activityStrip}>
                      {blocks.map((block) => (
                        <span
                          key={block.callId}
                          className={css.activitySpan}
                          data-activity-span
                          data-kind={callToneOf(block)}
                          data-error={rowStateOf(block) === 'error' || undefined}
                          data-hovered={hoveredCall === block.callId || undefined}
                          style={activityGrowOf(block)}
                          onMouseEnter={() => {
                            setHoveredCall(block.callId)
                          }}
                          onMouseLeave={() => {
                            setHoveredCall(undefined)
                          }}
                        />
                      ))}
                    </div>
                  </div>
                  {blocks.map((block) => (
                    <div
                      key={block.callId}
                      className={css.activityRow}
                      data-hovered={hoveredCall === block.callId || undefined}
                    >
                      <CardFor block={block} t={t} />
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
