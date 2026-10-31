/**
 * The core item write domain: item creation/update plus the shared identity,
 * authorization, and versioned-write primitives used by the focused note,
 * collection, list, batch, and maintenance modules. Every write follows the
 * lifecycle the Zotero 10 protocol implies:
 *
 * - the target is always the personal library (`users/0`); a ref naming a
 *   group or a foreign user id is refused before any network happens;
 * - the serving instance id is established (and pinned) before any read or
 *   write, because every write must carry `Zotero-Server-ID`;
 * - the API key comes from {@link WriteAuthorizer}, and a 401 replays the
 *   same request exactly once after a fresh authorization: single-use keys
 *   are consumed at authentication time, so a burned key is forgotten;
 * - tag, collection-membership, and scalar updates are read-merge-write under
 *   an `If-Unmodified-Since-Version` precondition: PATCH replaces arrays
 *   wholesale, so the merged list must be sent whole;
 * - collection and tag deletes carry the library version of their preceding
 *   read; item Trash PATCHes carry each object's version while processing its
 *   complete child graph, so concurrent changes fail closed;
 * - one object per batch means a Zotero refusal surfaces as a typed error,
 *   never as a silently skipped entry in a bucket.
 *
 * There is no retry beyond the re-authorization replay, and a version
 * conflict (412) is reported as `ZOTERO_WRITE_CONFLICT` for the model to
 * re-run: the tool re-reads and reapplies on top of what is there now.
 * Non-idempotent creates (note, item, collection) never retry: an unprovable
 * commit surfaces as `committed-unverified` with `retryable: false`.
 * @module dsh-zotero/local/write-domain
 */
import { normalizeCreator } from '../write-item-rules.js';
import type { ItemSnapshot, WriteDomainDeps } from './write-deps.js';
import { type ZoteroCreateItemCommittedOutcome, type ZoteroCreateItemRequest, type ZoteroObjectRef, type ZoteroUpdateItemRequest, type ZoteroUpdateItemResult } from '../types.js';
type ItemTags = readonly {
    readonly tag: string;
    readonly type?: number;
}[];
export type ItemStateReader<S> = (data: Record<string, unknown>) => S;
export declare function tagState(data: Record<string, unknown>): {
    tags: ItemTags;
};
export declare function collectionState(data: Record<string, unknown>): {
    collectionKeys: readonly string[];
};
/** True when the error is Zotero refusing the write for a missing or consumed key. */
export declare function isWriteUnauthorized(error: unknown): boolean;
/**
 * The one legitimate write replay: authorize, send once; on a 401 forget the
 * key (single-use keys are consumed at authentication, and a stored grant may
 * have been revoked), authorize again, send the identical request once more.
 * A second 401 escalates with the after-authorization guidance; a one-time
 * key is always forgotten once its write settles, consumed either way.
 */
export declare function withWriteKey<T>(deps: WriteDomainDeps, serverId: string, signal: AbortSignal | undefined, send: (apiKey: string) => Promise<T>): Promise<T>;
/**
 * The instance id every write must carry. The read client remembers it from
 * the latest response; when this process has read nothing yet, one probe of
 * `/api/` establishes it. A build that reports no instance id has no local
 * write protocol to talk to.
 */
export declare function ensureServerId(deps: WriteDomainDeps, signal?: AbortSignal): Promise<string>;
/** Refuse a qualified ref that names another Zotero instance before any write. */
export declare function requireWritableRefAtServer(ref: ZoteroObjectRef, kinds: readonly ZoteroObjectRef['kind'][], serverId: string): ZoteroObjectRef;
/** Refuse a qualified ref that names another Zotero instance before citing as relation source. */
export declare function requireSupportedRefAtServer(ref: ZoteroObjectRef, kinds: readonly ZoteroObjectRef['kind'][], serverId: string): ZoteroObjectRef;
export declare function normalizeWriteList(name: string, values: readonly string[]): string[];
/** Validate a ref-shaped collection argument locally; names remain live lookups. */
export declare function normalizeCollectionInput(name: string, value: string): string;
/**
 * Merge string lists: `merged = (existing − remove) ∪ (add − existing)`.
 * Order is existing-first, then genuinely new additions in request order;
 * duplicates collapse. `added`/`removed` name the actual changes, not the
 * request, and `changed` is false exactly when nothing would move.
 */
export declare function mergeList(existing: readonly string[], remove: readonly string[], add: readonly string[]): {
    merged: string[];
    added: string[];
    removed: string[];
    changed: boolean;
};
/**
 * Merge tag entries, preserving each retained tag's type. New tags carry no
 * type; removed tags are gone. Shape mirrors {@link mergeList} for the
 * collection and tag tools to share one semantic.
 */
export declare function mergeTagList(existing: readonly {
    readonly tag: string;
    readonly type?: number;
}[], remove: readonly string[], add: readonly string[]): {
    merged: {
        tag: string;
        type?: number;
    }[];
    added: string[];
    removed: string[];
    changed: boolean;
};
/**
 * Read one collection or saved search under the instance pin and prove the
 * object version its update must carry. Deletes additionally use the library
 * version this same read reports as their precondition, so any concurrent
 * write fails the delete instead of slipping past it.
 */
export declare function readRecordForWrite(deps: WriteDomainDeps, object: 'collection' | 'search', key: string, serverId: string, signal?: AbortSignal): Promise<{
    data: Record<string, unknown> | undefined;
    version: number;
    libraryVersion: number | undefined;
    serverId: string;
}>;
/** The delete paths cannot proceed without the library version their read reported. */
export declare function requireLibraryVersion(libraryVersion: number | undefined): number;
/** Parse a saved tag array strictly; undefined means malformed, absent means empty. */
export declare function tagsOf(data: Record<string, unknown> | undefined): ItemTags | undefined;
/** Parse a saved collection-key array strictly; undefined means malformed. */
export declare function strictCollectionKeysOf(data: Record<string, unknown> | undefined): string[] | undefined;
/** What one read-merge-write plan receives, and how it sends its patch. */
export interface ItemWriteContext<S> {
    /** The item's write-relevant state as read under the pinned instance. */
    readonly snapshot: ItemSnapshot & S;
    /** The serving instance id the read was answered under. */
    readonly serverId: string;
    /** The provenance-qualified result ref for the outcome. */
    readonly resultRef: string;
    /** Send one whole-object PATCH under the read's version precondition. */
    readonly send: (body: Record<string, unknown>) => Promise<{
        libraryVersion: number;
    }>;
}
/**
 * The same scaffold for plans that merge list state: the reader decides what
 * the snapshot must carry, and its result is the only place that state is
 * read, so a plan never guesses at a field the read did not prove.
 */
export declare function withItemStateWrite<S, T>(deps: WriteDomainDeps, item: ZoteroObjectRef, signal: AbortSignal | undefined, readState: ItemStateReader<S>, plan: (context: ItemWriteContext<S>) => Promise<T>): Promise<T>;
export interface CheckedCreateItem {
    readonly itemType: string;
    readonly title: string | undefined;
    readonly url: string | undefined;
    readonly date: string | undefined;
    readonly doi: string | undefined;
    readonly abstractNote: string | undefined;
    readonly publicationTitle: string | undefined;
    readonly creators: ReturnType<typeof normalizeCreator>[] | undefined;
    readonly tags: string[];
    readonly colInputs: string[];
}
export interface CreateItemFieldsInput {
    readonly itemType: string;
    readonly title?: string;
    readonly url?: string;
    readonly date?: string;
    readonly doi?: string;
    readonly abstractNote?: string;
    readonly publicationTitle?: string;
    readonly creators?: readonly Parameters<typeof normalizeCreator>[0][];
    readonly tags?: readonly string[];
    readonly collections?: readonly (string | ZoteroObjectRef)[];
}
export declare function normalizeCreateFields(raw: CreateItemFieldsInput, labels: {
    readonly collections: string;
}): CheckedCreateItem;
export declare function createWireEntry(checked: CheckedCreateItem, collectionKeys: readonly string[]): Record<string, unknown>;
/**
 * Create a bibliographic item from the closed field set. No BibTeX/CSL-JSON
 * channel exists: `POST /items` only accepts Zotero item JSON, so the entry
 * is assembled field-by-field and anything outside the set never leaves this
 * module.
 */
export declare function createItem(deps: WriteDomainDeps, request: ZoteroCreateItemRequest, signal?: AbortSignal): Promise<ZoteroCreateItemCommittedOutcome>;
/**
 * Update one item's scalar metadata. Every requested field must belong to the
 * closed set and be valid for the item's own type (checked against the
 * injected `itemTypeFields` reader); the PATCH then carries only wire names
 * under the version precondition. `creators`, `itemType`, `tags`, and
 * `collections` have their own tools and never enter here.
 */
export declare function updateItem(deps: WriteDomainDeps, request: ZoteroUpdateItemRequest, signal?: AbortSignal): Promise<ZoteroUpdateItemResult>;
/**
 * The typed error a write-capability-less provider raises. It is unreachable
 * through the service's capability gate, but the direct-provider contract
 * fails with the same code instead of crashing.
 */
export declare function writeCapabilityUnavailableMessage(providerId: string): string;
export {};
//# sourceMappingURL=write-domain.d.ts.map