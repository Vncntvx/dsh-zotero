/**
 * The panel's durable browsing position.
 *
 * `localStorage`, keyed by the confirmed Zotero instance and session, holds the
 * durable browsing position and the view pins (`selectedRef` / `narrowPane`),
 * so a reload reopens the same place. The second tier — the last ready detail
 * payload and the probe snapshot, which the durable record cannot carry — lives
 * in `library-view-store.ts`, owned by the client registration rather than by
 * this module.
 *
 * The filter fields are the wire request's own filters schema, so a value
 * localStorage accepts is a value the wire accepts too.
 */
import { z } from 'zod'
import {
  zoteroLibraryFiltersSchema,
  zoteroLibrarySchema,
  zoteroLibrarySortSchema,
} from '../../../wire-schemas.ts'
import { refFieldsOf, type RefKind } from '../../../ref-grammar.ts'
import { messageOf } from '../../error-text.ts'
import type { LibraryPane } from './library-model.ts'

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

const libraryStoredStateSchema = z
  .object({
    version: z.literal(4),
    library: zoteroLibrarySchema,
    selection,
    q: z.string(),
    sort: zoteroLibrarySortSchema,
    direction: z.enum(['asc', 'desc']),
    offset: z.number().int().nonnegative(),
    prefixes: z.record(z.string(), z.number().int().nonnegative()).default({}),
    expanded: z.array(z.string().min(1)),
    filters: zoteroLibraryFiltersSchema,
    childPages: z
      .object({
        attachments: z.number().int().nonnegative().optional(),
        notes: z.number().int().nonnegative().optional(),
        annotations: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    scroll: z.record(z.string(), z.number().nonnegative()).optional(),
    selectedRef: z.string().optional(),
    narrowPane: z.enum(PANES).optional(),
  })
  .strict()

export type LibraryStoredState = z.infer<typeof libraryStoredStateSchema>

export const libraryStorageKey = (serverId: string, sessionId: string) =>
  `dsh-zotero:library:4:${encodeURIComponent(serverId)}:${encodeURIComponent(sessionId)}`

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
  const fields = refFieldsOf(ref)
  return (
    fields !== undefined &&
    fields.kind === kind &&
    fields.libraryType === saved.library.type &&
    Number(fields.libraryId) === saved.library.id &&
    (fields.serverId === undefined || fields.serverId === serverId)
  )
}

export function readLibraryState(
  serverId: string,
  sessionId: string,
): LibraryStoredState | undefined {
  let raw: string | null
  try {
    raw = localStorage.getItem(libraryStorageKey(serverId, sessionId))
  } catch (error) {
    // The store itself is unavailable (quota, privacy mode): surface it.
    throw new Error(messageOf(error))
  }
  if (raw === null) return undefined
  // A record the parser or schema refuses is a leftover from an older client
  // or damaged bytes. The position is a convenience, so it is dropped quietly
  // and the next persist overwrites the key — a banner for it would block the
  // panel on data this client can never use. Only the cross-instance conflict
  // below is a real state conflict worth a visible notice.
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  const result = libraryStoredStateSchema.safeParse(parsed)
  if (!result.success) return undefined
  const saved = result.data
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
  if (
    !validSelection ||
    (saved.selectedRef !== undefined && !validSelectedRef) ||
    saved.expanded.some((ref) => !sameInstanceRef(ref, 'collection', saved, serverId))
  ) {
    throw new Error(
      'Stored browsing position contains a reference outside its Zotero instance or library. Reset this conversation’s browsing position to continue.',
    )
  }
  return saved
}

export function writeLibraryState(
  serverId: string,
  sessionId: string,
  value: LibraryStoredState,
): void {
  try {
    localStorage.setItem(libraryStorageKey(serverId, sessionId), JSON.stringify(value))
  } catch (error) {
    throw new Error(messageOf(error))
  }
}

/** Explicitly forget only one instance/conversation. */
export function clearLibraryState(serverId: string, sessionId: string): void {
  localStorage.removeItem(libraryStorageKey(serverId, sessionId))
}

/** A deleted conversation cannot leave positions for any Zotero instance in this browser. */
export function clearLibraryConversationState(sessionId: string): void {
  const suffix = `:${encodeURIComponent(sessionId)}`
  const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
  for (const key of keys) {
    if (key === null || !key.startsWith('dsh-zotero:library:') || !key.endsWith(suffix)) continue
    localStorage.removeItem(key)
  }
}
