/**
 * The Sources panel: the plugin's conversation tab (id `zotero`, order 30).
 * This module is the controller: it reads the session's identity (the id
 * only, since lifecycle churn never re-renders the panel), the chat target's
 * tool-call rows, and the connectivity probe; it builds the source
 * workspace and renders the pure presentation
 * surface `ZoteroWorkspaceView` (fixture-renderable, no session or Zotero
 * needed). The probe runs once on mount and once per explicit refresh, with no
 * timers, and its cancellation is ignore-stale: the Remote face carries no
 * signal by contract, so the aborted probe's result is dropped after settle.
 * Session switches reset the whole surface through the view's `key`; the
 * view keeps its own filter and selection state. Composer prefills go
 * through the injected inputActions.setDraft and never submit.
 * @module dsh-zotero/client/components/SourcesTab
 */

import { ResultSessionContext, receiptOf } from '../result-reader.ts'

import { useEffect, useMemo, useRef, useState } from 'react'
// Session-scope standard props: `useSession` (lifecycle and identity) is
// merged by ui-session, `useChat` (conversation data) by ui-chat; the named
// type imports pull both merges into the program.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { ChatNode, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ZoteroAttachmentLocationView,
  ZoteroLibraryExportRequestView,
  ZoteroLibraryExportResultView,
  ZoteroSourcePageRequestView,
  ZoteroSourcePageResultView,
  ZoteroUrlPdfView,
} from '../../contract.ts'
import type { LibraryPreferences } from '../../library-preferences.js'
import type { ZoteroStatusView } from '../remote.ts'
import { callNameOf, formatTime, isSettledTool } from '../../sources/presenters.js'
import { buildSourceWorkspace } from '../../sources/ledger.js'
import { withEvidenceMatch } from '../../sources/evidence-match.js'
import type {} from '../../session-projection/types.js'
import { ZoteroSurfaceBoundary } from './ZoteroSurfaceBoundary.tsx'
import { projectionGateOf, type ConnectionView } from './workspace/connection.ts'
import { ZoteroWorkspaceView } from './workspace/ZoteroWorkspaceView.tsx'
import { WorkspaceToolbar } from './workspace/WorkspaceToolbar.tsx'
import { useZoteroProbe } from './useZoteroProbe.ts'
import workspaceCss from './workspace/workspace.module.css'

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
  return (
    name !== null &&
    (name.startsWith('zotero_') || (name === 'job_output' && receiptOf(root) !== null))
  )
}

/**
 * Walk the visible call tree once and hand each deduplicated Zotero call to
 * `visit`. The signature and the workspace collector must observe the same
 * recursion, depth bound, and order; keeping this traversal shared prevents a
 * nested call from appearing in one projection but not the other.
 */
function visitVisibleZoteroCalls(
  snapshot: ChatSnapshot | undefined,
  visit: (block: ToolCallBlock, path: readonly string[]) => void,
): void {
  if (snapshot === undefined) return
  const seen = new Set<string>()
  const visitBlock = (block: ToolCallBlock, path: readonly string[], depth: number): void => {
    if (depth > MAX_SUBCALL_DEPTH) return
    if (isZoteroRoot(block) && !seen.has(block.callId)) {
      seen.add(block.callId)
      visit(block, path)
    }
    for (const child of block.subCalls) {
      visitBlock(child, [...path, child.callId], depth + 1)
    }
  }
  for (const { key, root } of visibleToolRoots(snapshot)) visitBlock(root, [key], 1)
}

/** The inject face the tab's slot entry provides. */
export interface SourcesTabFace {
  /** Live connectivity view through the plugin's Remote namespace. */
  status: () => Promise<RemoteResult<ZoteroStatusView>>
  /** Resolve an attachment ref into its local file path or web URL. */
  resolveAttachment?: (ref: string) => Promise<RemoteResult<ZoteroAttachmentLocationView>>
  /** Export one source through the separately permission-gated library endpoint. */
  exportCitation?: (
    request: ZoteroLibraryExportRequestView,
  ) => Promise<RemoteResult<ZoteroLibraryExportResultView>>
  /** Read one bounded page of the trail behind the projection's window. */
  sourcePage?: (
    request: ZoteroSourcePageRequestView,
  ) => Promise<RemoteResult<ZoteroSourcePageResultView>>
  /** Download one URL attachment under the user-reading permission. */
  readUrlPdf?: (
    request: { ref: string },
    signal?: AbortSignal,
  ) => Promise<RemoteResult<ZoteroUrlPdfView>>
  /** Release one reading-file lease; the reader tab that held it is gone. */
  releaseUrlPdf?: (lease: string) => Promise<void>
  /** Publish a reading-file lease under the address the reader tab opens. */
  trackPdf?: (address: string, lease: string, ref: string) => void
  /** Forget a lease whose read failed before the tab opened. */
  forgetPdf?: (address: string) => void
  /** The committed library preferences, read when an action runs. */
  libraryPreferences?: () => LibraryPreferences | undefined
  /**
   * Reveal one resolved resource address in the right sidebar. The tab builds
   * the address itself (it holds the Session identity and reads the workspace
   * root through the standard `useSessions` source); the face only opens it,
   * because the plugin fiber cannot: on this side the `ctx.sessions` Context
   * key is the host `SessionStore`, not the client `ISessions` catalog.
   */
  openResource?: (url: string) => void
}

/** Props the conversation view ring binds for this tab. */
export type SourcesTabProps = PropsRuntime<'conversation.view'> &
  PropsLocale<'zotero'> &
  InjectFace<SourcesTabFace>

/** Clock formatter: absolute time, updated per acquisition (no relative timers). */
export function currentTime(): string {
  return formatTime(new Date(), true)
}

/**
 * A cheap content signature of the zotero-relevant slice: the visible
 * zotero tool-call row order as structured call-id/path entries plus each
 * in-flight call's `callId` and lifecycle `phase`. `snapshot.order` is already
 * the harness's presentation order, so the signature tracks it directly.
 * Streaming chunk publications
 * keep order and phase stable and are skipped; a preparing→start transition
 * changes `phase` (and with it the signature) so the workspace re-renders and
 * reads the call's grown argument view. Settled roots leave `running`.
 * Only zotero rows contribute. Nested Zotero dispatches are included in the
 * same walk as their visible roots, so their arrival or lifecycle change
 * rebuilds the workspace. A settled block whose content changes without an
 * order/running change (late presentation meta) waits one publication:
 * harness evidence blocks are frozen at settle. Encoded with
 * `JSON.stringify` so arbitrary order keys and call ids cannot collide.
 * @param snapshot - the chat snapshot, undefined while none is open.
 * @returns the signature string.
 */
const SNAPSHOT_SIGNATURE_CACHE = new WeakMap<ChatSnapshot, string>()

export function sessionSignatureOf(snapshot: ChatSnapshot | undefined): string {
  if (snapshot === undefined) return ''
  const cached = SNAPSHOT_SIGNATURE_CACHE.get(snapshot)
  if (cached !== undefined) return cached

  const running: Array<{ callId: string; phase: 'preparing' | 'start' }> = []
  const order: Array<{ callId: string; path: readonly string[] }> = []
  visitVisibleZoteroCalls(snapshot, (block, path) => {
    order.push({ callId: block.callId, path })
    // Settled roots carry `kind`; running arms carry the `phase` discriminant.
    if (!isSettledTool(block)) running.push({ callId: block.callId, phase: block.phase })
  })
  const signature = JSON.stringify({ order, running })
  SNAPSHOT_SIGNATURE_CACHE.set(snapshot, signature)
  return signature
}

/**
 * Project one settled Remote result into the connection view. The component
 * checks its own signal before calling this, so an aborted request never
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
 * in transcript order. Only visible tool rows contribute, the same set the
 * harness's own chat projection carries (hidden rows never appear). Iterates
 * `snapshot.order` (already presentation order) instead of re-sorting. Pure
 * over the snapshot: the same log slice renders the same list.
 * @param snapshot - the chat snapshot, undefined while none is open.
 * @returns the ordered zotero call blocks.
 */
export function collectZoteroCalls(snapshot: ChatSnapshot | undefined): ToolCallBlock[] {
  const out: ToolCallBlock[] = []
  visitVisibleZoteroCalls(snapshot, (block) => {
    out.push(block)
  })
  return out
}

/**
 * Signature-gated Zotero call collection for the Sources panel.
 * @param chat - the chat snapshot, undefined while none is open.
 * @param sessionId - the owning session identity; forked sessions must not share blocks.
 * @returns the ordered zotero call blocks.
 */
function useZoteroBlocks(chat: ChatSnapshot | undefined, sessionId?: string): ToolCallBlock[] {
  const signature = useMemo(
    () => `${sessionId ?? ''}:${sessionSignatureOf(chat)}`,
    [chat, sessionId],
  )
  // Keyed on the signature, not on `chat`: streaming publications keep the
  // zotero order and in-flight set stable, so the deep collection below skips
  // them. Nested dispatch arrivals and lifecycle changes are part of that
  // signature (see `sessionSignatureOf`).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- signature is the intentional gate
  return useMemo(() => collectZoteroCalls(chat), [signature])
}

/**
 * The chat-subscription equality the panel subscribes with: two snapshots are
 * equivalent when their zotero-visible slice signs the same. Streaming
 * publications (assistant tokens, streamed argument prefixes) then keep the
 * previous snapshot identity, so the panel neither re-renders nor re-walks the
 * tree for content that cannot change its output.
 */
function sameZoteroProjection(a: ChatSnapshot | undefined, b: ChatSnapshot | undefined): boolean {
  return sessionSignatureOf(a) === sessionSignatureOf(b)
}

interface SourcesTabBodyProps extends SourcesTabProps {
  readonly sessionId: SourcesTabProps['sessionId']
}

/** The Sources panel controller: probe, workspace build, and the view. */
export function SourcesTab(props: SourcesTabProps) {
  // The body sits inside an error boundary that resets when the session changes.
  const sessionId = props.useSession((snapshot) => snapshot.sessionId)
  const client = props.useZoteroClient()
  return (
    <ZoteroSurfaceBoundary
      resetKey={sessionId}
      t={props.t}
      surface="sources"
      report={client.reportClientError}
    >
      <SourcesTabBody {...props} sessionId={sessionId} />
    </ZoteroSurfaceBoundary>
  )
}

/** The panel body: probe, workspace build, and the pure view. */
function SourcesTabBody({
  status,
  resolveAttachment,
  exportCitation,
  sourcePage,
  readUrlPdf,
  releaseUrlPdf,
  trackPdf,
  forgetPdf,
  libraryPreferences,
  openResource,
  t,
  sessionId,
  useChat,
  useSessions,
  useProjection,
  useRemoteAccess,
  useZoteroClient,
  inputActions,
}: SourcesTabBodyProps) {
  const client = useZoteroClient()
  // The workspace root for file address resolution. Read from the standard
  // session catalog (`useSessions`) because on the browser side `ctx.sessions`
  // resolves to the host `SessionStore` (both client and host share the program,
  // and the host `ISessions` declaration takes precedence).
  const cwd = useSessions((snapshot) => snapshot.byId[sessionId]?.cwd)
  const chat = useChat((snapshot) => snapshot, sameZoteroProjection)
  // The trail itself is local session data; only its wire-backed controls are
  // gated. A refused action would fail at the gateway, so the panel skips the
  // request and says why instead of rendering a permanent error.
  const canStatus = useRemoteAccess('zotero/status')
  const canResolve = useRemoteAccess('zotero/resolveAttachment')
  const canExport = useRemoteAccess('zotero/export')
  const canOpen = useRemoteAccess('zotero/openProtocol')
  const canReadUrlPdf = useRemoteAccess('zotero/readUrlPdf')
  const { state: probeState, runProbe } = useZoteroProbe(status, {
    initialAutoRun: true,
    enabled: canStatus,
  })
  const [checkedAt, setCheckedAt] = useState<string>(() => currentTime())
  const prevDataRef = useRef(probeState.data)

  useEffect(() => {
    if (probeState.data !== undefined && probeState.data !== prevDataRef.current) {
      prevDataRef.current = probeState.data
      setCheckedAt(currentTime())
    }
  }, [probeState.data])

  const statusState: ConnectionView = useMemo(() => {
    if (!canStatus) return { kind: 'no-access' }
    if (probeState.data !== undefined) {
      return probeState.data.connected
        ? { kind: 'connected', data: probeState.data, checkedAt }
        : { kind: 'unavailable', data: probeState.data, checkedAt }
    }
    if (probeState.error !== undefined) {
      return { kind: 'remote-error', message: probeState.error }
    }
    return { kind: 'loading' }
  }, [canStatus, probeState.data, probeState.error, checkedAt])

  const serverId = probeState.data?.connected ? probeState.data.serverId : undefined
  // Streaming-stable zotero rows reuse the previous block array (signature gate).
  const blocks = useZoteroBlocks(chat, sessionId)
  // The host projection folds the whole session log; the chat snapshot only
  // holds the opening window. Local folding is valid only when the host status
  // endpoint says the projection registry is not composed.
  const projected = useProjection('zoteroSources')
  const setDraft = useMemo(
    () => (inputActions === undefined ? undefined : inputActions.setDraft.bind(inputActions)),
    [inputActions],
  )

  const projection = probeState.data?.sourceProjection
  const projectionState = projection?.state
  // A useMemo must precede the early return below: hooks may not follow a
  // conditional return, and the fold must keep a stable identity across probe
  // refreshes — withEvidenceMatch materializes a fresh object on every call,
  // and the workspace views memoize off its sources and exports. A projection
  // present while the registry is declared not composed is a contradictory
  // stub state; the fold answers it locally rather than trusting the value.
  const workspace = useMemo(() => {
    if (projected !== undefined && projectionState !== 'not-composed') {
      return withEvidenceMatch(projected, serverId)
    }
    return buildSourceWorkspace(blocks, { currentServerId: serverId })
  }, [projected, projectionState, blocks, serverId])
  const projectionProblem = projectionGateOf({
    projection,
    hasProjected: projected !== undefined,
    canStatus,
    hasStatus: status !== undefined,
    hasProbeError: probeState.error !== undefined,
    t,
  })

  if (projectionProblem !== undefined) {
    return (
      <ResultSessionContext.Provider value={sessionId}>
        <>
          <WorkspaceToolbar connection={statusState} onRefresh={runProbe} t={t} />
          <div className={workspaceCss.empty}>
            <p
              role={projectionState === 'failed' ? 'alert' : 'status'}
              className={workspaceCss.emptyText}
            >
              {projectionProblem}
            </p>
          </div>
        </>
      </ResultSessionContext.Provider>
    )
  }

  // The URL-PDF opener the evidence jump prefers over the resolved-path
  // fallback. It mirrors the library panel's flow: resolve, then either open
  // the local file the resolver named or download under the user-reading
  // permission. The lease follows the reader tab through the shared registry,
  // so closing the tab releases the file.
  const readPdf =
    openResource === undefined || !canResolve || resolveAttachment === undefined
      ? undefined
      : async (ref: string): Promise<void> => {
          const location = await resolveAttachment(ref)
          if (!location.ok) throw location.error
          if (location.value.kind === 'file') {
            if (!location.value.path) throw new Error(t('pdfFileNotFound'))
            openResource(fileAddressFor(sessionId, cwd, location.value.path))
            return
          }
          const preferences = libraryPreferences?.()
          if (!preferences?.allowUrlPdfRead) throw new Error(t('libraryUrlPdfDisabled'))
          if (!canReadUrlPdf || readUrlPdf === undefined || trackPdf === undefined) {
            throw new Error(t('libraryPdfReaderUnavailable'))
          }
          const pdf = await readUrlPdf({ ref })
          if (!pdf.ok) throw pdf.error
          const address = fileAddressFor(sessionId, cwd, pdf.value.path)
          trackPdf(address, pdf.value.lease, pdf.value.ref)
          try {
            openResource(address)
          } catch (error) {
            forgetPdf?.(address)
            await releaseUrlPdf?.(pdf.value.lease)
            throw error
          }
        }

  return (
    <ResultSessionContext.Provider value={sessionId}>
      <ZoteroWorkspaceView
        key={sessionId ?? 'none'}
        workspace={workspace}
        connection={statusState}
        setDraft={setDraft}
        onRefresh={runProbe}
        openFile={
          openResource === undefined
            ? undefined
            : (path: string) => {
                openResource(fileAddressFor(sessionId, cwd, path))
              }
        }
        resolveAttachment={canResolve ? resolveAttachment : undefined}
        canExport={canExport}
        exportCitation={canExport ? exportCitation : undefined}
        sessionId={sessionId}
        sourcePage={sourcePage}
        openPdf={readPdf}
        openProtocol={canOpen ? client.openProtocol : undefined}
        t={t}
      />
    </ResultSessionContext.Provider>
  )
}
