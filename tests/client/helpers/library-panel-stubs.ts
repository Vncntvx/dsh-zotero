/**
 * The shell props every library-panel spec mounts with: the stubbed session,
 * tab, access, context-menu and composer hooks the panel reads.
 *
 * They live apart from `mountPanel` so the harness stays inside its size
 * ratchet; the fixtures and the scripted wire face stay with the mount.
 * @module tests/client/helpers/library-panel-stubs
 */

import type { ZoteroLibraryPanelProps } from '../../../src/client/components/library/ZoteroLibraryPanel.tsx'
import type { LibraryViewStore } from '../../../src/client/components/library/library-view-store.ts'
import { mockT } from './mock-translate.ts'
import { zoteroClientStub } from './zotero-client.ts'

/** One session snapshot row for the `useSessions` stub. */
export interface SessionStub {
  ids: string[]
  byId: Record<string, { cwd?: string; running?: boolean; removed?: boolean }>
  /** The conversation this pane belongs to; defaults to the first id. */
  paneId?: string
}

/** What the stub props need from one mount. */
export interface PanelStubInput {
  /** The scripted wire face, spread into the props. */
  readonly face: Record<string, unknown>
  readonly sessions: SessionStub
  readonly inputActions: unknown
  readonly viewStore: LibraryViewStore
}

/** The stub props plus the context-menu targets they record. */
export interface PanelStubs {
  readonly props: ZoteroLibraryPanelProps
  /** Every `zoteroItem` target the list rows handed to `getTriggerProps`. */
  readonly contextMenuTargets: Array<{ kind: string; value: unknown }>
}

/**
 * Build the shell props for one mount.
 * @param input - the scripted face, sessions and the panel's view store.
 * @returns the props and the context-menu target log.
 */
export function panelStubProps(input: PanelStubInput): PanelStubs {
  const { face, sessions, inputActions, viewStore } = input
  // The pane-tab occurrence: its signal is what the view memory keys on.
  const occurrence = new AbortController()
  let lastSelection: unknown
  let lastStatus: unknown
  const contextMenuTargets: Array<{ kind: string; value: unknown }> = []
  const props = {
    t: mockT,
    useZoteroClient: zoteroClientStub,
    useTabInfo: () => ({
      tab: {
        id: 'library',
        signal: occurrence.signal,
        visible: true,
        actions: { openResource: face.openResource },
      },
    }),
    ...face,
    useContextMenu: () => ({
      getTriggerProps: (target: { kind: string; value: unknown }) => {
        contextMenuTargets.push(target)
        return {}
      },
    }),
    inputActions,
    viewStore,
    // Session-scope standard props: the pane tab is bound to one session.
    sessionId: (sessions.paneId ?? sessions.ids[0] ?? 's1') as never,
    // The access hooks default to the owner's grants; a viewer spec overrides
    // one through the surface argument.
    useAccess: (() => true) as never,
    useRemoteAccess: (() => true) as never,
    useSession: (select: (snapshot: unknown) => unknown) => {
      const paneId = sessions.paneId ?? sessions.ids[0] ?? 's1'
      return select({
        sessionId: paneId,
        running: sessions.byId[paneId]?.running === true,
        removed: sessions.byId[paneId]?.removed === true,
      })
    },
    useSessionStatus: (
      select: (snapshot: Map<string, { running: boolean }>) => unknown,
      eq?: (a: unknown, b: unknown) => boolean,
    ) => {
      const next = select(
        new Map(sessions.ids.map((id) => [id, { running: sessions.byId[id]?.running === true }])),
      )
      if (lastStatus !== undefined && eq?.(lastStatus, next)) return lastStatus
      lastStatus = next
      return next
    },
    // Memoize through the eq contract the store's hook honors: an equal
    // selection keeps object identity across renders, a changed one replaces
    // it. The stub reads the mutable `sessions` object live, so a test can
    // move the anchor mid-test.
    useSessions: (
      select: (snapshot: SessionStub) => unknown,
      eq?: (a: unknown, b: unknown) => boolean,
    ) => {
      const next = select(sessions)
      if (lastSelection !== undefined && eq?.(lastSelection, next)) return lastSelection
      lastSelection = next
      return next
    },
  } as unknown as ZoteroLibraryPanelProps
  return { props, contextMenuTargets }
}
