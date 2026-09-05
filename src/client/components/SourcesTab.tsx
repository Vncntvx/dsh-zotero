/**
 * The Sources panel: the plugin's conversation tab (id `zotero`, order 30).
 * This module is the controller: it reads the session's identity (the id
 * only — lifecycle churn never re-renders the panel), the chat target's
 * tool-call rows, and the connectivity probe; it builds the source
 * workspace and renders the pure presentation
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
// Session-scope standard props: `useSession` (lifecycle and identity) is
// merged by ui-session, `useChat` (conversation data) by ui-chat — the named
// type imports pull both merges into the program.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { ChatNode, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroStatusView } from '../remote.ts'
import { callNameOf, isSettledTool } from '../presenters.ts'
import { buildSourceWorkspace } from '../sources/reducer.ts'
import type { ConnectionView } from './workspace/connection.ts'
import { ZoteroWorkspaceView } from './workspace/ZoteroWorkspaceView.tsx'

/** Defensive recursion bound for nested dispatch trees (the harness block type is unbounded). */
const MAX_SUBCALL_DEPTH = 256

/**
 * The visible tool-call rows in presentation order: one `order` walk shared
 * by the signature and the collector, so the traversal logic lives once.
 * @param snapshot - the chat snapshot, undefined while none is open.
 * @returns the visible tool roots with their stable order keys.
 */
function visibleToolRoots(snapshot: ChatSnapshot | undefined): Array<{
  readonly key: string
  readonly root: ToolCallBlock
}> {
  if (snapshot === undefined) return []
  const out: Array<{ readonly key: string; readonly root: ToolCallBlock }> = []
  for (const key of snapshot.order) {
    const node = snapshot.nodes.get(key) as ChatNode | undefined
    if (node?.kind !== 'tool-call' || node.visibility !== 'visible') continue
    out.push({ key, root: node.data.root })
  }
  return out
}

/** True for the plugin's own tool names (settled and running forms). */
function isZoteroRoot(root: ToolCallBlock): boolean {
  const name = callNameOf(root)
  return name !== null && name.startsWith('zotero_')
}

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
 * A cheap content signature of the zotero-relevant slice: the visible
 * zotero tool-call row order plus the in-flight call ids. `snapshot.order`
 * is already the harness's presentation order, so the signature tracks it
 * directly — streaming chunk publications keep the order and the in-flight
 * set stable, so the call collection (and with it the workspace rebuild)
 * skips them. Only zotero rows contribute, so unrelated tool activity never
 * rebuilds the workspace. A nested dispatch appearing under an already
 * running call keeps that call's id, so it lands with the next signature
 * change — an accepted delay, not an omission. Encoded with `JSON.stringify`
 * so arbitrary order keys and call ids (the harness never promises they
 * exclude control characters) cannot collide.
 * @param snapshot - the chat snapshot, undefined while none is open.
 * @returns the signature string.
 */
export function sessionSignatureOf(snapshot: ChatSnapshot | undefined): string {
  if (snapshot === undefined) return ''
  const running: string[] = []
  const order: string[] = []
  for (const { key, root } of visibleToolRoots(snapshot)) {
    if (!isZoteroRoot(root)) continue
    order.push(key)
    // The tool row's root lifecycle value: settled roots carry `kind`, in-flight ones do not.
    if (!isSettledTool(root)) running.push(root.callId)
  }
  return JSON.stringify({ order, running })
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
 * calls, including nested dispatch (PTC mode), deduplicated by callId and
 * in transcript order. Only visible tool rows contribute — the same set the
 * harness's own compatibility projection carries. Iterates `snapshot.order`
 * (already presentation order) instead of re-sorting. Pure over the
 * snapshot — the same log slice renders the same list.
 * @param snapshot - the chat snapshot, undefined while none is open.
 * @returns the ordered zotero call blocks.
 */
export function collectZoteroCalls(snapshot: ChatSnapshot | undefined): ToolCallBlock[] {
  if (snapshot === undefined) return []
  const out: ToolCallBlock[] = []
  const seen = new Set<string>()
  const visit = (block: ToolCallBlock, depth: number): void => {
    if (depth > MAX_SUBCALL_DEPTH) return
    if (isZoteroRoot(block) && !seen.has(block.callId)) {
      seen.add(block.callId)
      out.push(block)
    }
    for (const child of block.subCalls) visit(child, depth + 1)
  }
  for (const { root } of visibleToolRoots(snapshot)) {
    // The row's root block owns the whole recursive subcall tree (PTC mode).
    visit(root, 1)
  }
  return out
}

/** The Sources panel controller: probe, workspace build, and the view. */
export function useZoteroBlocks(chat: ChatSnapshot | undefined): ToolCallBlock[] {
  const signature = useMemo(() => sessionSignatureOf(chat), [chat])
  // Keyed on the signature, not on `chat`: streaming publications keep the
  // zotero order and in-flight set stable, so the deep collection below skips
  // them. A nested dispatch under an already running call likewise waits for
  // the next signature change (see `sessionSignatureOf`). The `chat` read
  // stays visible so the hooks lint sees the true dependency — the memo only
  // reuses the previous blocks while the signature is unchanged. Localized
  // here so the suppression lives in exactly one place.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => collectZoteroCalls(chat), [signature])
}

/** The Sources panel controller: probe, workspace build, and the view. */
export function SourcesTab({ status, t, useSession, useChat, inputActions }: SourcesTabProps) {
  // The session selector takes the primitive id, so lifecycle churn during a
  // turn (running flips, queue, error fields) never re-renders the panel; the
  // chat selector takes the snapshot itself — its identity tracks the
  // publication stream — and the signature below gates the rebuilds.
  const sessionId = useSession((snapshot) => snapshot.sessionId)
  const chat = useChat((snapshot) => snapshot)
  const [statusState, setStatusState] = useState<ConnectionView>({ kind: 'loading' })
  const [requestId, setRequestId] = useState(0)
  // The last verified instance id feeds the provenance verdicts. It updates
  // only when a connected probe settles — a refresh's loading flip must not
  // drop it, or the workspace would rebuild twice per probe.
  const [serverId, setServerId] = useState<string | undefined>(undefined)
  // The signature gate lives inside `useZoteroBlocks`: streaming publications
  // keep the zotero order and in-flight set stable, so the deep collection
  // (and with it the workspace rebuild) skips them.
  const blocks = useZoteroBlocks(chat)
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
      key={sessionId ?? 'none'}
      workspace={workspace}
      connection={statusState}
      sessionId={sessionId ?? 'none'}
      setDraft={setDraft}
      onRefresh={refresh}
      t={t}
    />
  )
}
