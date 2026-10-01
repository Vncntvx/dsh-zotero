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
import type { ZoteroHttpClient } from '../http-client.js';
import type { WriteAuthorizer } from '../write-auth.js';
import { type ZoteroWriteHttpClient } from '../write-http.js';
import { type ZoteroCreateCollectionCommittedOutcome, type ZoteroCreateCollectionRequest, type ZoteroCreateItemCommittedOutcome, type ZoteroCreateItemRequest, type ZoteroCreateNoteCommittedOutcome, type ZoteroCreateNoteRequest, type ZoteroDeleteCollectionRequest, type ZoteroDeleteCollectionResult, type ZoteroDeleteLibraryTagsRequest, type ZoteroDeleteLibraryTagsResult, type ZoteroObjectRef, type ZoteroUpdateItemCollectionsRequest, type ZoteroUpdateItemCollectionsResult, type ZoteroUpdateItemRequest, type ZoteroUpdateItemResult, type ZoteroUpdateItemTagsRequest, type ZoteroUpdateItemTagsResult } from '../types.js';
/**
 * The collaborators one write-domain call needs; built per call by the
 * provider. The collection resolvers and the item-type field reader are
 * injected rather than imported so this module stays free of the scope
 * directory's cache semantics and of provider lifetime decisions.
 */
export interface WriteDomainDeps {
    readonly client: ZoteroHttpClient;
    readonly writer: ZoteroWriteHttpClient;
    readonly authorizer: WriteAuthorizer;
    /** Resolve one collection from a ref or an exact name. */
    readonly resolveCollection: (refOrName: string, signal?: AbortSignal) => Promise<ZoteroObjectRef>;
    /**
     * Resolve a mixed batch of collection refs and names, preserving input
     * order. Refs resolve through one cached listing (per-key reads only for
     * keys the listing lacks), so a 50-entry membership edit costs one request
     * in the common case.
     */
    readonly resolveCollections: (inputs: readonly string[], signal?: AbortSignal) => Promise<ZoteroObjectRef[]>;
    /**
     * The field names one item type accepts, memoized per (serving instance,
     * item type) by the provider — the field set is static for a running build.
     */
    readonly itemTypeFields: (itemType: string, signal?: AbortSignal) => Promise<ReadonlySet<string>>;
    /**
     * Called after a collection create or delete lands, so the scope directory
     * drops its cached listings before the next name resolution. Wired by the
     * provider; absent in direct-domain tests that own no directory.
     */
    readonly onCollectionsChanged?: () => void;
}
/** One item's write-relevant state, read fresh for every read-merge-write. */
export interface ItemSnapshot {
    readonly version: number;
    readonly itemType: string;
    readonly tags: readonly {
        readonly tag: string;
        readonly type?: number;
    }[];
    readonly collectionKeys: readonly string[];
    readonly serverId: string | undefined;
}
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
export declare function createNote(deps: WriteDomainDeps, request: ZoteroCreateNoteRequest, signal?: AbortSignal): Promise<ZoteroCreateNoteCommittedOutcome>;
/**
 * Update one item's tags: add and remove settle in a single read-merge-write.
 * `add` and `remove` share one call so the same array never suffers two
 * competing preconditions; overlapping entries follow
 * `next = existing − remove ∪ (add − existing)` (a saved entry named in both
 * is removed, a new entry named in both is added).
 */
export declare function updateItemTags(deps: WriteDomainDeps, request: ZoteroUpdateItemTagsRequest, signal?: AbortSignal): Promise<ZoteroUpdateItemTagsResult>;
/**
 * Update one item's collection membership. Names resolve to keys before any
 * item read, so an unknown or ambiguous name fails before the versioned cycle
 * starts; the merged key list is then written whole under the version
 * precondition.
 */
export declare function updateItemCollections(deps: WriteDomainDeps, request: ZoteroUpdateItemCollectionsRequest, signal?: AbortSignal): Promise<ZoteroUpdateItemCollectionsResult>;
/**
 * Create a collection, optionally under a parent. A sibling that already
 * carries the name refuses the write before any POST — creating a second
 * same-named sibling would only manufacture resolution ambiguity.
 */
export declare function createCollection(deps: WriteDomainDeps, request: ZoteroCreateCollectionRequest, signal?: AbortSignal): Promise<ZoteroCreateCollectionCommittedOutcome>;
/**
 * Delete a collection by ref or name. One collection read serves both the
 * existence proof and the library-version precondition, so any concurrent
 * write fails the delete instead of slipping past it. A ref input skips name
 * resolution entirely — the read itself proves the ref; a name input
 * resolves first, because ambiguity is a pre-read refusal. Entries keep
 * their items (membership only); child collections go with the parent, per
 * Zotero semantics.
 */
export declare function deleteCollection(deps: WriteDomainDeps, request: ZoteroDeleteCollectionRequest, signal?: AbortSignal): Promise<ZoteroDeleteCollectionResult>;
/**
 * Create a bibliographic item from the closed field set. No BibTeX/CSL-JSON
 * channel exists: `POST /items` only accepts Zotero item JSON, so the entry
 * is assembled field-by-field and anything outside the set never leaves this
 * module.
 */
export declare function createItem(deps: WriteDomainDeps, request: ZoteroCreateItemRequest, signal?: AbortSignal): Promise<ZoteroCreateItemCommittedOutcome>;
/**
 * Fetch the field names one item type accepts. Uncached by design — the
 * provider wraps this with the per-(instance, item type) memo and injects it
 * as {@link WriteDomainDeps.itemTypeFields}; the field set is static for a
 * running build, but each Zotero instance may speak its own schema.
 */
export declare function fetchItemTypeFields(deps: Pick<WriteDomainDeps, 'client'>, itemType: string, signal?: AbortSignal): Promise<ReadonlySet<string>>;
/**
 * Update one item's scalar metadata. Every requested field must belong to the
 * closed set and be valid for the item's own type (checked against the
 * injected `itemTypeFields` reader); the PATCH then carries only wire names
 * under the version precondition. `creators`, `itemType`, `tags`, and
 * `collections` have their own tools and never enter here.
 */
export declare function updateItem(deps: WriteDomainDeps, request: ZoteroUpdateItemRequest, signal?: AbortSignal): Promise<ZoteroUpdateItemResult>;
/**
 * Delete tags library-wide. Names are idempotent (Zotero silently ignores
 * unknown names), the precondition is the library version of a preceding
 * read, and any concurrent write fails the delete rather than slipping past
 * it. Irreversible: the plan card must state the blast radius first.
 */
export declare function deleteLibraryTags(deps: WriteDomainDeps, request: ZoteroDeleteLibraryTagsRequest, signal?: AbortSignal): Promise<ZoteroDeleteLibraryTagsResult>;
/**
 * The typed error a write-capability-less provider raises — unreachable
 * through the service's capability gate, but the direct-provider contract
 * fails with the same code instead of crashing.
 */
export declare function writeCapabilityUnavailableMessage(providerId: string): string;
export declare const WRITE_CAPABILITY_UNAVAILABLE_CODE = "ZOTERO_CAPABILITY_UNAVAILABLE";
//# sourceMappingURL=write-domain.d.ts.map