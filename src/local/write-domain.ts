/**
 * The write domain: notes, item tags, collection membership, collections,
 * items, and library tags against the Local API's write endpoints. Every
 * function here owns the full write lifecycle the Zotero 10 protocol implies:
 *
 * - the target is always the personal library (`users/0`); a ref naming a
 *   group or a foreign user id is refused before any network happens;
 * - the serving instance id is established (and pinned) before any read or
 *   write, because every write must carry `Zotero-Server-ID`;
 * - the API key comes from {@link WriteAuthorizer}, and a 401 replays the
 *   same request exactly once after a fresh authorization — single-use keys
 *   are consumed at authentication time, so a burned key is forgotten;
 * - tag, collection-membership, and scalar updates are read-merge-write under
 *   an `If-Unmodified-Since-Version` precondition: PATCH replaces arrays
 *   wholesale, so the merged list must be sent whole;
 * - deletes carry the library version of their preceding read as the
 *   precondition, so any concurrent write fails the delete rather than
 *   slipping past it;
 * - one object per batch means a Zotero refusal surfaces as a typed error,
 *   never as a silently skipped entry in a bucket.
 *
 * There is no retry beyond the re-authorization replay, and a version
 * conflict (412) is reported as `ZOTERO_WRITE_CONFLICT` for the model to
 * re-run — the tool re-reads and reapplies on top of what is there now.
 * Non-idempotent creates (note, item, collection) never retry: an unprovable
 * commit surfaces as `committed-unverified` with `retryable: false`.
 * @module dsh-zotero/local/write-domain
 */

import type { ZoteroHttpClient } from '../http-client.js'
import { ZOTERO_LIBRARY_VERSION_HEADER, ZOTERO_SERVER_ID_HEADER } from '../constants.js'
import {
  WRITE_CHILD_COLLECTIONS_MESSAGE,
  WRITE_IDENTITY_UNSUPPORTED_MESSAGE,
  WRITE_ITEM_NEEDS_TITLE_OR_URL_MESSAGE,
  WRITE_LIST_SELECTION_MESSAGE,
  WRITE_PRECONDITION_READ_LIBRARY_VERSION_MESSAGE,
  WRITE_UNAUTHORIZED_AFTER_AUTH_MESSAGE,
  WRITE_ITEM_TYPE_MISSING_MESSAGE,
  WRITE_VERSION_MISSING_MESSAGE,
  writeCollectionNameExistsMessage,
  writeFieldNotForItemTypeMessage,
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
  parseNonNegativeSafeInteger,
  stringArrayOf,
} from '../json.js'
import {
  formatRef,
  formatZoteroRelationUri,
  isRefString,
  libraryPrefix,
  parseRef,
  PERSONAL_LIBRARY,
  refForLibrary,
  relationTargetRef,
  requireSupportedLocalRef,
  requireWritableRef,
} from '../refs.js'
import { nextOffsetOf, requireArrayBody, requireTotalResults } from './pagination.js'
import {
  normalizeCreator,
  requireCreatableItemType,
  requireTitleOrUrl,
  requireUpdatableField,
  wireFieldOf,
} from '../write-item-rules.js'
import { markdownToNoteHtml } from './note-format.js'
import type { WriteAuthorizer } from '../write-auth.js'
import {
  ZoteroWriteCommitUnknownError,
  type ZoteroBatchWrite,
  type ZoteroWriteHttpClient,
  type ZoteroWriteObjectFailure,
} from '../write-http.js'
import {
  type ZoteroCreateCollectionCommittedOutcome,
  type ZoteroCreateCollectionRequest,
  type ZoteroCreateItemCommittedOutcome,
  type ZoteroCreateItemRequest,
  type ZoteroCreateNoteCommittedOutcome,
  type ZoteroCreateNoteRequest,
  type ZoteroDeleteCollectionRequest,
  type ZoteroDeleteCollectionResult,
  type ZoteroDeleteLibraryTagsRequest,
  type ZoteroDeleteLibraryTagsResult,
  type ZoteroObjectRef,
  type ZoteroUpdateItemCollectionsRequest,
  type ZoteroUpdateItemCollectionsResult,
  type ZoteroUpdateItemRequest,
  type ZoteroUpdateItemResult,
  type ZoteroUpdateItemTagsRequest,
  type ZoteroUpdateItemTagsResult,
  type ZoteroUpdatableItemField,
  type ZoteroWriteCommittedUnverified,
} from '../types.js'

/**
 * The collaborators one write-domain call needs; built per call by the
 * provider. The collection resolvers and the item-type field reader are
 * injected rather than imported so this module stays free of the scope
 * directory's cache semantics and of provider lifetime decisions.
 */
export interface WriteDomainDeps {
  readonly client: ZoteroHttpClient
  readonly writer: ZoteroWriteHttpClient
  readonly authorizer: WriteAuthorizer
  /** Resolve one collection from a ref or an exact name. */
  readonly resolveCollection: (refOrName: string, signal?: AbortSignal) => Promise<ZoteroObjectRef>
  /**
   * Resolve a mixed batch of collection refs and names, preserving input
   * order. Refs resolve through one cached listing (per-key reads only for
   * keys the listing lacks), so a 50-entry membership edit costs one request
   * in the common case.
   */
  readonly resolveCollections: (
    inputs: readonly string[],
    signal?: AbortSignal,
  ) => Promise<ZoteroObjectRef[]>
  /**
   * The field names one item type accepts, memoized per (serving instance,
   * item type) by the provider — the field set is static for a running build.
   */
  readonly itemTypeFields: (itemType: string, signal?: AbortSignal) => Promise<ReadonlySet<string>>
  /**
   * Called after a collection create or delete lands, so the scope directory
   * drops its cached listings before the next name resolution. Wired by the
   * provider; absent in direct-domain tests that own no directory.
   */
  readonly onCollectionsChanged?: () => void
}

/** One item's write-relevant state, read fresh for every read-merge-write. */
export interface ItemSnapshot {
  readonly version: number
  readonly itemType: string
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

/**
 * The library's current transaction version, read cheaply for delete
 * preconditions. One single-row listing; the version rides the response
 * header, so the body is discarded. Absence is protocol drift.
 */
async function readLibraryVersion(
  deps: WriteDomainDeps,
  serverId: string,
  signal?: AbortSignal,
): Promise<{ libraryVersion: number; serverId: string }> {
  const params = new URLSearchParams()
  params.set('limit', '1')
  const response = await deps.client.get(`${libraryPrefix(PERSONAL_LIBRARY)}/items/top`, params, {
    signal,
    serverId,
  })
  const libraryVersion = parseNonNegativeSafeInteger(
    response.headers.get(ZOTERO_LIBRARY_VERSION_HEADER),
  )
  if (libraryVersion === undefined) {
    throw new ZoteroError(WRITE_PRECONDITION_READ_LIBRARY_VERSION_MESSAGE, ZOTERO_UNEXPECTED)
  }
  const observed = response.headers.get(ZOTERO_SERVER_ID_HEADER)
  assertServerIdMatches(observed, serverId)
  return { libraryVersion, serverId: observed ?? serverId }
}

/** Refuse an observed server ID that names another Zotero instance than the write target. */
function assertServerIdMatches(observed: string | null | undefined, serverId: string): void {
  if (observed !== undefined && observed !== null && observed !== serverId) {
    throw new ZoteroError(SERVER_MISMATCH_MESSAGE, ZOTERO_SERVER_MISMATCH)
  }
}

/** Refuse a qualified ref that names another Zotero instance before any write. */
function requireWritableRefAtServer(
  ref: ZoteroObjectRef,
  kinds: readonly ZoteroObjectRef['kind'][],
  serverId: string,
): ZoteroObjectRef {
  const checked = requireWritableRef(ref, kinds)
  assertServerIdMatches(ref.serverId, serverId)
  return checked
}

/** Refuse a qualified ref that names another Zotero instance before citing as relation source. */
function requireSupportedRefAtServer(
  ref: ZoteroObjectRef,
  kinds: readonly ZoteroObjectRef['kind'][],
  serverId: string,
): ZoteroObjectRef {
  const checked = requireSupportedLocalRef(ref, kinds)
  assertServerIdMatches(ref.serverId, serverId)
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

/**
 * Merge string lists: `merged = (existing − remove) ∪ (add − existing)`.
 * Order is existing-first, then genuinely new additions in request order;
 * duplicates collapse. `added`/`removed` name the actual changes, not the
 * request, and `changed` is false exactly when nothing would move.
 */
export function mergeList(
  existing: readonly string[],
  remove: readonly string[],
  add: readonly string[],
): { merged: string[]; added: string[]; removed: string[]; changed: boolean } {
  const existingSet = new Set(existing)
  const removeSet = new Set(remove)
  const remaining = existing.filter((entry) => !removeSet.has(entry))
  const seen = new Set(remaining)
  const merged = [...remaining]
  const added: string[] = []
  for (const entry of add) {
    // (add − existing): an entry already present is not an addition, even when
    // it was also removed — the removal wins for saved entries.
    if (existingSet.has(entry)) continue
    if (seen.has(entry)) continue
    seen.add(entry)
    merged.push(entry)
    added.push(entry)
  }
  const mergedSet = new Set(merged)
  const removed = existing.filter((entry) => !mergedSet.has(entry))
  // Deduplicate the removed report while preserving first-seen order; the
  // existing list itself should hold no duplicates, but a malformed saved
  // state must not report one removal twice.
  const dedupedRemoved = [...new Set(removed)]
  return {
    merged,
    added,
    removed: dedupedRemoved,
    changed: added.length > 0 || dedupedRemoved.length > 0,
  }
}

/**
 * Merge tag entries, preserving each retained tag's type. New tags carry no
 * type; removed tags are gone. Shape mirrors {@link mergeList} for the
 * collection and tag tools to share one semantic.
 */
export function mergeTagList(
  existing: readonly { readonly tag: string; readonly type?: number }[],
  remove: readonly string[],
  add: readonly string[],
): {
  merged: { tag: string; type?: number }[]
  added: string[]
  removed: string[]
  changed: boolean
} {
  const names = existing.map((entry) => entry.tag)
  const { merged, added, removed, changed } = mergeList(names, remove, add)
  const typeOf = new Map(existing.map((entry) => [entry.tag, entry.type] as const))
  return {
    merged: merged.map((tag) => {
      const type = typeOf.get(tag)
      return type === undefined ? { tag } : { tag, type }
    }),
    added,
    removed,
    changed,
  }
}

/**
 * Read one item's write-relevant state, pinning the read to the instance the
 * write will target. One read serves every read-merge-write: tags,
 * collections, the object version, and the item type arrive together.
 */
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
  const itemType = asString(data?.itemType)
  if (itemType === undefined || itemType === '') {
    throw new ZoteroError(WRITE_ITEM_TYPE_MISSING_MESSAGE, ZOTERO_UNEXPECTED)
  }
  if (data?.tags === undefined || data?.collections === undefined) {
    const missing = data?.tags === undefined ? 'tags' : 'collections'
    throw new ZoteroError(writeObjectStateMissingMessage(missing), ZOTERO_UNEXPECTED)
  }
  const tags = tagsOf(data)
  const collectionKeys = strictCollectionKeysOf(data)
  if (tags === undefined || collectionKeys === undefined) {
    const missing = tags === undefined ? 'tags' : 'collections'
    throw new ZoteroError(writeObjectStateMissingMessage(missing), ZOTERO_UNEXPECTED)
  }
  const observedServerId = headers.get(ZOTERO_SERVER_ID_HEADER)
  assertServerIdMatches(observedServerId, serverId)
  return {
    version,
    itemType,
    tags,
    collectionKeys,
    serverId: observedServerId ?? serverId,
  }
}

/**
 * Read one collection's delete precondition: proof it exists plus the library
 * version the delete must carry. The object version is verified but the
 * header version is the precondition — any concurrent write fails the delete.
 */
async function readCollectionForDelete(
  deps: WriteDomainDeps,
  key: string,
  serverId: string,
  signal?: AbortSignal,
): Promise<{ libraryVersion: number; serverId: string }> {
  const { json, headers } = await deps.client.getJson<unknown>(
    `${libraryPrefix(PERSONAL_LIBRARY)}/collections/${key}`,
    undefined,
    { signal, serverId },
  )
  const record = asRecord(json)
  const data = asRecord(record?.data)
  const responseKey = asString(record?.key) ?? asString(data?.key)
  if (responseKey !== key || asString(data?.key) !== key) {
    throw new ZoteroError(
      `Zotero answered the delete read with a different collection than ${key}; the response cannot be used for this delete.`,
      ZOTERO_UNEXPECTED,
    )
  }
  if (!isNonNegativeSafeInteger(record?.version)) {
    throw new ZoteroError(WRITE_VERSION_MISSING_MESSAGE, ZOTERO_UNEXPECTED)
  }
  const libraryVersion = parseNonNegativeSafeInteger(headers.get(ZOTERO_LIBRARY_VERSION_HEADER))
  if (libraryVersion === undefined) {
    throw new ZoteroError(WRITE_PRECONDITION_READ_LIBRARY_VERSION_MESSAGE, ZOTERO_UNEXPECTED)
  }
  const observed = headers.get(ZOTERO_SERVER_ID_HEADER)
  assertServerIdMatches(observed, serverId)
  return { libraryVersion, serverId: observed ?? serverId }
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
function strictCollectionKeysOf(data: Record<string, unknown> | undefined): string[] | undefined {
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

function itemRef(key: string, serverId: string): string {
  return formatRef(refForLibrary(PERSONAL_LIBRARY, 'item', key, serverId))
}

function collectionRef(key: string, serverId: string): string {
  return formatRef(refForLibrary(PERSONAL_LIBRARY, 'collection', key, serverId))
}

/** The canonical relation URI for a source item. */
function relationUriOf(ref: ZoteroObjectRef): string {
  return formatZoteroRelationUri(ref)
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

type CommittedUnverifiedKind = 'note' | 'item' | 'collection'

/**
 * The shared non-retryable outcome for non-idempotent creates. Notes, items,
 * and collections share one shape; only the ref builder differs (items and
 * notes are item refs, collections are collection refs).
 */
function committedUnverified(
  kind: CommittedUnverifiedKind,
  batch: ZoteroBatchWrite | undefined,
  serverId: string,
  key?: string,
  version?: number,
  reason: 'saved-state-unverified' | 'commit-unknown' = 'saved-state-unverified',
): ZoteroWriteCommittedUnverified {
  const safeKey = key !== undefined && isObjectKey(key) ? key : undefined
  const ref =
    safeKey === undefined
      ? undefined
      : kind === 'collection'
        ? collectionRef(safeKey, serverId)
        : itemRef(safeKey, serverId)
  return {
    kind: 'committed-unverified',
    committed: true,
    retryable: false,
    reason,
    ...(safeKey !== undefined
      ? {
          key: safeKey,
          ...(ref !== undefined ? { ref } : {}),
          ...(version !== undefined ? { version } : {}),
        }
      : {}),
    ...(batch !== undefined ? { libraryVersion: batch.libraryVersion } : {}),
    serverId,
  }
}

/**
 * The proven saved state of a single-entry batch: the object's key, version,
 * raw echo, library version, and whatever `proven` shaped from the echo.
 */
interface SettledEntry<P> {
  readonly key: string
  readonly version: number
  readonly data: Record<string, unknown>
  readonly libraryVersion: number
  readonly payload: P
}

/**
 * Settle a one-entry write batch — the single retry-safety contract for the
 * three non-idempotent creates (note, item, collection). The flow:
 *
 * 1. the four outcome buckets must be mutually exclusive and carry no index
 *    but `'0'`; any other shape means the commit state is unknowable;
 * 2. an entry in `failed` is Zotero's own refusal and surfaces as a typed
 *    error;
 * 3. the key comes from `successful['0'].key` with `success['0']` as the
 *    fallback; a conflict or a malformed key leaves the commit unproven;
 * 4. the object version, the echo record, and the echo's own key/version
 *    must all be present and agree;
 * 5. `proven` has the final word: it shapes the caller's saved-state claim
 *    from the echo (requested parent, name, item type, …) and returning
 *    `undefined` leaves the commit unproven.
 *
 * Every doubt becomes a committed-unverified result — the caller never
 * retries and never fills saved state from the request.
 */
function settleSingleEntryBatch<P>(
  batch: ZoteroBatchWrite,
  kind: CommittedUnverifiedKind,
  serverId: string,
  proven: (data: Record<string, unknown>, key: string, version: number) => P | undefined,
):
  | { status: 'applied'; entry: SettledEntry<P> }
  | { status: 'unverified'; result: ZoteroWriteCommittedUnverified } {
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
    return {
      status: 'unverified',
      result: committedUnverified(kind, batch, serverId, undefined, undefined, 'commit-unknown'),
    }
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
    return {
      status: 'unverified',
      result: committedUnverified(kind, batch, serverId, keyConflict ? undefined : key),
    }
  }
  if (key === undefined) {
    return { status: 'unverified', result: committedUnverified(kind, batch, serverId) }
  }
  const version = isNonNegativeSafeInteger(written?.version) ? written.version : undefined
  if (version === undefined) {
    return { status: 'unverified', result: committedUnverified(kind, batch, serverId, key) }
  }
  const data = asRecord(written.data)
  if (data === undefined || data.key !== key || data.version !== version) {
    return {
      status: 'unverified',
      result: committedUnverified(kind, batch, serverId, key, version),
    }
  }
  const payload = proven(data, key, version)
  if (payload === undefined) {
    return {
      status: 'unverified',
      result: committedUnverified(kind, batch, serverId, key, version),
    }
  }
  return {
    status: 'applied',
    entry: { key, version, data, libraryVersion: batch.libraryVersion, payload },
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
  request: ZoteroCreateNoteRequest,
  signal?: AbortSignal,
): Promise<ZoteroCreateNoteCommittedOutcome> {
  requireNonBlank('markdown', request.markdown)
  const localParent =
    request.parentItem === undefined ? undefined : requireWritableRef(request.parentItem, ['item'])
  const collectionInputs = (request.collections ?? []).map((value) =>
    normalizeCollectionInput('collections', value),
  )
  const localSources = (request.sourceRefs ?? []).map((ref) =>
    requireSupportedLocalRef(ref, ['item']),
  )
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
    await deps.resolveCollections(collectionInputs, signal)
  ).map((ref) => requireWritableRefAtServer(ref, ['collection'], serverId))
  const sources = localSources.map((ref) => requireSupportedRefAtServer(ref, ['item'], serverId))
  const entry: Record<string, unknown> = {
    itemType: 'note',
    note: markdownToNoteHtml(request.markdown),
    ...(parent !== undefined ? { parentItem: parent.key } : {}),
    ...(tags.length > 0 ? { tags: tags.map((tag) => ({ tag })) } : {}),
    ...(parent === undefined && collections.length > 0
      ? { collections: collections.map((ref) => ref.key) }
      : {}),
    ...(sources.length > 0
      ? { relations: { [DC_RELATION]: sources.map((ref) => relationUriOf(ref)) } }
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
        return committedUnverified(
          'note',
          undefined,
          serverId,
          undefined,
          undefined,
          'commit-unknown',
        )
      }
      throw error
    }
    // The requested parent is part of the saved-state claim too. Never fill a
    // missing or contradictory parent from the request after Zotero has
    // already committed the note; the caller must reconcile an unverified
    // child-note result by its key instead of receiving a false guarantee.
    const proven = (
      data: Record<string, unknown>,
    ):
      | { savedTags: string[]; savedCollectionKeys: string[]; savedRelations: string[] }
      | undefined => {
      if (
        data.itemType !== 'note' ||
        typeof data.note !== 'string' ||
        (parent !== undefined && data.parentItem !== parent.key) ||
        (parent === undefined && data.parentItem !== undefined)
      ) {
        return undefined
      }
      const savedTagState = tagsOf(data)
      const savedCollectionState = strictCollectionKeysOf(data)
      if (savedTagState === undefined || savedCollectionState === undefined) return undefined
      return {
        savedTags: savedTagState.map((tagged) => tagged.tag),
        savedCollectionKeys: savedCollectionState,
        savedRelations: relationUrisOf(data),
      }
    }
    const settled = settleSingleEntryBatch(batch, 'note', serverId, proven)
    if (settled.status === 'unverified') return settled.result
    const { key, version, payload } = settled.entry
    return {
      kind: 'applied',
      ref: itemRef(key, serverId),
      key,
      version,
      ...(parent !== undefined ? { parentItem: itemRef(parent.key, serverId) } : {}),
      collections:
        parent !== undefined
          ? []
          : payload.savedCollectionKeys.map((collectionKey) =>
              collectionRef(collectionKey, serverId),
            ),
      tags: payload.savedTags,
      sourceRefs: payload.savedRelations.map((uri) => relationUriToRef(uri, serverId)),
      libraryVersion: batch.libraryVersion,
      serverId,
    }
  })
}

/**
 * A saved relation URI back to the ref form the model uses; unparseable or
 * unprovable URIs stay verbatim. The echo of a personal note only ever
 * carries `users/0` outbound, so any `users/<id>` in it is Zotero's
 * canonicalization of that same personal library (see
 * `refs.relationTargetRef`); group targets are explicit cross-library refs.
 */
function relationUriToRef(uri: string, serverId: string): string {
  return relationTargetRef(uri, serverId, { personalContext: true }) ?? uri
}

/** What one read-merge-write plan receives, and how it sends its patch. */
interface ItemWriteContext {
  /** The item's write-relevant state as read under the pinned instance. */
  readonly snapshot: ItemSnapshot
  /** The serving instance id the read was answered under. */
  readonly serverId: string
  /** The provenance-qualified result ref for the outcome. */
  readonly resultRef: string
  /** Send one whole-object PATCH under the read's version precondition. */
  readonly send: (body: Record<string, unknown>) => Promise<{ libraryVersion: number }>
}

/**
 * The read-merge-write scaffold shared by every item update: pin the instance,
 * check the ref against it, read the item once, and hand the plan a snapshot
 * plus a `send` that carries the version precondition. The plan owns the merge
 * and the result shaping; an unchanged plan simply never calls `send`.
 */
async function withItemWrite<T>(
  deps: WriteDomainDeps,
  item: ZoteroObjectRef,
  signal: AbortSignal | undefined,
  plan: (context: ItemWriteContext) => Promise<T>,
): Promise<T> {
  const serverId = await ensureServerId(deps, signal)
  const ref = requireWritableRefAtServer(item, ['item'], serverId)
  const snapshot = await readItem(deps, ref, serverId, signal)
  const effectiveServerId = snapshot.serverId ?? serverId
  const send = (body: Record<string, unknown>): Promise<{ libraryVersion: number }> =>
    withWriteKey(
      deps,
      effectiveServerId,
      signal,
      async (apiKey) =>
        await deps.writer.patch(`${libraryPrefix(PERSONAL_LIBRARY)}/items/${ref.key}`, body, {
          serverId: effectiveServerId,
          apiKey,
          ifUnmodifiedSinceVersion: snapshot.version,
          signal,
        }),
    )
  return await plan({
    snapshot,
    serverId: effectiveServerId,
    resultRef: itemRef(ref.key, effectiveServerId),
    send,
  })
}

/**
 * Update one item's tags: add and remove settle in a single read-merge-write.
 * `add` and `remove` share one call so the same array never suffers two
 * competing preconditions; overlapping entries follow
 * `next = existing − remove ∪ (add − existing)` (a saved entry named in both
 * is removed, a new entry named in both is added).
 */
export async function updateItemTags(
  deps: WriteDomainDeps,
  request: ZoteroUpdateItemTagsRequest,
  signal?: AbortSignal,
): Promise<ZoteroUpdateItemTagsResult> {
  const localRef = requireWritableRef(request.item, ['item'])
  const add = normalizeWriteList('add', request.add ?? [])
  const remove = normalizeWriteList('remove', request.remove ?? [])
  if (add.length === 0 && remove.length === 0) {
    throw new ZoteroError(WRITE_LIST_SELECTION_MESSAGE, ZOTERO_INVALID_ARGUMENT)
  }
  return await withItemWrite(
    deps,
    localRef,
    signal,
    async ({ snapshot, serverId, resultRef, send }) => {
      const { merged, added, removed, changed } = mergeTagList(snapshot.tags, remove, add)
      if (!changed) {
        return {
          kind: 'applied',
          ref: resultRef,
          version: snapshot.version,
          tags: merged.map((entry) => entry.tag),
          added: [],
          removed: [],
          unchanged: true,
          serverId,
        }
      }
      const { libraryVersion } = await send({ tags: merged })
      return {
        kind: 'applied',
        ref: resultRef,
        version: libraryVersion,
        tags: merged.map((entry) => entry.tag),
        added,
        removed,
        unchanged: false,
        libraryVersion,
        serverId,
      }
    },
  )
}

/**
 * Update one item's collection membership. Names resolve to keys before any
 * item read, so an unknown or ambiguous name fails before the versioned cycle
 * starts; the merged key list is then written whole under the version
 * precondition.
 */
export async function updateItemCollections(
  deps: WriteDomainDeps,
  request: ZoteroUpdateItemCollectionsRequest,
  signal?: AbortSignal,
): Promise<ZoteroUpdateItemCollectionsResult> {
  const localRef = requireWritableRef(request.item, ['item'])
  const addInputs = (request.add ?? []).map((value) => normalizeCollectionInput('add', value))
  const removeInputs = (request.remove ?? []).map((value) =>
    normalizeCollectionInput('remove', value),
  )
  if (addInputs.length === 0 && removeInputs.length === 0) {
    throw new ZoteroError(WRITE_LIST_SELECTION_MESSAGE, ZOTERO_INVALID_ARGUMENT)
  }
  // Names resolve to keys before any item read, so an unknown or ambiguous
  // name fails before the versioned cycle starts. One batched resolution
  // serves both lists; the split below restores each list's own order.
  const serverId = await ensureServerId(deps, signal)
  const resolved = await deps.resolveCollections([...addInputs, ...removeInputs], signal)
  const addKeys = resolved
    .slice(0, addInputs.length)
    .map((target) => requireWritableRefAtServer(target, ['collection'], serverId).key)
  const removeKeys = resolved
    .slice(addInputs.length)
    .map((target) => requireWritableRefAtServer(target, ['collection'], serverId).key)
  return await withItemWrite(
    deps,
    localRef,
    signal,
    async ({ snapshot, serverId: effectiveServerId, resultRef, send }) => {
      const { merged, added, removed, changed } = mergeList(
        snapshot.collectionKeys,
        removeKeys,
        addKeys,
      )
      const toRefs = (keys: readonly string[]): string[] =>
        keys.map((key) => collectionRef(key, effectiveServerId))
      if (!changed) {
        return {
          kind: 'applied',
          ref: resultRef,
          version: snapshot.version,
          collections: toRefs(merged),
          added: [],
          removed: [],
          unchanged: true,
          serverId: effectiveServerId,
        }
      }
      const { libraryVersion } = await send({ collections: merged })
      return {
        kind: 'applied',
        ref: resultRef,
        version: libraryVersion,
        collections: toRefs(merged),
        added: toRefs(added),
        removed: toRefs(removed),
        unchanged: false,
        libraryVersion,
        serverId: effectiveServerId,
      }
    },
  )
}

/**
 * The sibling-name candidates for one create: the parent's children, or the
 * top-level collections. Fresh (no directory cache) and paginated to the
 * honest total — a check that stops at the first page would let a duplicate
 * beyond it slip through, which is exactly the ambiguity this check exists
 * to prevent.
 */
async function listSiblingsFresh(
  deps: WriteDomainDeps,
  parentKey: string | undefined,
  serverId: string,
  signal?: AbortSignal,
): Promise<{ key: string; name: string }[]> {
  const listPath =
    parentKey === undefined
      ? `${libraryPrefix(PERSONAL_LIBRARY)}/collections/top`
      : `${libraryPrefix(PERSONAL_LIBRARY)}/collections/${parentKey}/collections`
  const siblings: { key: string; name: string }[] = []
  let offset = 0
  for (;;) {
    const params = new URLSearchParams()
    params.set('start', String(offset))
    params.set('limit', String(SIBLING_PAGE_LIMIT))
    const { json, headers } = await deps.client.getJson<unknown>(listPath, params, {
      signal,
      serverId,
    })
    // Identity before shape: a response from another instance is never this
    // call's answer, so it is refused before its body is judged.
    assertServerIdMatches(headers.get(ZOTERO_SERVER_ID_HEADER), serverId)
    const rows = requireArrayBody(json, 'the collections listing')
    const total = requireTotalResults(headers, 'the collections listing')
    for (const row of rows) {
      const record = asRecord(row)
      const key = asString(record?.key)
      const name = asString(asRecord(record?.data)?.name)
      if (key === undefined || !isObjectKey(key) || name === undefined) continue
      siblings.push({ key, name })
    }
    const next = nextOffsetOf(offset, rows.length, total)
    if (next === undefined) return siblings
    offset = next
  }
}

/** One page of the sibling listing; the largest limit Zotero's object listings honor. */
const SIBLING_PAGE_LIMIT = 100

/**
 * Create a collection, optionally under a parent. A sibling that already
 * carries the name refuses the write before any POST — creating a second
 * same-named sibling would only manufacture resolution ambiguity.
 */
export async function createCollection(
  deps: WriteDomainDeps,
  request: ZoteroCreateCollectionRequest,
  signal?: AbortSignal,
): Promise<ZoteroCreateCollectionCommittedOutcome> {
  const name = requireNonBlank('name', request.name)
  const parentInput =
    request.parent === undefined ? undefined : normalizeCollectionInput('parent', request.parent)
  const serverId = await ensureServerId(deps, signal)
  const parent =
    parentInput === undefined
      ? undefined
      : requireWritableRefAtServer(
          await deps.resolveCollection(parentInput, signal),
          ['collection'],
          serverId,
        )
  const parentKey = parent?.key
  const siblings = await listSiblingsFresh(deps, parentKey, serverId, signal)
  if (siblings.some((entry) => entry.name === name)) {
    throw new ZoteroError(writeCollectionNameExistsMessage(name), ZOTERO_INVALID_ARGUMENT)
  }
  const entry: Record<string, unknown> = {
    name,
    ...(parentKey !== undefined ? { parentCollection: parentKey } : {}),
  }
  const created = await withWriteKey(deps, serverId, signal, async (apiKey) => {
    let batch: ZoteroBatchWrite
    try {
      batch = await deps.writer.batch(`${libraryPrefix(PERSONAL_LIBRARY)}/collections`, [entry], {
        serverId,
        apiKey,
        signal,
      })
    } catch (error) {
      if (error instanceof ZoteroWriteCommitUnknownError) {
        return committedUnverified(
          'collection',
          undefined,
          serverId,
          undefined,
          undefined,
          'commit-unknown',
        )
      }
      throw error
    }
    const proven = (data: Record<string, unknown>): string | undefined => {
      if (asString(data.name) !== name) return undefined
      // Zotero echoes no parent key for top-level collections, so both sides
      // normalize to undefined there; any other mismatch between the
      // requested and the echoed parent leaves the saved state unproven.
      const savedParent = asString(data.parentCollection)
      return (parentKey ?? undefined) === (savedParent ?? undefined) ? name : undefined
    }
    const settled = settleSingleEntryBatch(batch, 'collection', serverId, proven)
    if (settled.status === 'unverified') return settled.result
    const { key, version } = settled.entry
    return {
      kind: 'applied' as const,
      ref: collectionRef(key, serverId),
      key,
      version,
      name,
      ...(parentKey !== undefined ? { parentRef: collectionRef(parentKey, serverId) } : {}),
      libraryVersion: batch.libraryVersion,
      serverId,
    }
  })
  if (created.kind === 'applied' || created.key !== undefined) {
    deps.onCollectionsChanged?.()
  }
  return created
}

/**
 * Delete a collection by ref or name. One collection read serves both the
 * existence proof and the library-version precondition, so any concurrent
 * write fails the delete instead of slipping past it. A ref input skips name
 * resolution entirely — the read itself proves the ref; a name input
 * resolves first, because ambiguity is a pre-read refusal. Entries keep
 * their items (membership only); child collections go with the parent, per
 * Zotero semantics.
 */
export async function deleteCollection(
  deps: WriteDomainDeps,
  request: ZoteroDeleteCollectionRequest,
  signal?: AbortSignal,
): Promise<ZoteroDeleteCollectionResult> {
  const input = normalizeCollectionInput('collection', request.collection)
  const serverId = await ensureServerId(deps, signal)
  const checked = isRefString(input)
    ? requireWritableRefAtServer(parseRef(input), ['collection'], serverId)
    : requireWritableRefAtServer(
        await deps.resolveCollection(input, signal),
        ['collection'],
        serverId,
      )
  const { libraryVersion: precondition, serverId: effectiveServerId } =
    await readCollectionForDelete(deps, checked.key, serverId, signal)
  const resultRef = collectionRef(checked.key, effectiveServerId)
  const { libraryVersion } = await withWriteKey(deps, effectiveServerId, signal, async (apiKey) => {
    try {
      return await deps.writer.delete(
        `${libraryPrefix(PERSONAL_LIBRARY)}/collections/${checked.key}`,
        { serverId: effectiveServerId, apiKey, ifUnmodifiedSinceVersion: precondition, signal },
      )
    } catch (error) {
      if (error instanceof ZoteroError && error.code === ZOTERO_NOT_FOUND) {
        throw new ZoteroError(
          writeObjectRefusedMessage('The collection no longer exists.', 404),
          ZOTERO_NOT_FOUND,
        )
      }
      throw error
    }
  })
  deps.onCollectionsChanged?.()
  return {
    kind: 'deleted',
    ref: resultRef,
    key: checked.key,
    deleted: true,
    libraryVersion,
    serverId: effectiveServerId,
  }
}

/**
 * Create a bibliographic item from the closed field set. No BibTeX/CSL-JSON
 * channel exists: `POST /items` only accepts Zotero item JSON, so the entry
 * is assembled field-by-field and anything outside the set never leaves this
 * module.
 */
export async function createItem(
  deps: WriteDomainDeps,
  request: ZoteroCreateItemRequest,
  signal?: AbortSignal,
): Promise<ZoteroCreateItemCommittedOutcome> {
  const itemType = requireCreatableItemType(requireNonBlank('itemType', request.itemType))
  const title = request.title?.trim() ?? ''
  const url = request.url?.trim() ?? ''
  requireTitleOrUrl(title, url)
  const date = request.date?.trim() ?? ''
  const doi = request.doi?.trim() ?? ''
  const abstractNote = request.abstractNote?.trim() ?? ''
  const publicationTitle = request.publicationTitle?.trim() ?? ''
  const creators = (request.creators ?? []).map((creator, index) =>
    normalizeCreator(creator, index),
  )
  const serverId = await ensureServerId(deps, signal)
  const entry: Record<string, unknown> = {
    itemType,
    ...(title !== '' ? { title } : {}),
    ...(url !== '' ? { url } : {}),
    ...(date !== '' ? { date } : {}),
    ...(doi !== '' ? { DOI: doi } : {}),
    ...(abstractNote !== '' ? { abstractNote } : {}),
    ...(publicationTitle !== '' ? { publicationTitle } : {}),
    ...(creators.length > 0 ? { creators } : {}),
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
        return committedUnverified(
          'item',
          undefined,
          serverId,
          undefined,
          undefined,
          'commit-unknown',
        )
      }
      throw error
    }
    const proven = (
      data: Record<string, unknown>,
    ): { savedTitle: string | undefined } | undefined => {
      if (asString(data.itemType) !== itemType) return undefined
      return { savedTitle: asString(data.title) }
    }
    const settled = settleSingleEntryBatch(batch, 'item', serverId, proven)
    if (settled.status === 'unverified') return settled.result
    const { key, version, payload } = settled.entry
    return {
      kind: 'applied',
      ref: itemRef(key, serverId),
      key,
      version,
      itemType,
      ...(payload.savedTitle !== undefined
        ? { title: payload.savedTitle }
        : title !== ''
          ? { title }
          : {}),
      libraryVersion: batch.libraryVersion,
      serverId,
    }
  })
}

/**
 * Fetch the field names one item type accepts. Uncached by design — the
 * provider wraps this with the per-(instance, item type) memo and injects it
 * as {@link WriteDomainDeps.itemTypeFields}; the field set is static for a
 * running build, but each Zotero instance may speak its own schema.
 */
export async function fetchItemTypeFields(
  deps: Pick<WriteDomainDeps, 'client'>,
  itemType: string,
  signal?: AbortSignal,
): Promise<ReadonlySet<string>> {
  const params = new URLSearchParams()
  params.set('itemType', itemType)
  const { json } = await deps.client.getJson<unknown>('itemTypeFields', params, { signal })
  if (!Array.isArray(json)) {
    throw new ZoteroError(
      `Zotero answered the item-type fields without a valid array; a safe field check is impossible.`,
      ZOTERO_UNEXPECTED,
    )
  }
  const valid = new Set<string>()
  for (const row of json) {
    const field = asString(asRecord(row)?.field)
    if (field !== undefined) valid.add(field)
  }
  return valid
}

/**
 * Update one item's scalar metadata. Every requested field must belong to the
 * closed set and be valid for the item's own type (checked against the
 * injected `itemTypeFields` reader); the PATCH then carries only wire names
 * under the version precondition. `creators`, `itemType`, `tags`, and
 * `collections` have their own tools and never enter here.
 */
export async function updateItem(
  deps: WriteDomainDeps,
  request: ZoteroUpdateItemRequest,
  signal?: AbortSignal,
): Promise<ZoteroUpdateItemResult> {
  const localRef = requireWritableRef(request.item, ['item'])
  const entries = Object.entries(request.set ?? {})
  if (entries.length === 0) {
    throw new ZoteroError(writeListEmptyMessage('set'), ZOTERO_INVALID_ARGUMENT)
  }
  const updates = new Map<ZoteroUpdatableItemField, string>()
  for (const [field, value] of entries) {
    requireUpdatableField(field)
    if (typeof value !== 'string' || value.trim() === '') {
      throw new ZoteroError(writeNonBlankMessage(`set.${field}`), ZOTERO_INVALID_ARGUMENT)
    }
    updates.set(field as ZoteroUpdatableItemField, (value as string).trim())
  }
  return await withItemWrite(
    deps,
    localRef,
    signal,
    async ({ snapshot, serverId, resultRef, send }) => {
      const valid = await deps.itemTypeFields(snapshot.itemType, signal)
      const patch: Record<string, string> = {}
      const changed: string[] = []
      for (const [field, value] of updates) {
        const wire = wireFieldOf(field)
        if (!valid.has(wire)) {
          throw new ZoteroError(
            writeFieldNotForItemTypeMessage(field, snapshot.itemType),
            ZOTERO_INVALID_ARGUMENT,
          )
        }
        patch[wire] = value
        changed.push(field)
      }
      changed.sort()
      const { libraryVersion } = await send(patch)
      return {
        kind: 'applied',
        ref: resultRef,
        version: libraryVersion,
        changed,
        libraryVersion,
        serverId,
      }
    },
  )
}

/**
 * The library-wide tags delete path: `DELETE users/0/tags?tag=<enc1>||<enc2>`.
 * Each name is encoded on its own so the `||` separator survives intact.
 */
function tagsDeletePath(tags: readonly string[]): string {
  return `${libraryPrefix(PERSONAL_LIBRARY)}/tags?tag=${tags
    .map((name) => encodeURIComponent(name))
    .join('||')}`
}

/**
 * Delete tags library-wide. Names are idempotent (Zotero silently ignores
 * unknown names), the precondition is the library version of a preceding
 * read, and any concurrent write fails the delete rather than slipping past
 * it. Irreversible: the plan card must state the blast radius first.
 */
export async function deleteLibraryTags(
  deps: WriteDomainDeps,
  request: ZoteroDeleteLibraryTagsRequest,
  signal?: AbortSignal,
): Promise<ZoteroDeleteLibraryTagsResult> {
  const tags = normalizeWriteList('tags', request.tags ?? [])
  if (tags.length === 0) {
    throw new ZoteroError(writeListEmptyMessage('tags'), ZOTERO_INVALID_ARGUMENT)
  }
  const serverId = await ensureServerId(deps, signal)
  const { libraryVersion: precondition, serverId: effectiveServerId } = await readLibraryVersion(
    deps,
    serverId,
    signal,
  )
  const { libraryVersion } = await withWriteKey(deps, effectiveServerId, signal, async (apiKey) => {
    return await deps.writer.delete(tagsDeletePath(tags), {
      serverId: effectiveServerId,
      apiKey,
      ifUnmodifiedSinceVersion: precondition,
      tagDeleteLimit: true,
      signal,
    })
  })
  return {
    kind: 'deleted',
    deletedTags: [...tags].sort(),
    libraryVersion,
    serverId: effectiveServerId,
  }
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
