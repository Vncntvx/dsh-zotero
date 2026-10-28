/**
 * Versioned panel preferences, isolated by the confirmed Zotero instance.
 * The filter fields are the wire request's own filters schema, so a value
 * localStorage accepts is a value the wire accepts too.
 */
import { z } from 'zod'
import {
  zoteroLibraryFiltersSchema,
  zoteroLibrarySchema,
  zoteroLibrarySortSchema,
} from '../../../wire-schemas.ts'
import { REF_PATTERN, type RefKind } from '../../../ref-grammar.ts'
import { messageOf } from '../../error-text.ts'

const selection = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('library') }).strict(),
  z.object({ kind: z.literal('publications') }).strict(),
  z.object({ kind: z.literal('trash') }).strict(),
  z.object({ kind: z.literal('collection'), ref: z.string().min(1), name: z.string() }).strict(),
  z.object({ kind: z.literal('savedSearch'), ref: z.string().min(1), name: z.string() }).strict(),
])

export const libraryStoredStateSchema = z
  .object({
    version: z.literal(1),
    library: zoteroLibrarySchema,
    selection,
    q: z.string(),
    mode: z.enum(['metadata', 'everything']),
    sort: zoteroLibrarySortSchema,
    direction: z.enum(['asc', 'desc']),
    offset: z.number().int().nonnegative(),
    expanded: z.array(z.string().min(1)),
    filters: zoteroLibraryFiltersSchema,
  })
  .strict()

export type LibraryStoredState = z.infer<typeof libraryStoredStateSchema>
export const libraryStorageKey = (serverId: string) =>
  `dsh-zotero:library:1:${encodeURIComponent(serverId)}`

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
    return {
      ...saved,
      selection: validSelection ? saved.selection : { kind: 'library' },
      offset: validSelection ? saved.offset : 0,
      expanded: saved.expanded.filter((ref) => sameInstanceRef(ref, 'collection', saved, serverId)),
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
