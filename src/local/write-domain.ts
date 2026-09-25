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
  writeListEmptyMessage,
  writeNonBlankMessage,
  writeObjectRefusedMessage,
  writeObjectStateMissingMessage,
  SERVER_MISMATCH_MESSAGE,
  ZOTERO_CAPABILITY_UNAVAILABLE,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_SERVER_MISMATCH,
  ZOTERO_NOT_FOUND,
  ZOTERO_NOT_IMPLEMENTED,
  ZOTERO_UNEXPECTED,
  ZOTERO_WRITE_CONFLICT,
  ZOTERO_WRITE_UNAUTHORIZED,
  ZoteroError,
} from '../errors.js'
import {
  asRecord,
  asString,
  isNonNegativeSafeInteger,
  isObjectKey,
  stringArrayOf,
} from '../json.js'
import {
  formatRef,
  isRefString,
  libraryPrefix,
  parseRef,
  parseZoteroRelationUri,
  PERSONAL_LIBRARY,
  refForLibrary,
  requireWritableRef,
} from '../refs.js'
import { markdownToNoteHtml } from './note-format.js'
import type { WriteAuthorizer } from '../write-auth.js'
import {
  ZoteroWriteCommitUnknownError,
  type ZoteroBatchWrite,
  type ZoteroWriteHttpClient,
  type ZoteroWriteObjectFailure,
} from '../write-http.js'
import type {
  ZoteroCollectionAddRequest,
  ZoteroCollectionAddResult,
  ZoteroCreateNoteCommittedUnverified,
  ZoteroCreateNoteCommittedOutcome,
  ZoteroCreateNoteRequest,
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
    await deps.authorizer.invalidate(serverId, first.key)
    const second = await deps.authorizer.keyFor(serverId, signal)
    try {
      return await send(second.key)
    } catch (retried) {
      if (isWriteUnauthorized(retried)) {
        await deps.authorizer.invalidate(serverId, second.key)
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

/** Refuse a qualified ref that names another Zotero instance before any write. */
function requireWritableRefAtServer(
  ref: ZoteroObjectRef,
  kinds: readonly ZoteroObjectRef['kind'][],
  serverId: string,
): ZoteroObjectRef {
  const checked = requireWritableRef(ref, kinds)
  if (ref.serverId !== undefined && ref.serverId !== serverId) {
    throw new ZoteroError(SERVER_MISMATCH_MESSAGE, ZOTERO_SERVER_MISMATCH)
  }
  return checked
}

function requireNonBlank(name: string, value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new ZoteroError(writeNonBlankMessage(name), ZOTERO_INVALID_ARGUMENT)
  }
  return trimmed
}

function normalizeWriteList(name: string, values: readonly string[]): string[] {
  return [...new Set(values.map((value) => requireNonBlank(name, value)))]
}

/** Validate a ref-shaped collection argument locally; names remain live lookups. */
function normalizeCollectionInput(name: string, value: string): string {
  const collection = requireNonBlank(name, value)
  if (isRefString(collection)) requireWritableRef(parseRef(collection), ['collection'])
  return collection
}

/** Read one item's write-relevant state, pinning the read to the instance the write will target. */
async function readItem(
  deps: WriteDomainDeps,
  ref: ZoteroObjectRef,
  serverId: string,
  field: 'tags' | 'collections',
  signal?: AbortSignal,
): Promise<ItemSnapshot> {
  const { json, headers } = await deps.client.getJson<unknown>(
    `${libraryPrefix(PERSONAL_LIBRARY)}/items/${ref.key}`,
    undefined,
    { signal, serverId },
  )
  const record = asRecord(json)
  const version = isNonNegativeSafeInteger(record?.version) ? record.version : undefined
  if (version === undefined) {
    throw new ZoteroError(WRITE_VERSION_MISSING_MESSAGE, ZOTERO_UNEXPECTED)
  }
  const data = asRecord(record?.data)
  const responseKey = asString(record?.key)
  const dataKey = asString(data?.key)
  if (responseKey !== ref.key || dataKey !== ref.key) {
    throw new ZoteroError(
      `Zotero answered the write read with a different item than ${ref.key}; the response cannot be used for this write.`,
      ZOTERO_UNEXPECTED,
    )
  }
  if (
    (field === 'tags' && data?.tags === undefined) ||
    (field === 'collections' && data?.collections === undefined)
  ) {
    throw new ZoteroError(writeObjectStateMissingMessage(field), ZOTERO_UNEXPECTED)
  }
  const tags = field === 'tags' ? tagsOf(data) : []
  const collectionKeys = field === 'collections' ? collectionKeysOf(data) : []
  if (tags === undefined || collectionKeys === undefined) {
    throw new ZoteroError(writeObjectStateMissingMessage(field), ZOTERO_UNEXPECTED)
  }
  const observedServerId = headers.get(ZOTERO_SERVER_ID_HEADER)
  if (observedServerId !== serverId) {
    throw new ZoteroError(SERVER_MISMATCH_MESSAGE, ZOTERO_SERVER_MISMATCH)
  }
  return {
    version,
    tags,
    collectionKeys,
    serverId: observedServerId ?? serverId,
  }
}

/** Parse a saved tag array strictly; undefined means malformed, absent means empty. */
function tagsOf(data: Record<string, unknown> | undefined): ItemSnapshot['tags'] | undefined {
  const raw = data?.tags
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return undefined
  const entries: { tag: string; type?: number }[] = []
  for (const row of raw) {
    const record = asRecord(row)
    const tag = record === undefined ? asString(row) : asString(record.tag)
    if (tag === undefined || tag.trim() === '') return undefined
    const type = record?.type
    if (type !== undefined && !isNonNegativeSafeInteger(type)) return undefined
    entries.push(type === undefined ? { tag } : { tag, type })
  }
  return entries
}

/** Parse a saved collection-key array strictly; undefined means malformed. */
function collectionKeysOf(data: Record<string, unknown> | undefined): string[] | undefined {
  const raw = data?.collections
  if (raw === undefined) return []
  if (
    !Array.isArray(raw) ||
    raw.some((entry) => typeof entry !== 'string' || !isObjectKey(entry))
  ) {
    return undefined
  }
  return raw as string[]
}

/** The Zotero relations key carrying source-item links. */
const DC_RELATION = 'dc:relation'

function relationUrisOf(data: Record<string, unknown> | undefined): string[] {
  const relations = asRecord(data?.relations)
  const raw = relations === undefined ? undefined : relations[DC_RELATION]
  if (typeof raw === 'string') return [raw]
  return stringArrayOf(raw)
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

function itemRef(key: string, serverId: string): string {
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

function committedUnverifiedNote(
  batch: ZoteroBatchWrite | undefined,
  serverId: string,
  key?: string,
  version?: number,
  reason: 'saved-state-unverified' | 'commit-unknown' = 'saved-state-unverified',
): ZoteroCreateNoteCommittedUnverified {
  const safeKey = key !== undefined && isObjectKey(key) ? key : undefined
  return {
    kind: 'committed-unverified',
    committed: true,
    retryable: false,
    reason,
    ...(safeKey !== undefined
      ? {
          key: safeKey,
          ref: itemRef(safeKey, serverId),
          ...(version !== undefined ? { version } : {}),
        }
      : {}),
    ...(batch !== undefined ? { libraryVersion: batch.libraryVersion } : {}),
    serverId,
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
): Promise<ZoteroCreateNoteCommittedOutcome> {
  requireNonBlank('markdown', request.markdown)
  const localParent =
    request.parentItem === undefined ? undefined : requireWritableRef(request.parentItem, ['item'])
  const collectionInputs = (request.collections ?? []).map((value) =>
    normalizeCollectionInput('collections', value),
  )
  const localSources = (request.sourceRefs ?? []).map((ref) => requireWritableRef(ref, ['item']))
  const tags = normalizeWriteList('tags', request.tags ?? [])
  if (localParent !== undefined && collectionInputs.length > 0) {
    throw new ZoteroError(WRITE_CHILD_COLLECTIONS_MESSAGE, ZOTERO_INVALID_ARGUMENT)
  }

  const serverId = await ensureServerId(deps, signal)
  const parent =
    localParent === undefined
      ? undefined
      : requireWritableRefAtServer(localParent, ['item'], serverId)
  const collections: ZoteroObjectRef[] = (
    await Promise.all(collectionInputs.map((value) => resolveCollection(value, signal)))
  ).map((ref) => requireWritableRefAtServer(ref, ['collection'], serverId))
  const sources = localSources.map((ref) => requireWritableRefAtServer(ref, ['item'], serverId))
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
    let batch: ZoteroBatchWrite
    try {
      batch = await deps.writer.batch(`${libraryPrefix(PERSONAL_LIBRARY)}/items`, [entry], {
        serverId,
        apiKey,
        signal,
      })
    } catch (error) {
      if (error instanceof ZoteroWriteCommitUnknownError) {
        return committedUnverifiedNote(undefined, serverId, undefined, undefined, 'commit-unknown')
      }
      throw error
    }
    const has = (bucket: Record<string, unknown>, index: string): boolean =>
      Object.prototype.hasOwnProperty.call(bucket, index)
    const hasUnexpectedIndex = (bucket: Record<string, unknown>): boolean =>
      Object.keys(bucket).some((index) => index !== '0')
    const failed = has(batch.failed, '0')
    const successful = has(batch.successful, '0')
    const success = has(batch.success, '0')
    const unchanged = has(batch.unchanged, '0')
    if (
      hasUnexpectedIndex(batch.failed) ||
      hasUnexpectedIndex(batch.successful) ||
      hasUnexpectedIndex(batch.success) ||
      hasUnexpectedIndex(batch.unchanged) ||
      (failed && (successful || success || unchanged)) ||
      (unchanged && (successful || success)) ||
      (!failed && !successful && !success && !unchanged)
    ) {
      return committedUnverifiedNote(batch, serverId, undefined, undefined, 'commit-unknown')
    }
    const refused = batch.failed['0']
    if (refused !== undefined) throw objectRefusedError(refused)
    const written = batch.successful['0']
    const writtenKey = written === undefined ? undefined : asString(written.key)
    const successKey = asString(batch.success['0'])
    const key =
      writtenKey !== undefined && isObjectKey(writtenKey)
        ? writtenKey
        : successKey !== undefined && isObjectKey(successKey)
          ? successKey
          : undefined
    const keyConflict =
      writtenKey !== undefined &&
      successKey !== undefined &&
      isObjectKey(writtenKey) &&
      isObjectKey(successKey) &&
      writtenKey !== successKey
    if (
      (writtenKey !== undefined && !isObjectKey(writtenKey)) ||
      (successKey !== undefined && !isObjectKey(successKey)) ||
      (written !== undefined && writtenKey === undefined) ||
      keyConflict
    ) {
      return committedUnverifiedNote(batch, serverId, keyConflict ? undefined : key)
    }
    if (key === undefined) {
      return committedUnverifiedNote(batch, serverId)
    }
    const version = isNonNegativeSafeInteger(written?.version) ? written.version : undefined
    if (version === undefined) {
      return committedUnverifiedNote(batch, serverId, key)
    }
    const data = asRecord(written.data)
    if (data === undefined) {
      return committedUnverifiedNote(batch, serverId, key, version)
    }
    if (
      data.key !== key ||
      data.version !== version ||
      data.itemType !== 'note' ||
      typeof data.note !== 'string'
    ) {
      return committedUnverifiedNote(batch, serverId, key, version)
    }
    // The requested parent is part of the saved-state claim too. Never fill a
    // missing or contradictory parent from the request after Zotero has
    // already committed the note; the caller must reconcile an unverified
    // child-note result by its key instead of receiving a false guarantee.
    if (
      (parent !== undefined && data.parentItem !== parent.key) ||
      (parent === undefined && data.parentItem !== undefined)
    ) {
      return committedUnverifiedNote(batch, serverId, key, version)
    }
    const savedTagState = tagsOf(data)
    const savedCollectionState = collectionKeysOf(data)
    if (savedTagState === undefined || savedCollectionState === undefined) {
      return committedUnverifiedNote(batch, serverId, key, version)
    }
    const savedTags = savedTagState.map((tagged) => tagged.tag)
    const savedCollectionKeys = savedCollectionState
    const savedRelations = relationUrisOf(data)
    return {
      kind: 'applied',
      ref: itemRef(key, serverId),
      key,
      version,
      ...(parent !== undefined ? { parentItem: itemRef(parent.key, serverId) } : {}),
      collections:
        parent !== undefined
          ? []
          : savedCollectionKeys.map((collectionKey) => collectionRef(collectionKey, serverId)),
      tags: savedTags,
      sourceRefs: savedRelations.map((uri) => relationUriToRef(uri, serverId)),
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
  return itemRef(parsed.key, serverId)
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
  const localRef = requireWritableRef(request.item, ['item'])
  const additions = normalizeWriteList('tags', request.tags ?? [])
  if (additions.length === 0) {
    throw new ZoteroError(writeListEmptyMessage('tags'), ZOTERO_INVALID_ARGUMENT)
  }
  const serverId = await ensureServerId(deps, signal)
  const ref = requireWritableRefAtServer(localRef, ['item'], serverId)
  const snapshot = await readItem(deps, ref, serverId, 'tags', signal)
  const { merged, added } = mergeTags(snapshot.tags, additions)
  const resultRef = itemRef(ref.key, snapshot.serverId ?? serverId)
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
  const localRef = requireWritableRef(request.item, ['item'])
  const collectionInput = normalizeCollectionInput('collection', request.collection)
  const serverId = await ensureServerId(deps, signal)
  const target = await resolveCollection(collectionInput, signal)
  requireWritableRefAtServer(target, ['collection'], serverId)
  const ref = requireWritableRefAtServer(localRef, ['item'], serverId)
  const snapshot = await readItem(deps, ref, serverId, 'collections', signal)
  const effectiveServerId = snapshot.serverId ?? serverId
  const resultRef = itemRef(ref.key, effectiveServerId)
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
