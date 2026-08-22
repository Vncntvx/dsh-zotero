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
 * matches ride in `supplemental`, never inside the paged totals.
 * @module dsh-zotero/local/provider
 */

import { LOCAL_PROVIDER_ID, ZOTERO_SCOPE_LISTING_TTL_MS } from '../constants.js'
import { errorMessageOf } from '../errors.js'
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
import type {
  ZoteroAttachmentLocation,
  ZoteroBrowseRequest,
  ZoteroBrowseResult,
  ZoteroCapability,
  ZoteroChangesRequest,
  ZoteroChangesResult,
  ZoteroChildrenRequest,
  ZoteroChildrenResult,
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
} from '../types.js'

export class LocalApiProvider implements ZoteroProvider {
  readonly id = LOCAL_PROVIDER_ID
  readonly capabilities: ReadonlySet<ZoteroCapability> = new Set<ZoteroCapability>([
    'metadata',
    'search',
    'attachments',
    'fulltext',
    'citation',
    'browse',
    'retrieve',
    'changes',
  ])

  private readonly directory: ScopeDirectory

  constructor(
    private readonly client: ZoteroHttpClient,
    private readonly limits: LocalApiLimits,
    private readonly options: LocalApiProviderOptions = {},
  ) {
    // The directory owns the scope-listing and breadcrumb caches; rebuilding
    // the provider rebuilds it, so a settings commit starts a fresh
    // cache generation.
    this.directory = new ScopeDirectory(
      client,
      this.options.scopeListingTtlMs ?? ZOTERO_SCOPE_LISTING_TTL_MS,
    )
  }

  /** One deps bundle per call keeps every domain signature explicit. */
  private deps(): { client: ZoteroHttpClient; limits: LocalApiLimits } {
    return { client: this.client, limits: this.limits }
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
      return {
        providerId: this.id,
        connected: true,
        apiVersion: headers.get('zotero-api-version') ?? undefined,
        serverId: headers.get('zotero-server-id') ?? undefined,
        schemaVersion: headers.get('zotero-schema-version') ?? undefined,
        diagnosis: 'ok',
      }
    } catch (error) {
      if (signal?.aborted) throw error
      return {
        providerId: this.id,
        connected: false,
        diagnosis: errorMessageOf(error),
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
}
