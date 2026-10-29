/**
 * The `local` provider facade: the Zotero Local API seam implementing
 * {@link ZoteroProvider}. Capabilities are declared only for what this
 * provider implements, so a capability gate can never route work into a
 * method that does not exist. Every domain pipeline lives beside it in
 * `local/*-domain.ts`; this class owns the wiring: the HTTP client, the
 * projected limits, and the scope directory whose caches rebuild with the
 * provider on every settings commit.
 *
 * Request-driven by design: loading never touches Zotero, and the only
 * health check is `status()`. Search semantics follow the Local API's
 * documented behavior (server-side paging over `/items/top`, client-side
 * scope-name resolution, literal tag escaping); first-page note-body
 * matches ride in `supplemental`, never inside the paged totals. The
 * provider keeps its limit projection live, so a limit-only settings edit
 * does not rebuild its transport or discard its scope caches.
 * @module dsh-zotero/local/provider
 */

import {
  LOCAL_PROVIDER_ID,
  ZOTERO_API_VERSION_HEADER,
  ZOTERO_SCHEMA_VERSION_HEADER,
  ZOTERO_VERSION_HEADER,
} from '../constants.js'
import { serverIdFromHeaders } from './identity.js'
import { PERSONAL_LIBRARY } from '../refs.js'
import { ZOTERO_DIAGNOSIS_OK } from '../contract.js'
import { errorChain } from '@deepseek-ai/dsh-llm'
import { ZoteroError, ZOTERO_CAPABILITY_UNAVAILABLE } from '../errors.js'
import { resolveCollectionsMixed, ScopeDirectory } from './scope-directory.js'
import type { DiagnosticSink } from '../diagnostics.js'
import type { ZoteroHttpClient } from '../http-client.js'
import type { LocalApiLimits } from './limits.js'
import { runSearch } from './search-domain.js'
import { createSearchIndexCaches, type SearchIndexCaches } from './search-index.js'
import {
  getItem as getItemDomain,
  getChildPage as getChildPageDomain,
  children as childrenDomain,
} from './detail.js'
import { retrieve as retrieveDomain } from './retrieve.js'
import { getAttachmentLocation as attachmentLocationDomain } from './attachment-location.js'
import { exportItems as exportItemsDomain } from './export-domain.js'
import { changes as changesDomain } from './changes-domain.js'
import { runBrowse } from './browse-domain.js'
import { ItemSchemaDirectory } from './item-schema-directory.js'
import type { WriteDomainDeps } from './write-deps.js'
import {
  createItem as createItemDomain,
  updateItem as updateItemDomain,
  writeCapabilityUnavailableMessage,
} from './write-domain.js'
import {
  deleteLibraryTags as deleteLibraryTagsDomain,
  restoreItems as restoreItemsDomain,
} from './write-library-maintenance.js'
import { createNote as createNoteDomain, updateNote as updateNoteDomain } from './write-notes.js'
import {
  updateItemCollections as updateItemCollectionsDomain,
  updateItemTags as updateItemTagsDomain,
} from './write-item-lists.js'
import { batchItems as batchItemsDomain } from './write-batch.js'
import {
  createCollection as createCollectionDomain,
  deleteCollection as deleteCollectionDomain,
  updateCollection as updateCollectionDomain,
} from './write-collections.js'
import {
  createSavedSearch as createSavedSearchDomain,
  updateSavedSearch as updateSavedSearchDomain,
  deleteSavedSearch as deleteSavedSearchDomain,
} from './write-saved-searches.js'
import type { WriteAuthorizer } from '../write-auth.js'
import type { ZoteroWriteHttpClient } from '../write-http.js'
import type {
  ZoteroAttachmentLocation,
  ZoteroBrowseRequest,
  ZoteroBrowseResult,
  ZoteroCapability,
  ZoteroChangesRequest,
  ZoteroChangesResult,
  ZoteroChildPage,
  ZoteroChildPageRequest,
  ZoteroChildrenRequest,
  ZoteroChildrenResult,
  ZoteroCreateCollectionCommittedOutcome,
  ZoteroCreateCollectionRequest,
  ZoteroCreateItemCommittedOutcome,
  ZoteroCreateItemRequest,
  ZoteroCreateNoteRequest,
  ZoteroCreateNoteCommittedOutcome,
  ZoteroDeleteCollectionRequest,
  ZoteroDeleteCollectionResult,
  ZoteroDeleteLibraryTagsRequest,
  ZoteroDeleteLibraryTagsResult,
  ZoteroBatchItemsRequest,
  ZoteroBatchItemsResult,
  ZoteroExportRequest,
  ZoteroExportResult,
  ZoteroGetRequest,
  ZoteroItemDetail,
  ZoteroObjectRef,
  ZoteroProgressEvent,
  ZoteroProvider,
  ZoteroRetrieveRequest,
  ZoteroRetrieveResult,
  ZoteroSearchOptions,
  ZoteroSearchRequest,
  ZoteroSearchResult,
  ZoteroStatus,
  ZoteroUpdateItemCollectionsRequest,
  ZoteroUpdateItemCollectionsResult,
  ZoteroUpdateItemRequest,
  ZoteroUpdateItemResult,
  ZoteroUpdateItemTagsRequest,
  ZoteroUpdateItemTagsResult,
  ZoteroUpdateNoteRequest,
  ZoteroUpdateNoteResult,
  ZoteroUpdateCollectionRequest,
  ZoteroUpdateCollectionResult,
  ZoteroRestoreItemsRequest,
  ZoteroRestoreItemsResult,
  ZoteroCreateSavedSearchRequest,
  ZoteroSavedSearchResult,
  ZoteroUpdateSavedSearchRequest,
  ZoteroDeleteSavedSearchRequest,
  ZoteroDeleteSavedSearchResult,
  ZoteroWriteCommittedUnverified,
} from '../types.js'

export class LocalApiProvider implements ZoteroProvider {
  readonly id = LOCAL_PROVIDER_ID
  readonly capabilities: ReadonlySet<ZoteroCapability>

  private readonly directory: ScopeDirectory
  private readonly itemSchema: ItemSchemaDirectory
  private readonly getLimits: () => LocalApiLimits
  private readonly searchCaches: SearchIndexCaches

  constructor(
    private readonly client: ZoteroHttpClient,
    limits: LocalApiLimits | (() => LocalApiLimits),
    private readonly writer?: ZoteroWriteHttpClient,
    private readonly authorizer?: WriteAuthorizer,
    sink?: DiagnosticSink,
  ) {
    this.getLimits = typeof limits === 'function' ? limits : () => limits
    this.searchCaches = createSearchIndexCaches()
    // The directory owns the scope-listing and breadcrumb caches. It reads the
    // TTL and the fan-out bound through the live limits, so a settings edit
    // changes how long an existing cache entry is trusted (and how wide a
    // collection-resolution fan-out may run) instead of rebuilding this
    // provider (and with it the HTTP client, the write client and the
    // authorizer's grants).
    this.directory = new ScopeDirectory(
      client,
      () => this.getLimits().scopeListingTtlMs,
      () => this.getLimits().graphConcurrency,
      sink,
    )
    this.itemSchema = new ItemSchemaDirectory(client)
    // `write` is declared only when the write collaborators are wired: a
    // capability without its method would be a gate that routes into
    // nothing.
    this.capabilities = new Set<ZoteroCapability>([
      'metadata',
      'search',
      'attachments',
      'citation',
      'browse',
      'retrieve',
      'changes',
      ...(writer !== undefined && authorizer !== undefined ? (['write'] as const) : []),
    ])
  }

  /** One deps bundle per call keeps every domain signature explicit. */
  private deps(): {
    client: ZoteroHttpClient
    limits: LocalApiLimits
    searchCaches: SearchIndexCaches
  } {
    return { client: this.client, limits: this.getLimits(), searchCaches: this.searchCaches }
  }

  /**
   * The write collaborators, asserted: the service only reaches the write
   * methods through the `write` capability gate, which this provider declares
   * exactly when both collaborators exist, so this assertion guards direct
   * provider callers, not the service path. Collection writes invalidate the
   * scope directory through the injected callback, so a renamed cache never
   * outlives the write that stale-dated it.
   */
  private writeDeps(): WriteDomainDeps {
    if (this.writer === undefined || this.authorizer === undefined) {
      throw new ZoteroError(
        writeCapabilityUnavailableMessage(this.id),
        ZOTERO_CAPABILITY_UNAVAILABLE,
      )
    }
    return {
      client: this.client,
      writer: this.writer,
      authorizer: this.authorizer,
      resolveCollection: (refOrName, signal) =>
        this.resolveCollections([refOrName], signal).then((refs) => refs[0]!),
      resolveCollections: (inputs, signal) => this.resolveCollections(inputs, signal),
      itemTypeFields: (itemType, signal) => this.itemSchema.getWritableItemFields(itemType, signal),
      onCollectionsChanged: () => this.directory.invalidate(PERSONAL_LIBRARY, 'collections'),
    }
  }

  /**
   * Resolve a mixed batch of collection refs and exact names, preserving
   * input order. The partition/ref-listing/name-resolution orchestration
   * lives once in `scope-directory.resolveCollectionsMixed`.
   */
  private resolveCollections(
    inputs: readonly string[],
    signal?: AbortSignal,
  ): Promise<ZoteroObjectRef[]> {
    return resolveCollectionsMixed(
      this.directory,
      inputs,
      PERSONAL_LIBRARY,
      signal,
      this.client.serverId,
    )
  }

  /**
   * Probe `GET /api/` and report connectivity plus the instance identity
   * headers. Health checks live here, not on every tool call. An explicit
   * caller abort propagates instead of folding into `connected: false`, so a
   * cancel is never mistaken for a connectivity problem.
   */
  async status(signal?: AbortSignal): Promise<ZoteroStatus> {
    try {
      const { headers } = await this.client.get('', undefined, { signal })
      const serverId = serverIdFromHeaders(headers)
      // The write block rides only when the provider wires the capability at
      // all; its absence is the statement "this provider serves no writes".
      const write =
        this.writer === undefined || this.authorizer === undefined
          ? undefined
          : {
              enabled: this.capabilities.has('write'),
              authorized: await this.authorizer.hasGrant(serverId ?? ''),
            }
      return {
        providerId: this.id,
        // The authority this provider dialled, reported whether or not the
        // probe answered: when it did not, the address is what the user needs.
        endpoint: this.client.endpoint,
        connected: true,
        apiVersion: headers.get(ZOTERO_API_VERSION_HEADER) ?? undefined,
        serverId,
        schemaVersion: headers.get(ZOTERO_SCHEMA_VERSION_HEADER) ?? undefined,
        zoteroVersion: headers.get(ZOTERO_VERSION_HEADER) ?? undefined,
        ...(write !== undefined ? { write } : {}),
        diagnosis: ZOTERO_DIAGNOSIS_OK,
      }
    } catch (error) {
      if (signal?.aborted) throw error
      // The code rides along in the diagnosis string so the model (and the
      // settings card) can route on it; routing still matches on the code,
      // never by parsing the message. Non-domain failures render their full
      // cause chain so a wrapped transport error is not reduced to its top
      // message.
      const diagnosis =
        error instanceof ZoteroError ? `${error.code}: ${error.message}` : errorChain(error)
      return {
        providerId: this.id,
        // The address that did not answer is exactly the fact a user needs to
        // check next, so the endpoint rides the failure arm too.
        endpoint: this.client.endpoint,
        connected: false,
        diagnosis,
      }
    }
  }

  /**
   * Discover candidates; the provider resolves scopes and serves the compact
   * records. The domain logic lives in `local/search-domain`; this method is
   * the provider seam that carries the client/limits/directory wiring.
   */
  async search(
    request: ZoteroSearchRequest,
    signal: AbortSignal | undefined,
    options: ZoteroSearchOptions,
  ): Promise<ZoteroSearchResult> {
    return runSearch(this.deps(), this.directory, request, signal, options)
  }

  /**
   * Diff the library against a local transaction version. The domain logic
   * lives in `local/changes-domain`; this is the seam.
   */
  async changes(
    request: ZoteroChangesRequest,
    signal?: AbortSignal,
    onProgress?: (progress: ZoteroProgressEvent) => void,
  ): Promise<ZoteroChangesResult> {
    return changesDomain(this.deps(), request, signal, onProgress)
  }

  /**
   * Read one item's metadata plus optionally requested child content. The
   * domain logic lives in `local/detail`; this is the provider seam.
   */
  async getItem(request: ZoteroGetRequest, signal?: AbortSignal): Promise<ZoteroItemDetail> {
    return getItemDomain(this.deps(), this.directory, request, signal)
  }

  /**
   * Explore one item's or attachment's child-object graph. The domain logic
   * lives in `local/detail`; this is the provider seam.
   */
  async children(
    request: ZoteroChildrenRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroChildrenResult> {
    return childrenDomain(this.deps(), request, signal)
  }

  /** One paged child listing; the domain owns the ref/window/cap rules. */
  async getChildPage(
    request: ZoteroChildPageRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroChildPage> {
    return getChildPageDomain(this.deps(), request, signal)
  }

  /**
   * Resolve an item or attachment ref to a usable location. The domain
   * logic lives in `local/attachment-location`; this is the seam.
   */
  async getAttachmentLocation(
    ref: ZoteroObjectRef,
    signal?: AbortSignal,
  ): Promise<ZoteroAttachmentLocation> {
    return attachmentLocationDomain(this.deps(), ref, signal)
  }

  /**
   * Gather ranked evidence passages for one item across the requested
   * sources. The domain logic lives in `local/retrieve`; this is the seam.
   */
  async retrieve(
    request: ZoteroRetrieveRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroRetrieveResult> {
    return retrieveDomain(this.deps(), request, signal)
  }

  /**
   * Export citations or formatted output for the requested items. The
   * domain logic lives in `local/export-domain`; this is the seam.
   */
  async export(
    request: ZoteroExportRequest,
    signal?: AbortSignal,
    onProgress?: (progress: ZoteroProgressEvent) => void,
  ): Promise<ZoteroExportResult> {
    return exportItemsDomain(this.deps(), request, signal, onProgress)
  }

  /**
   * Discover libraries, collections, saved searches, tags, item types, and
   * metadata fields. The domain logic lives in `local/browse-domain`; this
   * is the seam.
   */
  async browse(request: ZoteroBrowseRequest, signal?: AbortSignal): Promise<ZoteroBrowseResult> {
    return runBrowse(this.deps(), this.directory, this.itemSchema, request, signal)
  }

  /**
   * Create a research note (standalone, or a child note under a parent item)
   * with tags, collections, and source relations. The domain logic lives in
   * `local/write-notes`; this is the seam, and it is only reachable through
   * the `write` capability gate.
   */
  async createNote(
    request: ZoteroCreateNoteRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroCreateNoteCommittedOutcome> {
    return createNoteDomain(this.writeDeps(), request, signal)
  }

  /**
   * Update one item's tags (add/remove in one write). The domain logic lives
   * in `local/write-item-lists`; this is the seam.
   */
  async updateItemTags(
    request: ZoteroUpdateItemTagsRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroUpdateItemTagsResult> {
    return updateItemTagsDomain(this.writeDeps(), request, signal)
  }

  async updateNote(
    request: ZoteroUpdateNoteRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroUpdateNoteResult> {
    return updateNoteDomain(this.writeDeps(), request, signal)
  }

  /**
   * Update one item's collection membership (add/remove in one write). The
   * domain logic lives in `local/write-item-lists`; this is the seam.
   */
  async updateItemCollections(
    request: ZoteroUpdateItemCollectionsRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroUpdateItemCollectionsResult> {
    return updateItemCollectionsDomain(this.writeDeps(), request, signal)
  }

  async updateCollection(
    request: ZoteroUpdateCollectionRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroUpdateCollectionResult> {
    return updateCollectionDomain(this.writeDeps(), request, signal)
  }

  /**
   * Create a collection, optionally under a parent. The domain logic lives in
   * `local/write-collections`; this is the seam.
   */
  async createCollection(
    request: ZoteroCreateCollectionRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroCreateCollectionCommittedOutcome> {
    return createCollectionDomain(this.writeDeps(), request, signal)
  }

  /**
   * Delete a collection by ref or name. The domain logic lives in
   * `local/write-collections`; this is the seam.
   */
  async deleteCollection(
    request: ZoteroDeleteCollectionRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroDeleteCollectionResult> {
    return deleteCollectionDomain(this.writeDeps(), request, signal)
  }

  /**
   * Create a bibliographic item from the closed field set. The domain logic
   * lives in `local/write-domain`; this is the seam.
   */
  async createItem(
    request: ZoteroCreateItemRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroCreateItemCommittedOutcome> {
    return createItemDomain(this.writeDeps(), request, signal)
  }

  /**
   * Update one item's scalar metadata fields. The domain logic lives in
   * `local/write-domain`; this is the seam.
   */
  async updateItem(
    request: ZoteroUpdateItemRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroUpdateItemResult> {
    return updateItemDomain(this.writeDeps(), request, signal)
  }

  /**
   * Delete tags library-wide. The domain logic lives in
   * `local/write-library-maintenance`; this is the seam.
   */
  async deleteLibraryTags(
    request: ZoteroDeleteLibraryTagsRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroDeleteLibraryTagsResult> {
    return deleteLibraryTagsDomain(this.writeDeps(), request, signal)
  }

  /**
   * Batch items operation: create/import, update tags/collections, delete.
   */
  async batchItems(
    request: ZoteroBatchItemsRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroBatchItemsResult> {
    return batchItemsDomain(this.writeDeps(), request, signal)
  }

  async restoreItems(
    request: ZoteroRestoreItemsRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroRestoreItemsResult> {
    return restoreItemsDomain(this.writeDeps(), request, signal)
  }

  async createSavedSearch(
    request: ZoteroCreateSavedSearchRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroSavedSearchResult | ZoteroWriteCommittedUnverified> {
    return createSavedSearchDomain(this.writeDeps(), request, signal)
  }

  async updateSavedSearch(
    request: ZoteroUpdateSavedSearchRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroSavedSearchResult> {
    return updateSavedSearchDomain(this.writeDeps(), request, signal)
  }

  async deleteSavedSearch(
    request: ZoteroDeleteSavedSearchRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroDeleteSavedSearchResult> {
    return deleteSavedSearchDomain(this.writeDeps(), request, signal)
  }
}
