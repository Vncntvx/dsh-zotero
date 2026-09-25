/**
 * The `local` provider facade: the Zotero Local API seam implementing
 * {@link ZoteroProvider}. Capabilities are declared only for what this
 * provider implements, so a capability gate can never route work into a
 * method that does not exist. Every domain pipeline lives beside it in
 * `local/*-domain.ts`; this class owns the wiring — the HTTP client, the
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
  ZOTERO_SCOPE_LISTING_TTL_MS,
  ZOTERO_SERVER_ID_HEADER,
  ZOTERO_VERSION_HEADER,
} from '../constants.js'
import { PERSONAL_LIBRARY } from '../refs.js'
import { errorChain } from '@deepseek-ai/dsh-llm'
import { ZoteroError } from '../errors.js'
import type { ZoteroHttpClient } from '../http-client.js'
import type { LocalApiLimits, LocalApiProviderOptions } from './limits.js'
import { ScopeDirectory } from './scope-directory.js'
import { runSearch } from './search-domain.js'
import { getItem as getItemDomain, children as childrenDomain } from './detail.js'
import { retrieve as retrieveDomain } from './retrieve.js'
import { getAttachmentLocation as attachmentLocationDomain } from './attachment-location.js'
import { exportItems as exportItemsDomain } from './export-domain.js'
import { changes as changesDomain } from './changes-domain.js'
import { runBrowse } from './browse-domain.js'
import {
  addToCollection as addToCollectionDomain,
  createNote as createNoteDomain,
  updateTags as updateTagsDomain,
  type WriteDomainDeps,
  WRITE_CAPABILITY_UNAVAILABLE_CODE,
  writeCapabilityUnavailableMessage,
} from './write-domain.js'
import type { WriteAuthorizer } from '../write-auth.js'
import type { ZoteroWriteHttpClient } from '../write-http.js'
import type {
  ZoteroAttachmentLocation,
  ZoteroBrowseRequest,
  ZoteroBrowseResult,
  ZoteroCapability,
  ZoteroChangesRequest,
  ZoteroChangesResult,
  ZoteroChildrenRequest,
  ZoteroChildrenResult,
  ZoteroCollectionAddRequest,
  ZoteroCollectionAddResult,
  ZoteroCreateNoteRequest,
  ZoteroCreateNoteCommittedOutcome,
  ZoteroExportRequest,
  ZoteroExportResult,
  ZoteroGetRequest,
  ZoteroItemDetail,
  ZoteroObjectRef,
  ZoteroProvider,
  ZoteroRetrieveRequest,
  ZoteroRetrieveResult,
  ZoteroSearchRequest,
  ZoteroSearchResult,
  ZoteroStatus,
  ZoteroTagUpdateRequest,
  ZoteroTagUpdateResult,
} from '../types.js'

export class LocalApiProvider implements ZoteroProvider {
  readonly id = LOCAL_PROVIDER_ID
  readonly capabilities: ReadonlySet<ZoteroCapability>

  private readonly directory: ScopeDirectory
  private readonly getLimits: () => LocalApiLimits

  constructor(
    private readonly client: ZoteroHttpClient,
    limits: LocalApiLimits | (() => LocalApiLimits),
    private readonly options: LocalApiProviderOptions = {},
    private readonly writer?: ZoteroWriteHttpClient,
    private readonly authorizer?: WriteAuthorizer,
  ) {
    this.getLimits = typeof limits === 'function' ? limits : () => limits
    // The directory owns the scope-listing and breadcrumb caches; a
    // structural provider rebuild starts a fresh cache generation, while
    // limit-only settings edits keep this provider and its TTL caches alive.
    this.directory = new ScopeDirectory(
      client,
      this.options.scopeListingTtlMs ?? ZOTERO_SCOPE_LISTING_TTL_MS,
    )
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
  private deps(): { client: ZoteroHttpClient; limits: LocalApiLimits } {
    return { client: this.client, limits: this.getLimits() }
  }

  /**
   * The write collaborators, asserted: the service only reaches the write
   * methods through the `write` capability gate, which this provider declares
   * exactly when both collaborators exist — so this assertion guards direct
   * provider callers, not the service path.
   */
  private writeDeps(): WriteDomainDeps {
    if (this.writer === undefined || this.authorizer === undefined) {
      throw new ZoteroError(
        writeCapabilityUnavailableMessage(this.id),
        WRITE_CAPABILITY_UNAVAILABLE_CODE,
      )
    }
    return { client: this.client, writer: this.writer, authorizer: this.authorizer }
  }

  /**
   * Resolve a collection from a ref or a name through the cached scope
   * directory — the write domain takes the resolver as a function, so the
   * domain module stays free of the directory's cache semantics.
   */
  private resolveCollection(refOrName: string, signal?: AbortSignal): Promise<ZoteroObjectRef> {
    return this.directory
      .resolveNamed('collection', refOrName, PERSONAL_LIBRARY, signal, this.client.serverId)
      .then((resolved) => resolved.ref)
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
      const serverId = headers.get(ZOTERO_SERVER_ID_HEADER) ?? undefined
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
        connected: true,
        apiVersion: headers.get('zotero-api-version') ?? undefined,
        serverId,
        schemaVersion: headers.get('zotero-schema-version') ?? undefined,
        zoteroVersion: headers.get(ZOTERO_VERSION_HEADER) ?? undefined,
        ...(write !== undefined ? { write } : {}),
        diagnosis: 'ok',
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
  async search(request: ZoteroSearchRequest, signal?: AbortSignal): Promise<ZoteroSearchResult> {
    return runSearch(this.deps(), this.directory, request, signal)
  }

  /**
   * Diff the library against a local transaction version. The domain logic
   * lives in `local/changes-domain`; this is the seam.
   */
  async changes(request: ZoteroChangesRequest, signal?: AbortSignal): Promise<ZoteroChangesResult> {
    return changesDomain(this.deps(), request, signal)
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
  async export(request: ZoteroExportRequest, signal?: AbortSignal): Promise<ZoteroExportResult> {
    return exportItemsDomain(this.deps(), request, signal)
  }

  /**
   * Discover libraries, collections, saved searches, tags, item types, and
   * metadata fields. The domain logic lives in `local/browse-domain`; this
   * is the seam.
   */
  async browse(request: ZoteroBrowseRequest, signal?: AbortSignal): Promise<ZoteroBrowseResult> {
    return runBrowse(this.deps(), this.directory, request, signal)
  }

  /**
   * Create a research note (standalone, or a child note under a parent item)
   * with tags, collections, and source relations. The domain logic lives in
   * `local/write-domain`; this is the seam, and it is only reachable through
   * the `write` capability gate.
   */
  async createNote(
    request: ZoteroCreateNoteRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroCreateNoteCommittedOutcome> {
    return createNoteDomain(
      this.writeDeps(),
      (refOrName) => this.resolveCollection(refOrName, signal),
      request,
      signal,
    )
  }

  /**
   * Add tags to an item, preserving the tags it already carries. The domain
   * logic lives in `local/write-domain`; this is the seam.
   */
  async updateTags(
    request: ZoteroTagUpdateRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroTagUpdateResult> {
    return updateTagsDomain(this.writeDeps(), request, signal)
  }

  /**
   * Add an item to a collection. The domain logic lives in
   * `local/write-domain`; this is the seam.
   */
  async addToCollection(
    request: ZoteroCollectionAddRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroCollectionAddResult> {
    return addToCollectionDomain(
      this.writeDeps(),
      (refOrName) => this.resolveCollection(refOrName, signal),
      request,
      signal,
    )
  }
}
