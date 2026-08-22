/**
 * The `local` provider: the Zotero Local API at `127.0.0.1:23119/api`.
 * Capabilities are declared only for what this provider currently
 * implements, so a capability gate can never route work into a method that
 * does not exist. Search semantics follow the Local API's documented
 * behavior: server-side pagination over `/items/top`, collection and saved
 * search scopes resolved client-side (the Local API has no server-side name
 * search), and literal tag names escaped so they never become query syntax.
 * Zotero's index never covers note bodies, so the first page of a queried
 * search (offset 0) may fill unused result slots after Zotero's primary
 * search results with client-side note-body matches (capped by
 * `maxNoteScanRecords`; collection scopes filter by membership). They do not
 * compete with or displace a full primary result page. The matches are listed
 * in `supplemental` — a separate collection from the paged `items`/`total`,
 * so pagination stays API-driven and the primary sort stays exact.
 * @module dsh-zotero/provider-local
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ZoteroHttpClient } from './http-client.js'
import { mapWithConcurrency } from './concurrency.js'
import {
  LOCAL_PROVIDER_ID,
  ZOTERO_EXPORT_CONCURRENCY,
  ZOTERO_ITEMKEY_BATCH,
  ZOTERO_SCOPE_LISTING_TTL_MS,
} from './constants.js'
import {
  NO_FULLTEXT_MESSAGE,
  SERVER_MISMATCH_MESSAGE,
  isNotFoundError,
  ZOTERO_FILE_MISSING,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_OUTPUT_TOO_LARGE,
  ZOTERO_NO_ATTACHMENT,
  ZOTERO_UNEXPECTED,
  ZOTERO_NO_FULLTEXT,
  ZOTERO_NOT_FOUND,
  ZOTERO_SCOPE_AMBIGUOUS,
  ZOTERO_SERVER_MISMATCH,
  ZoteroError,
  errorMessageOf,
} from './errors.js'
import { locateExportItems } from './export-mapping.js'
import { asRecord, asString, isObjectKey } from './json.js'
import {
  attachmentRecordOf,
  childCollection,
  collectionKeysOf,
  normalizeItemDetail,
  normalizeScopeEntry,
  normalizeSearchItem,
  partitionChildren,
  plainNoteText,
  truncateText,
  type NormalizeContext,
  type PartitionedChildren,
  type ScopeNameEntry,
  type ZoteroChildKind,
} from './normalize.js'
import {
  bestAttachmentFromLinks,
  normalizeAttachmentRecord,
  selectAttachments,
} from './attachments.js'
import {
  formatRef,
  isRefString,
  libraryPrefix,
  parseRef,
  sameLibrary,
  PERSONAL_GROUPS_DISCOVERY,
  PERSONAL_LIBRARY,
  refForLibrary,
  requireSupportedLocalRef,
} from './refs.js'
import { nextOffsetOf, requireTotalResults } from './local/pagination.js'
import { type LocalApiLimits, type LocalApiProviderOptions } from './local/limits.js'

export type { LocalApiLimits, LocalApiProviderOptions } from './local/limits.js'
import { ScopeDirectory } from './local/scope-directory.js'
import { runSearch } from './local/search-domain.js'
import { children, getItem } from './local/detail.js'
import { retrieve } from './local/retrieve.js'
import { getAttachmentLocation } from './local/attachment-location.js'
import { exportItems } from './local/export-domain.js'
import { changes } from './local/changes-domain.js'
import { runBrowse } from './local/browse-domain.js'
import type {
  SupportedLocalLibrary,
  ZoteroAttachmentLocation,
  ZoteroBrowseRequest,
  ZoteroBrowseResult,
  ZoteroCapability,
  ZoteroChangedObject,
  ZoteroChangesInclude,
  ZoteroChangesRequest,
  ZoteroChangesResult,
  ZoteroChildrenRequest,
  ZoteroChildrenResult,
  ZoteroCollectionInfo,
  ZoteroCreatorTypeInfo,
  ZoteroItemFieldInfo,
  ZoteroCoverage,
  ZoteroEvidence,
  ZoteroEvidenceSource,
  ZoteroExportFormat,
  ZoteroExportItem,
  ZoteroExportRequest,
  ZoteroExportResult,
  ZoteroFulltextPayload,
  ZoteroGetRequest,
  ZoteroInclude,
  ZoteroItemDetail,
  ZoteroLibraryInfo,
  ZoteroObjectRef,
  ZoteroProvider,
  ZoteroResolvedScope,
  ZoteroRetrieveRequest,
  ZoteroRetrieveResult,
  ZoteroSearchItem,
  ZoteroSearchRequest,
  ZoteroSearchResult,
  ZoteroSearchScope,
  ZoteroSearchSupplement,
  ZoteroStatus,
} from './types.js'

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
    return runSearch({ client: this.client, limits: this.limits }, this.directory, request, signal)
  }

  /**
   * Diff the library against a local transaction version. The domain logic
   * lives in `local/changes-domain`; this is the seam.
   */
  async changes(request: ZoteroChangesRequest, signal?: AbortSignal): Promise<ZoteroChangesResult> {
    return changes({ client: this.client, limits: this.limits }, request, signal)
  }

  /**
   * Read one item's metadata plus optionally requested child content. The
   * domain logic lives in `local/detail`; this is the provider seam.
   */
  async getItem(request: ZoteroGetRequest, signal?: AbortSignal): Promise<ZoteroItemDetail> {
    return getItem({ client: this.client, limits: this.limits }, this.directory, request, signal)
  }

  /**
   * Explore one item's or attachment's child-object graph. The domain logic
   * lives in `local/detail`; this is the provider seam.
   */
  async children(
    request: ZoteroChildrenRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroChildrenResult> {
    return children({ client: this.client, limits: this.limits }, request, signal)
  }

  /**
   * Resolve an item or attachment ref to a usable location. The domain
   * logic lives in `local/attachment-location`; this is the seam.
   */
  async getAttachmentLocation(
    ref: ZoteroObjectRef,
    signal?: AbortSignal,
  ): Promise<ZoteroAttachmentLocation> {
    return getAttachmentLocation({ client: this.client, limits: this.limits }, ref, signal)
  }

  /**
   * Gather ranked evidence passages for one item across the requested
   * sources. The domain logic lives in `local/retrieve`; this is the seam.
   */
  async retrieve(
    request: ZoteroRetrieveRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroRetrieveResult> {
    return retrieve({ client: this.client, limits: this.limits }, request, signal)
  }

  /**
   * Export citations or formatted output for the requested items. The
   * domain logic lives in `local/export-domain`; this is the seam.
   */
  async export(request: ZoteroExportRequest, signal?: AbortSignal): Promise<ZoteroExportResult> {
    return exportItems({ client: this.client, limits: this.limits }, request, signal)
  }

  /**
   * Discover libraries, collections, saved searches, tags, item types, and
   * metadata fields. The domain logic lives in `local/browse-domain`; this
   * is the seam.
   */
  async browse(request: ZoteroBrowseRequest, signal?: AbortSignal): Promise<ZoteroBrowseResult> {
    return runBrowse({ client: this.client, limits: this.limits }, this.directory, request, signal)
  }
}
