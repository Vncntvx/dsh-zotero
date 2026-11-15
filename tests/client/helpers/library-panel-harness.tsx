/**
 * Shared wire fixtures and `mountPanel` for the library-panel state and
 * interaction specs, so they do not carry separate scripted panel faces.
 * @module tests/client/helpers/library-panel-harness
 */

import { render } from '@testing-library/react'
import { vi, type Mock } from 'vitest'
import { inputActionsStub } from './zotero-client.ts'
import { panelStubProps, type SessionStub } from './library-panel-stubs.ts'
export type { SessionStub } from './library-panel-stubs.ts'
import type { ZoteroLibraryBrowseRequestView } from '../../../src/client/remote.ts'
import {
  CHILD_COLLECTIONS,
  CONNECTED,
  ITEM_DETAIL,
  LIBRARY_ROWS,
  ROOT_COLLECTIONS,
  SAVED_SEARCHES,
  searchPage,
} from './library-panel-fixtures.ts'
export {
  CHILD_COLLECTIONS,
  CONNECTED,
  ITEM_DETAIL,
  LIBRARY_ROWS,
  ROOT_COLLECTIONS,
  SAVED_SEARCHES,
  searchPage,
} from './library-panel-fixtures.ts'
import {
  createLibraryViewStore,
  type LibraryViewStore,
} from '../../../src/client/components/library/library-view-store.ts'
import {
  ZoteroLibraryPanel,
  type ZoteroLibraryPanelProps,
} from '../../../src/client/components/library/ZoteroLibraryPanel.tsx'

/** The wire face the specs script; loose, so a scripted spy stays assignable. */
export interface ScriptedFace {
  collectionPath: (request: unknown) => Promise<{ ok: boolean; value?: unknown; error?: unknown }>
  status: () => Promise<{ ok: boolean; value?: unknown; error?: unknown }>
  browse: (
    request: ZoteroLibraryBrowseRequestView,
  ) => Promise<{ ok: boolean; value?: unknown; error?: unknown }>
  search: (request: unknown) => Promise<{ ok: boolean; value?: unknown; error?: unknown }>
  item: (request: unknown) => Promise<{ ok: boolean; value?: unknown; error?: unknown }>
  childPage: (request: unknown) => Promise<{ ok: boolean; value?: unknown; error?: unknown }>
  export: (request: unknown) => Promise<{ ok: boolean; value?: unknown; error?: unknown }>
  invalidate: () => void
  setInstance?: (serverId: string | undefined) => void
  resolveAttachment: (ref: string) => Promise<{ ok: boolean; value?: unknown; error?: unknown }>
  write: (request: unknown) => Promise<{ ok: boolean; value?: unknown; error?: unknown }>
  openResource: (url: string) => void
}

export interface MountedPanel {
  view: ReturnType<typeof render>
  face: Record<keyof ScriptedFace, Mock>
  /** The panel's in-memory view cache; pass one in `surface` to seed it first. */
  viewStore: LibraryViewStore
  /** The composer stub the panel receives; the chat-action specs assert on it. */
  inputActions: {
    setDraft: Mock
    captureInsertion: Mock
    insertText: Mock
    insertQuote: Mock
    submit: Mock
  }
  /** Every `zoteroItem` target the list rows handed to `getTriggerProps`. */
  contextMenuTargets: Array<{ kind: string; value: unknown }>
}

/**
 * Mount the panel with a scripted face and a sessions stub. The default face
 * answers connected, the libraries/collections/searches listings, one item
 * page, and the detail; tests override individual spies before mounting.
 */
export function mountPanel(
  overrides: Partial<Record<keyof ScriptedFace, Mock>> = {},
  sessions: SessionStub = { ids: ['s1'], byId: { s1: { cwd: '/tmp/ws', running: true } } },
  surface: Partial<ZoteroLibraryPanelProps> = {},
): MountedPanel {
  const browse =
    overrides.browse ??
    vi.fn(async (request: ZoteroLibraryBrowseRequestView) => {
      if (request.kind === 'libraries') return { ok: true, value: LIBRARY_ROWS }
      if (request.kind === 'savedSearches') return { ok: true, value: SAVED_SEARCHES }
      if (request.parentRef !== undefined) return { ok: true, value: CHILD_COLLECTIONS }
      return { ok: true, value: ROOT_COLLECTIONS }
    })
  const inputActions = inputActionsStub()
  const face = {
    collectionPath:
      overrides.collectionPath ??
      vi.fn(async (request) => ({
        ok: true,
        value: { library: request.library, libraryVersion: request.libraryVersion, path: [] },
      })),
    status: overrides.status ?? vi.fn(async () => ({ ok: true, value: CONNECTED })),
    browse,
    search: overrides.search ?? vi.fn(async () => ({ ok: true, value: searchPage() })),
    item: overrides.item ?? vi.fn(async () => ({ ok: true, value: ITEM_DETAIL })),
    childPage:
      overrides.childPage ??
      vi.fn(async (request: { kind: string; offset: number; limit: number }) => ({
        ok: true,
        value: {
          kind: request.kind,
          page: { total: 0, returned: 0, offset: request.offset, limit: request.limit, items: [] },
        },
      })),
    invalidate: overrides.invalidate ?? vi.fn(),
    setInstance: overrides.setInstance ?? vi.fn(),
    export:
      overrides.export ??
      vi.fn(async () => ({
        ok: true,
        value: {
          format: 'citation',
          citations: [{ ref: 'zotero://user/0/item/ITEM0001', text: 'Dao, T. (2023).' }],
        },
      })),
    resolveAttachment:
      overrides.resolveAttachment ??
      vi.fn(async () => ({
        ok: true,
        value: {
          ref: 'zotero://user/0/item/ATTAC001',
          kind: 'file',
          title: 'paper.pdf',
          contentType: 'application/pdf',
          path: '/storage/paper.pdf',
        },
      })),
    openResource: overrides.openResource ?? vi.fn(),
    write:
      overrides.write ??
      vi.fn(async () => ({ ok: true, value: { kind: 'applied', message: 'done' } })),
  }
  const viewStore: LibraryViewStore = surface.viewStore ?? createLibraryViewStore()
  const { props, contextMenuTargets } = panelStubProps({
    face: face as unknown as Record<string, unknown>,
    sessions,
    inputActions,
    viewStore,
  })
  return {
    view: render(<ZoteroLibraryPanel {...props} {...surface} />),
    face: face as unknown as MountedPanel['face'],
    viewStore,
    inputActions,
    contextMenuTargets,
  }
}
