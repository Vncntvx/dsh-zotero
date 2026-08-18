/**
 * The Sources panel: the plugin's conversation tab (id `zotero`, order 30).
 * This module is the controller: it reads the session and the connectivity
 * probe, builds the source workspace, and renders the pure presentation
 * surface `ZoteroWorkspaceView` (fixture-renderable, no session or Zotero
 * needed). The probe runs once on mount and once per explicit refresh — no
 * timers — and its cancellation is ignore-stale: the Remote face carries no
 * signal by contract, so the aborted probe's result is dropped after settle.
 * Session switches reset the whole surface through the view's `key`; the
 * view keeps its own filter and selection state. Composer prefills go
 * through the injected inputActions.setDraft and never submit.
 * @module dsh-zotero/client/components/SourcesTab
 */

import { useEffect, useMemo, useState } from 'react'
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
import type { ConnectionView } from './workspace/connection.ts'
import { ZoteroWorkspaceView } from './workspace/ZoteroWorkspaceView.tsx'

/** The inject face the tab's slot entry provides. */
export interface SourcesTabFace {
  /** Live connectivity view through the plugin's Remote namespace. */
  status: () => Promise<RemoteResult<ZoteroStatusView>>
}

/** Props the conversation view ring binds for this tab. */
export type SourcesTabProps = PropsRuntime<'conversation.view'> &
  PropsLocale<'zotero'> &
  InjectFace<SourcesTabFace>

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
 * Project one settled Remote result into the connection view. The component
 * checks its own signal before calling this — an aborted request never
 * reaches it.
 * @param result - the settled remote result.
 * @param checkedAt - the absolute acquisition time to display.
 * @returns the connection view to render.
 */
export function stateOf(result: RemoteResult<ZoteroStatusView>, checkedAt: string): ConnectionView {
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

/** The Sources panel controller: probe, workspace build, and the view. */
export function SourcesTab({ status, t, useSession, inputActions }: SourcesTabProps) {
  const session = useSession((snapshot) => snapshot)
  const [statusState, setStatusState] = useState<ConnectionView>({ kind: 'loading' })
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
      let result: RemoteResult<ZoteroStatusView>
      try {
        result = await status()
      } catch (error) {
        // The Remote face folds carrier failures into `ok: false`, so a
        // rejection is an assembly fault. Surface it as a remote error
        // instead of leaving the surface stuck on loading.
        if (controller.signal.aborted) return
        setStatusState({
          kind: 'remote-error',
          message: error instanceof Error ? error.message : String(error),
        })
        setServerId(undefined)
        return
      }
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

  return (
    <ZoteroWorkspaceView
      key={session?.sessionId ?? 'none'}
      workspace={workspace}
      connection={statusState}
      sessionId={session?.sessionId ?? 'none'}
      setDraft={setDraft}
      onRefresh={refresh}
      t={t}
    />
  )
}
