/**
 * The library-panel specs' shared fixtures and mount: the wire views the panel
 * renders (libraries, collections, saved searches, item pages, one detail),
 * `mountPanel` (the page mounted with stubbed session hooks and a scripted
 * wire face), and the spies the interaction tests read back. `.states` and
 * `.interaction` share this one copy instead of carrying drifting sets.
 * @module tests/client/helpers/library-panel-harness
 */

import { render } from '@testing-library/react'
import { vi, type Mock } from 'vitest'
import type {
  ZoteroItemDetailView,
  ZoteroLibraryBrowseRequestView,
  ZoteroLibraryBrowseResultView,
  ZoteroSearchResultView,
  ZoteroStatusView,
} from '../../../src/client/remote.ts'
import {
  ZoteroLibraryPanel,
  type ZoteroLibraryPanelProps,
} from '../../../src/client/components/library/ZoteroLibraryPanel.tsx'
import { mockT } from './mock-translate.ts'

/** A connected probe answer. */
export const CONNECTED: ZoteroStatusView = {
  providerId: 'local',
  connected: true,
  apiVersion: '3',
  serverId: 'S1',
}

/** One personal-library option and one group option. */
export const LIBRARY_ROWS: ZoteroLibraryBrowseResultView = {
  kind: 'libraries',
  items: [
    { kind: 'library', library: { type: 'user', id: 0 }, name: 'My Library' },
    { kind: 'library', library: { type: 'group', id: 123 }, name: 'Lab Reading' },
  ],
  total: 2,
  offset: 0,
  returned: 2,
  limit: 2,
}

/** Root collections with a parent/child pair, plus one saved search. */
export const ROOT_COLLECTIONS: ZoteroLibraryBrowseResultView = {
  kind: 'collections',
  libraryVersion: 1,
  items: [
    {
      kind: 'collection',
      ref: 'zotero://user/0/collection/COLL0001',
      name: 'LLM Papers',
      path: ['LLM Papers'],
      depth: 0,
    },
    {
      kind: 'collection',
      ref: 'zotero://user/0/collection/COLL0002',
      name: 'Reasoning',
      path: ['Reasoning'],
      depth: 0,
    },
  ],
  total: 2,
  offset: 0,
  returned: 2,
  limit: 2,
}

export const CHILD_COLLECTIONS: ZoteroLibraryBrowseResultView = {
  kind: 'collections',
  libraryVersion: 1,
  items: [
    {
      kind: 'collection',
      ref: 'zotero://user/0/collection/COLL0011',
      name: 'Attention',
      parentRef: 'zotero://user/0/collection/COLL0001',
      path: ['LLM Papers', 'Attention'],
      depth: 1,
    },
  ],
  total: 1,
  offset: 0,
  returned: 1,
  limit: 1,
}

export const SAVED_SEARCHES: ZoteroLibraryBrowseResultView = {
  kind: 'savedSearches',
  libraryVersion: 1,
  items: [
    { kind: 'savedSearch', ref: 'zotero://user/0/search/SEARCH01', name: 'Unread', conditions: [] },
  ],
  total: 1,
  offset: 0,
  returned: 1,
  limit: 1,
}

/** One full page of library hits. */
export function searchPage(
  overrides: Partial<ZoteroSearchResultView> = {},
): ZoteroSearchResultView {
  return {
    scope: { kind: 'library', library: { type: 'user', id: 0 } },
    items: [
      {
        ref: 'zotero://user/0/item/ITEM0001',
        title: 'FlashAttention-2',
        creatorSummary: 'Dao',
        year: 2023,
        itemType: 'conferencePaper',
      },
      {
        ref: 'zotero://user/0/item/ITEM0002',
        title: 'Tree of Thoughts',
        creatorSummary: 'Yao',
        year: 2023,
        itemType: 'conferencePaper',
      },
    ],
    total: 2,
    offset: 0,
    returned: 2,
    limit: 2,
    ...overrides,
  }
}

/** One item detail with all three child listings. */
export const ITEM_DETAIL: ZoteroItemDetailView = {
  ref: 'zotero://user/0/item/ITEM0001',
  itemType: 'conferencePaper',
  title: 'FlashAttention-2',
  creators: [{ creatorType: 'author', firstName: 'Tri', lastName: 'Dao' }],
  date: '2023',
  year: 2023,
  venue: 'NeurIPS',
  doi: '10.0/example',
  abstract: 'Faster attention.',
  abstractTruncated: false,
  tags: ['attention'],
  collections: [{ ref: 'zotero://user/0/collection/COLL0001', name: 'LLM Papers' }],
  children: { total: 2 },
  notes: {
    offset: 0,
    total: 1,
    returned: 1,
    limit: 1,
    items: [{ ref: 'zotero://user/0/item/NOTE0001', text: 'idea', truncated: false }],
  },
  attachments: {
    offset: 0,
    total: 1,
    returned: 1,
    limit: 1,
    items: [
      {
        ref: 'zotero://user/0/item/ATTAC001',
        title: 'paper.pdf',
        contentType: 'application/pdf',
      },
    ],
  },
  annotations: {
    offset: 0,
    total: 1,
    returned: 1,
    limit: 1,
    items: [
      {
        ref: 'zotero://user/0/item/ANNO0001',
        type: 'highlight',
        text: 'faster',
        pageLabel: '3',
      },
    ],
  },
}

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

/** One session snapshot row for the `useSessions` stub. */
export interface SessionStub {
  ids: string[]
  byId: Record<string, { cwd?: string; running?: boolean; removed?: boolean }>
  /** The conversation this pane belongs to; defaults to the first id. */
  paneId?: string
}

export interface MountedPanel {
  view: ReturnType<typeof render>
  face: Record<keyof ScriptedFace, Mock>
  /** The composer stub the panel receives; the chat-action specs assert on it. */
  inputActions: {
    setDraft: Mock
    captureInsertion: Mock
    insertText: Mock
    insertQuote: Mock
    submit: Mock
  }
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
  const inputActions = {
    setDraft: vi.fn(),
    captureInsertion: vi.fn(() => ({ anchor: 0 })),
    insertText: vi.fn(() => true),
    insertQuote: vi.fn(() => true),
    submit: vi.fn(),
  }
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
  let lastSelection: unknown
  let lastStatus: unknown
  const props = {
    t: mockT,
    ...face,
    // The session-scope composer face; the panel picks it up through its
    // `in` guard exactly as the real renderer's prop merge delivers it.
    inputActions,
    // Session-scope standard props: the pane tab is bound to one session.
    sessionId: (sessions.paneId ?? sessions.ids[0] ?? 's1') as never,
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
  return {
    view: render(<ZoteroLibraryPanel {...props} {...surface} />),
    face: face as unknown as MountedPanel['face'],
    inputActions,
  }
}
