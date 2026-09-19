/**
 * The write domain: research notes, tags, and collection membership against
 * the Local API's write endpoints. Every function here owns the full write
 * lifecycle the Zotero 10 protocol implies:
 *
 * - the target is always the personal library (`users/0`); a ref naming a
 *   group or a foreign user id is refused before any network happens;
 * - the serving instance id is established (and pinned) before any read or
 *   write, because every write must carry `Zotero-Server-ID`;
 * - the API key comes from {@link WriteAuthorizer}, and a 401 replays the
 *   same request exactly once after a fresh authorization — single-use keys
 *   are consumed at authentication time, so a burned key is forgotten;
 * - tag and collection updates are read-merge-write under an
 *   `If-Unmodified-Since-Version` precondition: PATCH merges arrays
 *   wholesale, so the merged list must be sent whole;
 * - one object per batch means a Zotero refusal surfaces as a typed error,
 *   never as a silently skipped entry in a bucket.
 *
 * There is no retry beyond the re-authorization replay, and a version
 * conflict (412) is reported as `ZOTERO_WRITE_CONFLICT` for the model to
 * re-run — the tool re-reads and reapplies on top of what is there now.
 * @module dsh-zotero/local/write-domain
 */

import type { ZoteroHttpClient } from '../http-client.js'
import { ZOTERO_SERVER_ID_HEADER } from '../constants.js'
import {
  WRITE_CHILD_COLLECTIONS_MESSAGE,
  WRITE_IDENTITY_UNSUPPORTED_MESSAGE,
  WRITE_UNAUTHORIZED_AFTER_AUTH_MESSAGE,
  WRITE_VERSION_MISSING_MESSAGE,
  writeLibraryUnsupportedMessage,
  writeObjectRefusedMessage,
  ZOTERO_CAPABILITY_UNAVAILABLE,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_NOT_FOUND,
  ZOTERO_NOT_IMPLEMENTED,
  ZOTERO_UNEXPECTED,
  ZOTERO_WRITE_CONFLICT,
  ZOTERO_WRITE_UNAUTHORIZED,
  ZoteroError,
} from '../errors.js'
import { asRecord, asString, stringArrayOf } from '../json.js'
import {
  formatRef,
  libraryPrefix,
  parseZoteroRelationUri,
  PERSONAL_LIBRARY,
  refForLibrary,
  requireSupportedLocalRef,
} from '../refs.js'
import { markdownToNoteHtml } from './note-format.js'
import type { WriteAuthorizer } from '../write-auth.js'
import type { ZoteroWriteHttpClient, ZoteroWriteObjectFailure } from '../write-http.js'
import type {
  ZoteroCollectionAddRequest,
  ZoteroCollectionAddResult,
  ZoteroCreateNoteRequest,
  ZoteroCreateNoteResult,
  ZoteroObjectRef,
  ZoteroTagUpdateRequest,
  ZoteroTagUpdateResult,
} from '../types.js'

/** The collaborators one write-domain call needs; built per call by the provider. */
export interface WriteDomainDeps {
  readonly client: ZoteroHttpClient
  readonly writer: ZoteroWriteHttpClient
  readonly authorizer: WriteAuthorizer
}

/** One item's write-relevant state, read fresh for every read-merge-write. */
interface ItemSnapshot {
  readonly version: number
  readonly tags: readonly { readonly tag: string; readonly type?: number }[]
  readonly collectionKeys: readonly string[]
  readonly serverId: string | undefined
}

/** True when the error is Zotero refusing the write for a missing or consumed key. */
function isWriteUnauthorized(error: unknown): boolean {
  return error instanceof ZoteroError && error.code === ZOTERO_WRITE_UNAUTHORIZED
}

/**
 * The one legitimate write replay: authorize, send once; on a 401 forget the
 * key (single-use keys are consumed at authentication, and a stored grant may
 * have been revoked), authorize again, send the identical request once more.
 * A second 401 escalates with the after-authorization guidance; a one-time
 * key is always forgotten once its write settles, consumed either way.
 */
async function withWriteKey<T>(
  deps: WriteDomainDeps,
  serverId: string,
  signal: AbortSignal | undefined,
  send: (apiKey: string) => Promise<T>,
): Promise<T> {
  const first = await deps.authorizer.keyFor(serverId, signal)
  try {
    return await send(first.key)
  } catch (error) {
    if (!isWriteUnauthorized(error)) throw error
    deps.authorizer.forget(first.key)
    const second = await deps.authorizer.keyFor(serverId, signal)
    try {
      return await send(second.key)
    } catch (retried) {
      if (isWriteUnauthorized(retried)) {
        deps.authorizer.forget(second.key)
        throw new ZoteroError(WRITE_UNAUTHORIZED_AFTER_AUTH_MESSAGE, ZOTERO_WRITE_UNAUTHORIZED, {
          cause: retried,
        })
      }
      throw retried
    } finally {
      if (second.oneTime) deps.authorizer.forget(second.key)
    }
  } finally {
    if (first.oneTime) deps.authorizer.forget(first.key)
  }
}

/**
 * The instance id every write must carry. The read client remembers it from
 * the latest response; when this process has read nothing yet, one probe of
 * `/api/` establishes it. A build that reports no instance id has no local
 * write protocol to talk to.
 */
async function ensureServerId(deps: WriteDomainDeps, signal?: AbortSignal): Promise<string> {
  const remembered = deps.client.serverId
  if (remembered !== undefined) return remembered
  await deps.client.get('', undefined, { signal })
  const id = deps.client.serverId
  if (id === undefined) {
    throw new ZoteroError(WRITE_IDENTITY_UNSUPPORTED_MESSAGE, ZOTERO_NOT_IMPLEMENTED)
  }
  return id
}

/**
 * The ref a write targets: a supported local library, one of the requested
 * kinds, and always the personal library — the write contract covers
 * `zotero://user/0/...` and nothing else.
 */
function requireWritableRef(
  ref: ZoteroObjectRef,
  kinds: readonly ZoteroObjectRef['kind'][],
): ZoteroObjectRef {
  requireSupportedLocalRef(ref, kinds)
  if (ref.library.type !== 'user' || ref.library.id !== 0) {
    throw new ZoteroError(writeLibraryUnsupportedMessage(ref.library), ZOTERO_INVALID_ARGUMENT)
  }
  return ref
}

/** Read one item's write-relevant state, pinning the read to the instance the write will target. */
async function readItem(
  deps: WriteDomainDeps,
  ref: ZoteroObjectRef,
  serverId: string,
  signal?: AbortSignal,
): Promise<ItemSnapshot> {
  const { json, headers } = await deps.client.getJson<unknown>(
    `${libraryPrefix(PERSONAL_LIBRARY)}/items/${ref.key}`,
    undefined,
    { signal, serverId },
  )
  const record = asRecord(json)
  const version = typeof record?.version === 'number' ? record.version : undefined
  if (version === undefined) {
    throw new ZoteroError(WRITE_VERSION_MISSING_MESSAGE, ZOTERO_UNEXPECTED)
  }
  const data = asRecord(record?.data)
  return {
    version,
    tags: tagsOf(data),
    collectionKeys: stringArrayOf(data?.collections),
    serverId: headers.get(ZOTERO_SERVER_ID_HEADER) ?? serverId,
  }
}

function tagsOf(data: Record<string, unknown> | undefined): ItemSnapshot['tags'] {
  const raw = data?.tags
  if (!Array.isArray(raw)) return []
  const entries: { tag: string; type?: number }[] = []
  for (const row of raw) {
    const record = asRecord(row)
    const tag = record === undefined ? asString(row) : asString(record.tag)
    if (tag === undefined) continue
    const type = record !== undefined && typeof record.type === 'number' ? record.type : undefined
    entries.push(type === undefined ? { tag } : { tag, type })
  }
  return entries
}

/** The Zotero relations key carrying source-item links. */
const DC_RELATION = 'dc:relation'

function relationUrisOf(data: Record<string, unknown> | undefined): string[] {
  const relations = asRecord(data?.relations)
  const raw = relations === undefined ? undefined : relations[DC_RELATION]
  if (typeof raw === 'string') return [raw]
  if (Array.isArray(raw)) return raw.filter((entry): entry is string => typeof entry === 'string')
  return []
}

/** Preserve each existing tag's type, add the new ones, and report what was added. */
function mergeTags(
  existing: ItemSnapshot['tags'],
  additions: readonly string[],
): { merged: { tag: string; type?: number }[]; added: string[] } {
  const seen = new Set(existing.map((entry) => entry.tag))
  const merged = existing.map((entry) =>
    entry.type === undefined ? { tag: entry.tag } : { tag: entry.tag, type: entry.type },
  )
  const added: string[] = []
  for (const tag of additions) {
    if (seen.has(tag)) continue
    seen.add(tag)
    merged.push({ tag })
    added.push(tag)
  }
  return { merged, added }
}

function noteRef(key: string, serverId: string): string {
  return formatRef(refForLibrary(PERSONAL_LIBRARY, 'item', key, serverId))
}

function collectionRef(key: string, serverId: string): string {
  return formatRef(refForLibrary(PERSONAL_LIBRARY, 'collection', key, serverId))
}

/** The canonical relation URI for a personal-library source item. */
function relationUriOf(key: string): string {
  return `http://zotero.org/users/0/items/${key}`
}

/** Map Zotero's per-object refusal onto the typed domain error it names. */
function objectRefusedError(refused: ZoteroWriteObjectFailure): ZoteroError {
  switch (refused.code) {
    case 400:
      return new ZoteroError(
        writeObjectRefusedMessage(refused.message, refused.code),
        ZOTERO_INVALID_ARGUMENT,
      )
    case 404:
      return new ZoteroError(
        writeObjectRefusedMessage(refused.message, refused.code),
        ZOTERO_NOT_FOUND,
      )
    case 412:
      return new ZoteroError(
        writeObjectRefusedMessage(refused.message, refused.code),
        ZOTERO_WRITE_CONFLICT,
      )
    default:
      return new ZoteroError(
        writeObjectRefusedMessage(refused.message, refused.code),
        ZOTERO_UNEXPECTED,
      )
  }
}

/**
 * Create a research note: standalone or under a parent item, with tags,
 * collections (standalone only), and `dc:relation` source links. The note
 * body is converted to note HTML before it leaves this module; the created
 * note's saved state comes back inside the batch's `successful` bucket, so
 * no follow-up read is needed.
 *
 * Cross-field invariant at both ends of the call: a child note never carries
 * collections. The model-facing tool refuses the combination in
 * `tools/create-note.ts` `buildRequest` (before the plan card); this entry
 * refuses it again for any caller that reaches the domain without that tool
 * — `service.createNote` / provider direct use. Both ends throw the shared
 * `WRITE_CHILD_COLLECTIONS_MESSAGE`. The entry-field assembly below is
 * structural only (collections key only when standalone); it is not the gate.
 */
export async function createNote(
  deps: WriteDomainDeps,
  resolveCollection: (refOrName: string, signal?: AbortSignal) => Promise<ZoteroObjectRef>,
  request: ZoteroCreateNoteRequest,
  signal?: AbortSignal,
): Promise<ZoteroCreateNoteResult> {
  const serverId = await ensureServerId(deps, signal)
  const parent =
    request.parentItem === undefined ? undefined : requireWritableRef(request.parentItem, ['item'])
  if (parent !== undefined && (request.collections?.length ?? 0) > 0) {
    throw new ZoteroError(WRITE_CHILD_COLLECTIONS_MESSAGE, ZOTERO_INVALID_ARGUMENT)
  }
  const collections: ZoteroObjectRef[] = await Promise.all(
    (request.collections ?? []).map((refOrName) => resolveCollection(refOrName, signal)),
  )
  const sources = (request.sourceRefs ?? []).map((ref) => requireWritableRef(ref, ['item']))
  const tags = [...new Set(request.tags ?? [])]
  const entry: Record<string, unknown> = {
    itemType: 'note',
    note: markdownToNoteHtml(request.markdown),
    ...(parent !== undefined ? { parentItem: parent.key } : {}),
    ...(tags.length > 0 ? { tags: tags.map((tag) => ({ tag })) } : {}),
    ...(parent === undefined && collections.length > 0
      ? { collections: collections.map((ref) => ref.key) }
      : {}),
    ...(sources.length > 0
      ? { relations: { [DC_RELATION]: sources.map((ref) => relationUriOf(ref.key)) } }
      : {}),
  }
  return await withWriteKey(deps, serverId, signal, async (apiKey) => {
    const batch = await deps.writer.batch(`${libraryPrefix(PERSONAL_LIBRARY)}/items`, [entry], {
      serverId,
      apiKey,
      signal,
    })
    const refused = batch.failed['0']
    if (refused !== undefined) throw objectRefusedError(refused)
    const written = batch.successful['0']
    const key = written === undefined ? undefined : asString(written.key)
    if (key === undefined) {
      throw new ZoteroError(WRITE_VERSION_MISSING_MESSAGE, ZOTERO_UNEXPECTED)
    }
    const data = asRecord(written?.data)
    const savedTags = tagsOf(data).map((tagged) => tagged.tag)
    const savedCollectionKeys = stringArrayOf(data?.collections)
    const savedRelations = relationUrisOf(data)
    return {
      kind: 'applied',
      ref: noteRef(key, serverId),
      key,
      version: typeof written?.version === 'number' ? written.version : batch.libraryVersion,
      ...(parent !== undefined ? { parentItem: noteRef(parent.key, serverId) } : {}),
      collections:
        parent !== undefined
          ? []
          : (savedCollectionKeys.length > 0
              ? savedCollectionKeys
              : collections.map((ref) => ref.key)
            ).map((collectionKey) => collectionRef(collectionKey, serverId)),
      tags: savedTags.length > 0 ? savedTags : tags,
      sourceRefs:
        savedRelations.length > 0
          ? savedRelations.map((uri) => relationUriToRef(uri, serverId))
          : sources.map((ref) => noteRef(ref.key, serverId)),
      libraryVersion: batch.libraryVersion,
      serverId,
    }
  })
}

/** A saved relation URI back to the ref form the model uses; unparseable URIs stay verbatim. */
function relationUriToRef(uri: string, serverId: string): string {
  const parsed = parseZoteroRelationUri(uri)
  if (parsed === null) return uri
  if (parsed.library.type !== 'user' || parsed.library.id !== 0) return uri
  return noteRef(parsed.key, serverId)
}

/**
 * Add tags to an item. The merge is read-merge-write on purpose: a PATCH
 * replaces the whole tags array, so the union (existing types preserved,
 * additions appended) is sent under the version precondition. When every
 * requested tag is already present, nothing is written and `unchanged` says
 * so.
 */
export async function updateTags(
  deps: WriteDomainDeps,
  request: ZoteroTagUpdateRequest,
  signal?: AbortSignal,
): Promise<ZoteroTagUpdateResult> {
  const ref = requireWritableRef(request.item, ['item'])
  const serverId = await ensureServerId(deps, signal)
  const snapshot = await readItem(deps, ref, serverId, signal)
  const { merged, added } = mergeTags(snapshot.tags, [...new Set(request.tags)])
  const resultRef = noteRef(ref.key, snapshot.serverId ?? serverId)
  if (added.length === 0) {
    return {
      kind: 'applied',
      ref: resultRef,
      version: snapshot.version,
      tags: merged.map((tagged) => tagged.tag),
      added: [],
      unchanged: true,
      serverId: snapshot.serverId ?? serverId,
    }
  }
  return await withWriteKey(deps, snapshot.serverId ?? serverId, signal, async (apiKey) => {
    const { libraryVersion } = await deps.writer.patch(
      `${libraryPrefix(PERSONAL_LIBRARY)}/items/${ref.key}`,
      { tags: merged },
      {
        serverId: snapshot.serverId ?? serverId,
        apiKey,
        ifUnmodifiedSinceVersion: snapshot.version,
        signal,
      },
    )
    return {
      kind: 'applied',
      ref: resultRef,
      version: libraryVersion,
      tags: merged.map((tagged) => tagged.tag),
      added,
      unchanged: false,
      libraryVersion,
      serverId: snapshot.serverId ?? serverId,
    }
  })
}

/**
 * Add an item to a collection, read-merge-write like the tag update. The
 * collection ref (or name) resolves first, so an unknown collection fails
 * before any read-modify-write cycle starts.
 */
export async function addToCollection(
  deps: WriteDomainDeps,
  resolveCollection: (refOrName: string, signal?: AbortSignal) => Promise<ZoteroObjectRef>,
  request: ZoteroCollectionAddRequest,
  signal?: AbortSignal,
): Promise<ZoteroCollectionAddResult> {
  const ref = requireWritableRef(request.item, ['item'])
  const target = await resolveCollection(request.collection, signal)
  const serverId = await ensureServerId(deps, signal)
  const snapshot = await readItem(deps, ref, serverId, signal)
  const effectiveServerId = snapshot.serverId ?? serverId
  const resultRef = noteRef(ref.key, effectiveServerId)
  if (snapshot.collectionKeys.includes(target.key)) {
    return {
      kind: 'applied',
      ref: resultRef,
      version: snapshot.version,
      collections: snapshot.collectionKeys.map((key) => collectionRef(key, effectiveServerId)),
      added: false,
      serverId: effectiveServerId,
    }
  }
  const merged = [...snapshot.collectionKeys, target.key]
  return await withWriteKey(deps, effectiveServerId, signal, async (apiKey) => {
    const { libraryVersion } = await deps.writer.patch(
      `${libraryPrefix(PERSONAL_LIBRARY)}/items/${ref.key}`,
      { collections: merged },
      {
        serverId: effectiveServerId,
        apiKey,
        ifUnmodifiedSinceVersion: snapshot.version,
        signal,
      },
    )
    return {
      kind: 'applied',
      ref: resultRef,
      version: libraryVersion,
      collections: merged.map((key) => collectionRef(key, effectiveServerId)),
      added: true,
      libraryVersion,
      serverId: effectiveServerId,
    }
  })
}

/**
 * The typed error a write-capability-less provider raises — unreachable
 * through the service's capability gate, but the direct-provider contract
 * fails with the same code instead of crashing.
 */
export function writeCapabilityUnavailableMessage(providerId: string): string {
  return `Zotero provider "${providerId}" does not support the write capability.`
}

export const WRITE_CAPABILITY_UNAVAILABLE_CODE = ZOTERO_CAPABILITY_UNAVAILABLE
