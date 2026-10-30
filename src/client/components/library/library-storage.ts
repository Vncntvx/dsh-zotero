/**
 * The panel's two storage tiers.
 *
 * - `localStorage`, keyed by the confirmed Zotero instance, holds the durable
 *   preferences and the view pins (`selectedRef` / `narrowPane`), so a reload
 *   reopens the same place.
 * - The in-memory session view, keyed by session id, holds only what the
 *   durable record cannot: the last ready detail payload and the probe
 *   snapshot. It survives the pane tab unmounting and dies with the session or
 *   the plugin.
 *
 * The filter fields are the wire request's own filters schema, so a value
 * localStorage accepts is a value the wire accepts too.
 */
import { z } from 'zod'
import type { ZoteroStatusView } from '../../../contract.ts'
import {
  zoteroLibraryFiltersSchema,
  zoteroLibrarySchema,
  zoteroLibrarySortSchema,
} from '../../../wire-schemas.ts'
import { REF_PATTERN, type RefKind } from '../../../ref-grammar.ts'
import { messageOf } from '../../error-text.ts'
import type { LibraryItemState, LibraryPane } from './library-model.ts'

const PANES = ['tree', 'list', 'inspector'] as const satisfies readonly LibraryPane[]

const selection = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('library') }).strict(),
  z.object({ kind: z.literal('publications') }).strict(),
  z.object({ kind: z.literal('trash') }).strict(),
  z
    .object({
      kind: z.literal('collection'),
      ref: z.string().min(1),
      name: z.string(),
      path: z.array(z.string()).readonly().optional(),
    })
    .strict(),
  z.object({ kind: z.literal('savedSearch'), ref: z.string().min(1), name: z.string() }).strict(),
])

export const libraryStoredStateSchema = z
  .object({
    version: z.literal(2),
    library: zoteroLibrarySchema,
    selection,
    q: z.string(),
    mode: z.enum(['metadata', 'everything']),
    sort: zoteroLibrarySortSchema,
    direction: z.enum(['asc', 'desc']),
    offset: z.number().int().nonnegative(),
    prefixes: z.record(z.string(), z.number().int().nonnegative()).default({}),
    expanded: z.array(z.string().min(1)),
    filters: zoteroLibraryFiltersSchema,
    selectedRef: z.string().optional(),
    narrowPane: z.enum(PANES).optional(),
  })
  .strict()

export type LibraryStoredState = z.input<typeof libraryStoredStateSchema>

/**
 * What a session keeps across a pane remount: the payload the durable record
 * does not carry. A whole-object write, so clearing is explicit (`undefined`)
 * rather than a side effect of a partial merge.
 */
export interface LibrarySessionView {
  readonly inspector?: LibraryItemState
  readonly lastProbeData?: ZoteroStatusView
}

/** Live sessions per shell; the oldest view is dropped past this bound. */
const MAX_SESSION_VIEW_ENTRIES = 8

const sessionViews = new Map<string, LibrarySessionView>()

export function readLibrarySessionMemory(sessionId: string): LibrarySessionView | undefined {
  return sessionViews.get(sessionId)
}

export function writeLibrarySessionView(sessionId: string, view: LibrarySessionView): void {
  // Re-insert so the most recent session sits last: Map order is the LRU.
  sessionViews.delete(sessionId)
  sessionViews.set(sessionId, view)
  const overflow = Math.max(0, sessionViews.size - MAX_SESSION_VIEW_ENTRIES)
  for (const oldest of [...sessionViews.keys()].slice(0, overflow)) {
    sessionViews.delete(oldest)
  }
}

export function clearLibrarySessionMemory(sessionId?: string): void {
  if (sessionId !== undefined) {
    sessionViews.delete(sessionId)
  } else {
    sessionViews.clear()
  }
}
export const libraryStorageKey = (serverId: string) =>
  `dsh-zotero:library:2:${encodeURIComponent(serverId)}`

/** The selection arms that carry a ref needing a library/instance check. */
function isRefScope(
  selection: LibraryStoredState['selection'],
): selection is Extract<LibraryStoredState['selection'], { ref: string }> {
  return selection.kind === 'collection' || selection.kind === 'savedSearch'
}

/** My Publications exists only in the personal library. */
function publicationsAllowed(library: { readonly type: string }): boolean {
  return library.type === 'user'
}

/** Whether a ref names the same object kind, library, and Zotero instance. */
function sameInstanceRef(
  ref: string,
  kind: RefKind,
  saved: { library: { type: string; id: number } },
  serverId: string,
): boolean {
  const fields = REF_PATTERN.exec(ref)?.groups
  return (
    fields !== undefined &&
    fields.kind === kind &&
    fields.libraryType === saved.library.type &&
    Number(fields.libraryId) === saved.library.id &&
    (fields.serverId === undefined || fields.serverId === serverId)
  )
}

export function readLibraryState(serverId: string): LibraryStoredState | undefined {
  try {
    const raw = localStorage.getItem(libraryStorageKey(serverId))
    if (raw === null) return undefined
    const saved = libraryStoredStateSchema.parse(JSON.parse(raw))
    const validSelection = isRefScope(saved.selection)
      ? sameInstanceRef(
          saved.selection.ref,
          saved.selection.kind === 'savedSearch' ? 'search' : 'collection',
          saved,
          serverId,
        )
      : saved.selection.kind !== 'publications' || publicationsAllowed(saved.library)
    const validSelectedRef =
      saved.selectedRef !== undefined && sameInstanceRef(saved.selectedRef, 'item', saved, serverId)
        ? saved.selectedRef
        : undefined
    return {
      ...saved,
      selection: validSelection ? saved.selection : { kind: 'library' },
      offset: validSelection ? saved.offset : 0,
      expanded: saved.expanded.filter((ref) => sameInstanceRef(ref, 'collection', saved, serverId)),
      selectedRef: validSelectedRef,
    }
  } catch (error) {
    console.warn('dsh-zotero: library.storage.read', messageOf(error))
    return undefined
  }
}

export function writeLibraryState(serverId: string, value: LibraryStoredState): void {
  try {
    localStorage.setItem(libraryStorageKey(serverId), JSON.stringify(value))
  } catch (error) {
    console.warn('dsh-zotero: library.storage.write', messageOf(error))
  }
}
