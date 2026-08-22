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

/** The resource kinds a full `zotero_changes` diff covers, in request order. */
const ZOTERO_CHANGES_INCLUDES: readonly ZoteroChangesInclude[] = [
  'items',
  'collections',
  'savedSearches',
  'fulltext',
  'deleted',
]

/**
 * Parse a location the Local API reported for an attachment and require one
 * of the allowed protocols. Malformed text, relative paths, and exotic
 * schemes fail the call instead of leaking an unopenable location into tool
 * output; the failure message names the allowed protocols so the model can
 * act on the boundary.
 * @throws {ZoteroError} `ZOTERO_NO_ATTACHMENT` when the value is not a usable location.
 */
function parseAttachmentLocation(
  raw: string,
  allowedProtocols: readonly string[],
  parseFailureMessage: string,
): URL {
  let target: URL
  try {
    target = new URL(raw)
  } catch (error) {
    throw new ZoteroError(parseFailureMessage, ZOTERO_NO_ATTACHMENT, { cause: error })
  }
  if (!allowedProtocols.includes(target.protocol)) {
    throw new ZoteroError(
      `Zotero reported an attachment location with unsupported protocol ${target.protocol}; only ${allowedProtocols
        .map((protocol) => protocol.slice(0, -1))
        .join(', ')} locations are usable.`,
      ZOTERO_NO_ATTACHMENT,
    )
  }
  return target
}

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
   * Diff the library against a local transaction version. Zotero 10+ versions
   * are local transactions: any edit, sync, or local-API write advances them,
   * so `?since=` answers "what changed here" without the cloud and without a
   * background watcher. Without `since` this is a baseline reading — just the
   * current version for the next call to diff from. `format=versions`
   * responses are key→version maps; `/deleted` returns tombstone key lists.
   * Each resource is capped at `maxBrowseResults` entries with an honest
   * `truncated` flag driven by the Total-Results header.
   */
  async changes(request: ZoteroChangesRequest, signal?: AbortSignal): Promise<ZoteroChangesResult> {
    const library = request.library ?? PERSONAL_LIBRARY
    const prefix = libraryPrefix(library)
    const cap = this.limits.maxBrowseResults ?? 50
    const include = request.include ?? new Set(ZOTERO_CHANGES_INCLUDES)
    let serverId: string | undefined
    let toVersion: number | undefined

    /**
     * A diff resource this Zotero build does not serve (some local-API
     * versions 404 on `/deleted`, for example) contributes nothing instead
     * of failing the whole read — degradation matches the plugin's honest-
     * absence contract everywhere else.
     */
    const optional = async <T>(run: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await run()
      } catch (error) {
        if (error instanceof ZoteroError && error.code === ZOTERO_NOT_FOUND) return undefined
        throw error
      }
    }

    if (request.since === undefined) {
      const baseline = await optional(async () => {
        const baselineParams = new URLSearchParams()
        baselineParams.set('limit', '1')
        return await this.client.get(`${prefix}/items/top`, baselineParams, {
          signal,
        })
      })
      // A library that cannot serve versioned items at all has no changes
      // story; the baseline reading reports an unknown version.
      if (baseline === undefined) {
        return { library, changed: {} }
      }
      serverId = baseline.headers.get('zotero-server-id') ?? undefined
      const lastModified = baseline.headers.get('last-modified-version')
      toVersion =
        lastModified !== null && /^\d+$/.test(lastModified) ? Number(lastModified) : undefined
      return {
        library,
        ...(serverId !== undefined ? { serverId } : {}),
        ...(toVersion !== undefined ? { toVersion } : {}),
        changed: {},
      }
    }

    const fetchVersions = async (
      path: string,
    ): Promise<{ entries: ZoteroChangedObject[]; truncated: boolean }> => {
      const params = new URLSearchParams()
      params.set('since', String(request.since))
      params.set('format', 'versions')
      params.set('limit', String(cap))
      const { json, headers } = await this.client.getJson<unknown>(path, params, { signal })
      serverId = serverId ?? headers.get('zotero-server-id') ?? undefined
      const lastModified = headers.get('last-modified-version')
      if (lastModified !== null && /^\d+$/.test(lastModified)) {
        toVersion = Math.max(toVersion ?? 0, Number(lastModified))
      }
      const map = asRecord(json)
      const entries = Object.entries(map ?? {})
        .filter(([key, version]) => isObjectKey(key) && typeof version === 'number')
        .map(([key, version]) => ({ key, version: version as number }))
        .sort((a, b) => b.version - a.version || a.key.localeCompare(b.key))
      const total = requireTotalResults(headers, 'versions listing')
      return { entries, truncated: total > entries.length }
    }

    const changed: {
      items?: ZoteroChangedObject[]
      collections?: ZoteroChangedObject[]
      savedSearches?: ZoteroChangedObject[]
      fulltextAttachments?: ZoteroChangedObject[]
    } = {}
    const deleted: {
      items?: string[]
      collections?: string[]
      savedSearches?: string[]
    } = {}
    let truncated = false
    if (include.has('items')) {
      const result = await optional(() => fetchVersions(`${prefix}/items/top`))
      if (result !== undefined) {
        changed.items = result.entries
        truncated = truncated || result.truncated
      }
    }
    if (include.has('collections')) {
      const result = await optional(() => fetchVersions(`${prefix}/collections`))
      if (result !== undefined) {
        changed.collections = result.entries
        truncated = truncated || result.truncated
      }
    }
    if (include.has('savedSearches')) {
      const result = await optional(() => fetchVersions(`${prefix}/searches`))
      if (result !== undefined) {
        changed.savedSearches = result.entries
        truncated = truncated || result.truncated
      }
    }
    if (include.has('fulltext')) {
      // The fulltext delta has its own endpoint and reports attachment keys.
      const result = await optional(() => fetchVersions(`${prefix}/fulltext`))
      if (result !== undefined) {
        changed.fulltextAttachments = result.entries
        truncated = truncated || result.truncated
      }
    }
    if (include.has('deleted')) {
      const payload = await optional(async () => {
        const params = new URLSearchParams()
        params.set('since', String(request.since))
        return await this.client.getJson<unknown>(`${prefix}/deleted`, params, {
          signal,
        })
      })
      if (payload !== undefined) {
        serverId = serverId ?? payload.headers.get('zotero-server-id') ?? undefined
        const record = asRecord(payload.json)
        const keysOf = (field: string): string[] =>
          (Array.isArray(record?.[field]) ? (record![field] as unknown[]) : []).filter(
            (key): key is string => typeof key === 'string' && isObjectKey(key),
          )
        deleted.items = keysOf('items')
        deleted.collections = keysOf('collections')
        deleted.savedSearches = keysOf('searches')
      }
    }

    return {
      library,
      ...(serverId !== undefined ? { serverId } : {}),
      fromVersion: request.since,
      ...(toVersion !== undefined ? { toVersion } : {}),
      changed,
      ...((deleted.items?.length ?? 0) > 0 ||
      (deleted.collections?.length ?? 0) > 0 ||
      (deleted.savedSearches?.length ?? 0) > 0
        ? { deleted }
        : {}),
      ...(truncated ? { truncated } : {}),
    }
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
   * Resolve an item or attachment ref to a usable location. An item ref
   * follows Zotero's own best-attachment link first and falls back to the
   * earliest PDF child, so callers do not need the attachment's key when
   * one attachment is enough. Linked-URL attachments carry their target in
   * `data.url` (their `/file/view/url` endpoint rejects non-file
   * attachments); file attachments resolve through `/file/view/url` and
   * are stat'ed so a missing file fails with a typed error instead of a
   * dead path.
   */
  async getAttachmentLocation(
    ref: ZoteroObjectRef,
    signal?: AbortSignal,
  ): Promise<ZoteroAttachmentLocation> {
    const local = requireSupportedLocalRef(ref, ['item', 'attachment'])
    const attachmentKey = await this.resolveAttachmentKey(local, signal)
    const prefix = libraryPrefix(local.library as SupportedLocalLibrary)
    const item = await this.client.getJson<unknown>(`${prefix}/items/${attachmentKey}`, undefined, {
      signal,
      serverId: local.serverId,
    })
    const data = asRecord(asRecord(item.json)?.data)
    const itemType = asString(data?.itemType)
    if (itemType !== undefined && itemType !== 'attachment') {
      throw new ZoteroError(
        `The referenced object is a ${itemType}, not an attachment.`,
        ZOTERO_NO_ATTACHMENT,
      )
    }
    const attachment = normalizeAttachmentRecord(item.json)
    const serverId = item.headers.get('zotero-server-id') ?? local.serverId
    const formattedRef = formatRef(
      refForLibrary(local.library as SupportedLocalLibrary, 'attachment', attachment.key, serverId),
    )
    const title = attachment.title
    const contentType = attachment.contentType
    if (attachment.linkMode === 'linked_url') {
      if (attachment.url === undefined || attachment.url === '') {
        throw new ZoteroError(
          `Attachment ${attachmentKey} is linked to a URL but Zotero reported none.`,
          ZOTERO_NO_ATTACHMENT,
        )
      }
      const target = parseAttachmentLocation(
        attachment.url,
        ['http:', 'https:'],
        `Attachment ${attachmentKey} is linked to a URL that is not a usable web location.`,
      )
      return { ref: formattedRef, title, contentType, kind: 'url', url: target.toString() }
    }
    const file = await this.client.get(
      `${prefix}/items/${attachmentKey}/file/view/url`,
      undefined,
      {
        signal,
        serverId: local.serverId,
      },
    )
    const target = parseAttachmentLocation(
      file.body.trim(),
      ['file:', 'http:', 'https:'],
      `Zotero reported no usable file location for attachment ${attachmentKey}.`,
    )
    if (target.protocol === 'file:') {
      const path = fileURLToPath(target)
      if (!existsSync(path)) {
        throw new ZoteroError(
          `The attachment file is missing from disk: ${path}`,
          ZOTERO_FILE_MISSING,
        )
      }
      return { ref: formattedRef, title, contentType, kind: 'file', path }
    }
    return { ref: formattedRef, title, contentType, kind: 'url', url: target.toString() }
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
   * Export the requested items through the Local API's format pipeline:
   * `include=citation` pairs each item with its HTML citation (batched to the
   * API's itemKey cap when the request is larger), `format=bib` yields a
   * joined CSL-sorted bibliography, and the translator formats
   * (`bibtex`/`biblatex`/`ris`/`csljson`) export the whole set at once. The
   * batch-breaking formats refuse to exceed `ZOTERO_ITEMKEY_BATCH` — their
   * global ordering belongs to Zotero, so splitting them would silently
   * reorder the output. The translator formats additionally itemize each
   * document by requesting it on its own — through a bounded parallel pool,
   * one request per unique key, in the requested ref order — because the
   * merged body's entry order is Zotero's own and cannot be indexed against
   * the refs. Output that exceeds `maxExportChars` fails with
   * OUTPUT_TOO_LARGE — export text is never mid-truncated.
   */
  async export(request: ZoteroExportRequest, signal?: AbortSignal): Promise<ZoteroExportResult> {
    for (const ref of request.refs) requireSupportedLocalRef(ref, ['item'])
    // Export is single-library (v3 lock): all refs must share the same SupportedLocalLibrary
    const firstLibrary = request.refs[0]?.library as SupportedLocalLibrary | undefined
    if (firstLibrary !== undefined) {
      for (const ref of request.refs.slice(1)) {
        if (!sameLibrary(firstLibrary, ref.library as SupportedLocalLibrary)) {
          throw new ZoteroError(
            'All refs in one export must belong to the same library (personal or a single group). Split by library.',
            ZOTERO_INVALID_ARGUMENT,
          )
        }
      }
    }
    // Every ref must come from the same Zotero instance: the request header
    // carries one identity, and a ref from another instance must fail closed
    // instead of silently resolving same-key objects there.
    const serverIds = new Set(
      request.refs.map((ref) => ref.serverId).filter((id): id is string => id !== undefined),
    )
    if (serverIds.size > 1) throw new ZoteroError(SERVER_MISMATCH_MESSAGE, ZOTERO_SERVER_MISMATCH)
    const serverId = serverIds.size === 1 ? serverIds.values().next().value : undefined
    const exportLibrary: SupportedLocalLibrary = (firstLibrary ??
      PERSONAL_LIBRARY) as SupportedLocalLibrary
    const exportPrefix = libraryPrefix(exportLibrary)
    const style = request.style ?? this.limits.defaultStyle
    const locale = request.locale ?? this.limits.defaultLocale
    if (request.format === 'citation') {
      return await this.exportCitations(request.refs, exportPrefix, serverId, style, locale, signal)
    }
    // Duplicate refs name the same item; the translator formats fetch each
    // document on its own, so every unique key is requested once, keeping
    // the first-seen order. Dedupe by canonical ref (library+key), not bare key.
    const seen = new Set<string>()
    const refs: ZoteroObjectRef[] = []
    for (const ref of request.refs) {
      const canonical = `${ref.library.type}:${ref.library.id}:${ref.key}`
      if (seen.has(canonical)) continue
      seen.add(canonical)
      refs.push(ref)
    }
    if (refs.length > ZOTERO_ITEMKEY_BATCH) {
      throw new ZoteroError(
        `The ${request.format} format accepts at most ${ZOTERO_ITEMKEY_BATCH} item refs per call (Zotero's itemKey request cap, which also keeps the format's global ordering intact). Request up to ${ZOTERO_ITEMKEY_BATCH} refs at a time, or use citation, which batches up to the configured export cap.`,
        ZOTERO_INVALID_ARGUMENT,
      )
    }
    const search = new URLSearchParams()
    search.set('itemKey', refs.map((ref) => ref.key).join(','))
    if (request.format === 'bibliography') {
      search.set('format', 'bib')
      search.set('style', style)
      search.set('locale', locale)
    } else {
      search.set('format', request.format)
    }
    const { body } = await this.client.get(`${exportPrefix}/items`, search, { signal, serverId })
    if (body.length > this.limits.maxExportChars) {
      throw new ZoteroError(
        `Export output of ${body.length} characters exceeds the ${this.limits.maxExportChars}-character export limit.`,
        ZOTERO_OUTPUT_TOO_LARGE,
      )
    }
    if (request.format === 'bibliography') {
      return { format: 'bibliography', style, locale, text: body }
    }
    // The browser holds `text` with its leading whitespace trimmed (the
    // render strips it), so the entry offsets are measured on that same
    // trimmed body.
    const items = await this.fetchExportItems(
      refs,
      request.format,
      body.trimStart(),
      exportPrefix,
      serverId,
      signal,
    )
    return { format: request.format, text: body, items }
  }

  /**
   * One single-item export per unique ref, in the requested order, paired
   * with its batch entry. The merged body's entry order belongs to Zotero,
   * so each document is requested on its own — through a bounded parallel
   * pool, so a full export cannot storm the local API — and matched to the
   * batch body server-side. The single-item bodies share the batch body's
   * output budget, and a missing or empty entry fails the whole call — the
   * same closed contract as the citation arm, instead of the batch body
   * silently omitting the item. Caller cancellation reaches every request
   * through the HTTP layer's fused signal.
   */
  private async fetchExportItems(
    refs: readonly ZoteroObjectRef[],
    format: ZoteroExportFormat,
    text: string,
    prefix: string,
    serverId: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<ZoteroExportItem[]> {
    let totalChars = 0
    const inputs = await mapWithConcurrency(refs, ZOTERO_EXPORT_CONCURRENCY, async (ref) => {
      const search = new URLSearchParams()
      search.set('itemKey', ref.key)
      search.set('format', format)
      const { body } = await this.client.get(`${prefix}/items`, search, { signal, serverId })
      if (body === '') {
        throw new ZoteroError(
          `Zotero did not return an item for ${formatRef(ref)}.`,
          ZOTERO_NOT_FOUND,
        )
      }
      totalChars += body.length
      if (totalChars > this.limits.maxExportChars) {
        throw new ZoteroError(
          `Per-document export output of ${totalChars} characters exceeds the ${this.limits.maxExportChars}-character export limit.`,
          ZOTERO_OUTPUT_TOO_LARGE,
        )
      }
      return { ref: formatRef(ref), key: ref.key, text: body }
    })
    return locateExportItems(format, text, inputs)
  }

  /**
   * Citation export: batches the refs into API-sized requests, merges the
   * per-key citations, and reorders them to the requested sequence. Order is
   * exact — each citation stays paired with its ref — so batching is
   * invisible to the caller.
   */
  private async exportCitations(
    refs: readonly ZoteroObjectRef[],
    prefix: string,
    serverId: string | undefined,
    style: string,
    locale: string,
    signal: AbortSignal | undefined,
  ): Promise<ZoteroExportResult> {
    const citationByKey = new Map<string, string>()
    for (let start = 0; start < refs.length; start += ZOTERO_ITEMKEY_BATCH) {
      const batch = refs.slice(start, start + ZOTERO_ITEMKEY_BATCH)
      const batchCitations = await this.fetchCitationBatch(
        batch,
        prefix,
        serverId,
        style,
        locale,
        signal,
      )
      for (const [key, text] of batchCitations) citationByKey.set(key, text)
    }
    const citations = refs.map((ref) => {
      const text = citationByKey.get(ref.key)
      if (text === undefined) {
        throw new ZoteroError(
          `Zotero did not return an item for ${formatRef(ref)}.`,
          ZOTERO_NOT_FOUND,
        )
      }
      return { ref: formatRef(ref), text }
    })
    const totalChars = citations.reduce((sum, entry) => sum + entry.text.length, 0)
    if (totalChars > this.limits.maxExportChars) {
      throw new ZoteroError(
        `Citation output of ${totalChars} characters exceeds the ${this.limits.maxExportChars}-character export limit.`,
        ZOTERO_OUTPUT_TOO_LARGE,
      )
    }
    return { format: 'citation', style, locale, citations }
  }

  /** One batch of per-key citations — at most `ZOTERO_ITEMKEY_BATCH` keys. */
  private async fetchCitationBatch(
    batch: readonly ZoteroObjectRef[],
    prefix: string,
    serverId: string | undefined,
    style: string,
    locale: string,
    signal: AbortSignal | undefined,
  ): Promise<Map<string, string>> {
    const search = new URLSearchParams()
    search.set('itemKey', batch.map((ref) => ref.key).join(','))
    search.set('include', 'citation')
    search.set('style', style)
    search.set('locale', locale)
    const { json } = await this.client.getJson<unknown>(`${prefix}/items`, search, {
      signal,
      serverId,
    })
    const citationByKey = new Map<string, string>()
    for (const row of Array.isArray(json) ? json : []) {
      const record = asRecord(row)
      const key = asString(record?.key)
      if (key === undefined || !isObjectKey(key)) {
        throw new ZoteroError(
          'Zotero returned an item without a valid object key.',
          ZOTERO_UNEXPECTED,
        )
      }
      citationByKey.set(key, asString(record?.citation) ?? '')
    }
    return citationByKey
  }

  /**
   * Pick the attachment key an item ref resolves to: Zotero's own
   * `links.attachment` choice when present, otherwise the earliest PDF
   * child from a lazy `/children` fetch.
   * @throws {ZoteroError} `ZOTERO_NO_ATTACHMENT` when the item has none.
   */
  private async resolveAttachmentKey(ref: ZoteroObjectRef, signal?: AbortSignal): Promise<string> {
    if (ref.kind === 'attachment') return ref.key
    const prefix = libraryPrefix(ref.library as SupportedLocalLibrary)
    const parent = await this.client.getJson<unknown>(`${prefix}/items/${ref.key}`, undefined, {
      signal,
      serverId: ref.serverId,
    })
    const link = bestAttachmentFromLinks(parent.json)
    if (link !== undefined) return link.key
    const children = await this.client.getJson<unknown>(
      `${prefix}/items/${ref.key}/children`,
      undefined,
      {
        signal,
        serverId: ref.serverId,
      },
    )
    const pdf = selectAttachments(Array.isArray(children.json) ? children.json : [], 'pdf')[0]
    if (pdf === undefined) {
      throw new ZoteroError(`Item ${ref.key} has no attachment to resolve.`, ZOTERO_NO_ATTACHMENT)
    }
    return pdf.key
  }

  // ---- browse (Phase C) ----

  async browse(request: ZoteroBrowseRequest, signal?: AbortSignal): Promise<ZoteroBrowseResult> {
    const maxBrowse = this.limits.maxBrowseResults ?? 50
    if (!Number.isInteger(request.offset) || request.offset < 0) {
      throw new ZoteroError('offset must be a non-negative integer', ZOTERO_INVALID_ARGUMENT)
    }
    if (!Number.isInteger(request.limit) || request.limit <= 0 || request.limit > maxBrowse) {
      throw new ZoteroError(`limit must be integer 1..${maxBrowse}`, ZOTERO_INVALID_ARGUMENT)
    }
    // Fail-closed: libraries/itemTypes/itemFields are global, so the library
    // parameter must not be set for them.
    if (
      (request.kind === 'libraries' ||
        request.kind === 'itemTypes' ||
        request.kind === 'itemFields') &&
      request.library !== undefined
    ) {
      throw new ZoteroError(
        `library is not allowed for kind ${request.kind}; omit library for libraries/itemTypes/itemFields`,
        ZOTERO_INVALID_ARGUMENT,
      )
    }
    if (
      (request.kind === 'libraries' ||
        request.kind === 'itemTypes' ||
        request.kind === 'collections' ||
        request.kind === 'savedSearches' ||
        request.kind === 'tags') &&
      request.itemType !== undefined
    ) {
      throw new ZoteroError(
        `itemType is only valid when kind="itemFields"`,
        ZOTERO_INVALID_ARGUMENT,
      )
    }
    if (request.kind === 'itemFields') {
      if (request.itemType === undefined || !/^[A-Za-z][A-Za-z0-9]*$/.test(request.itemType)) {
        throw new ZoteroError(
          'kind="itemFields" requires a Zotero item type name (e.g. dataset, journalArticle)',
          ZOTERO_INVALID_ARGUMENT,
        )
      }
      return await this.browseItemFields(request, signal)
    }
    if ((request.q !== undefined || request.match !== undefined) && request.kind !== 'tags') {
      throw new ZoteroError('q/match are only valid when kind="tags"', ZOTERO_INVALID_ARGUMENT)
    }
    if (request.parentRef !== undefined && request.kind !== 'collections') {
      throw new ZoteroError(
        'parentRef is only valid when kind="collections"',
        ZOTERO_INVALID_ARGUMENT,
      )
    }
    if (
      (request.scope !== undefined ||
        request.itemLevel !== undefined ||
        request.itemQuery !== undefined ||
        request.itemQueryMode !== undefined) &&
      request.kind !== 'tags'
    ) {
      throw new ZoteroError(
        'scope/itemLevel/itemQuery are only valid when kind="tags"',
        ZOTERO_INVALID_ARGUMENT,
      )
    }
    if (request.scope === undefined) {
      if (request.itemLevel !== undefined || request.itemQuery !== undefined) {
        throw new ZoteroError(
          'itemLevel/itemQuery require a scope (library, collection, or publications)',
          ZOTERO_INVALID_ARGUMENT,
        )
      }
    } else if (request.scope.kind === 'collection' && !isRefString(request.scope.refOrName)) {
      // Name resolution happens in browseTags via resolveNamed; nothing to
      // check here beyond non-emptiness.
      if (request.scope.refOrName.trim() === '') {
        throw new ZoteroError('scope.refOrName must be a non-empty string', ZOTERO_INVALID_ARGUMENT)
      }
    }
    switch (request.kind) {
      case 'libraries':
        return await this.browseLibraries(request, signal)
      case 'collections':
        return await this.browseCollections(request, signal)
      case 'savedSearches':
        return await this.browseSavedSearches(request, signal)
      case 'tags':
        return await this.browseTags(request, signal)
      case 'itemTypes':
        return await this.browseItemTypes(request, signal)
      default:
        throw new ZoteroError(
          `Unsupported browse kind ${(request as { kind: string }).kind}`,
          ZOTERO_INVALID_ARGUMENT,
        )
    }
  }

  private async browseLibraries(
    request: ZoteroBrowseRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroBrowseResult> {
    let serverId: string | undefined
    const items: ZoteroLibraryInfo[] = []
    // personal always present
    items.push({ library: PERSONAL_LIBRARY, name: 'My Library' })
    // try to discover groups; Zotero 7/8/9 may 404
    try {
      const { json, headers } = await this.client.getJson<unknown>(
        PERSONAL_GROUPS_DISCOVERY,
        undefined,
        {
          signal,
        },
      )
      serverId = headers.get('zotero-server-id') ?? undefined
      const groups = Array.isArray(json) ? json : []
      for (const row of groups) {
        const rec = asRecord(row)
        const idRaw = rec?.id ?? rec?.groupID ?? asRecord(rec?.data)?.groupID
        const nameRaw =
          asString(rec?.name) ??
          asString(asRecord(rec?.data)?.name) ??
          asString(rec?.groupName) ??
          ''
        const id =
          typeof idRaw === 'number' ? idRaw : typeof idRaw === 'string' ? Number(idRaw) : undefined
        if (id === undefined || !Number.isInteger(id) || id <= 0) continue
        const name = nameRaw || `Group ${id}`
        items.push({ library: { type: 'group', id }, name })
      }
      if (headers.get('zotero-server-id')) serverId = headers.get('zotero-server-id') ?? serverId
    } catch (error) {
      if (isNotFoundError(error)) {
        // older Zotero without groups listing: just personal
      } else {
        throw error
      }
    }
    const total = items.length
    const slice = items.slice(request.offset, request.offset + request.limit)
    const next = nextOffsetOf(request.offset, slice.length, total)
    return {
      kind: 'libraries',
      ...(serverId ? { serverId } : {}),
      items: slice,
      total,
      offset: request.offset,
      returned: slice.length,
      ...(next !== undefined ? { nextOffset: next } : {}),
    }
  }

  /**
   * Browse collections as real tree navigation: no `parentRef` lists
   * top-level collections (`/collections/top`), a `parentRef` lists that
   * collection's children — both server-side paged, so a page never depends
   * on the whole library graph. Breadcrumbs resolve lazily: each row's own
   * `parentCollection` field drives a per-key ancestor walk (TTL-cached,
   * cycle-guarded), and an ancestor the API cannot serve truncates the path
   * fail-closed instead of inventing one.
   */
  private async browseCollections(
    request: ZoteroBrowseRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroBrowseResult> {
    const library: SupportedLocalLibrary = request.library ?? PERSONAL_LIBRARY
    const prefix = libraryPrefix(library)
    let listPath = `${prefix}/collections/top`
    if (request.parentRef !== undefined) {
      const parentRef = requireSupportedLocalRef(parseRef(request.parentRef), ['collection'])
      if (!sameLibrary(parentRef.library as SupportedLocalLibrary, library)) {
        throw new ZoteroError(
          `Library mismatch: parentRef is ${parentRef.library.type}/${parentRef.library.id} but request library is ${library.type}/${library.id}.`,
          ZOTERO_INVALID_ARGUMENT,
        )
      }
      listPath = `${prefix}/collections/${parentRef.key}/collections`
    }
    const params = new URLSearchParams()
    params.set('start', String(request.offset))
    params.set('limit', String(request.limit))
    const { json, headers } = await this.client.getJson<unknown>(listPath, params, { signal })
    const serverId = headers.get('zotero-server-id') ?? undefined
    const total = requireTotalResults(headers, 'collections')
    const items: ZoteroCollectionInfo[] = []
    for (const row of Array.isArray(json) ? json : []) {
      const entry = normalizeScopeEntry(row)
      const ancestors = await this.directory.collectionAncestorNames(
        library,
        entry.key,
        entry.parentKey,
        serverId,
        signal,
      )
      const path = [...ancestors, entry.name]
      items.push({
        ref: formatRef(refForLibrary(library, 'collection', entry.key, serverId)),
        name: entry.name,
        ...(entry.parentKey !== undefined
          ? {
              parentRef: formatRef(refForLibrary(library, 'collection', entry.parentKey, serverId)),
            }
          : {}),
        path,
        depth: path.length - 1,
      })
    }
    // A page-local sort keeps output deterministic without re-sorting the
    // library; ordering across pages belongs to Zotero.
    items.sort((a, b) => a.name.localeCompare(b.name))
    const next = nextOffsetOf(request.offset, items.length, total)
    return {
      kind: 'collections',
      library,
      ...(serverId ? { serverId } : {}),
      items,
      total,
      offset: request.offset,
      returned: items.length,
      ...(next !== undefined ? { nextOffset: next } : {}),
    }
  }

  private async browseSavedSearches(
    request: ZoteroBrowseRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroBrowseResult> {
    const library: SupportedLocalLibrary = request.library ?? PERSONAL_LIBRARY
    const prefix = libraryPrefix(library)
    // Browsing pages server-side and reads only its own window; scope-name
    // resolution keeps the full-listing path under the TTL cache. The two
    // acquisition strategies stay separate so a browse page never has to
    // fetch the whole library just to show `limit` rows.
    const params = new URLSearchParams()
    params.set('start', String(request.offset))
    params.set('limit', String(request.limit))
    const { json, headers } = await this.client.getJson<unknown>(`${prefix}/searches`, params, {
      signal,
    })
    const serverId = headers.get('zotero-server-id') ?? undefined
    const rawRows = Array.isArray(json) ? json : []
    const total = requireTotalResults(headers, 'saved searches')
    const entries: ScopeNameEntry[] = rawRows.map((row) => normalizeScopeEntry(row))
    const condByKey = new Map<string, unknown>()
    for (const row of rawRows) {
      const rec = asRecord(row)
      const key = asString(rec?.key)
      if (key === undefined || !isObjectKey(key)) continue
      const data = asRecord(rec?.data)
      const cond = data?.conditions ?? (rec as Record<string, unknown>)?.conditions
      if (cond !== undefined) condByKey.set(key, cond)
    }
    const items = entries
      .map((entry) => ({
        ref: formatRef(refForLibrary(library, 'search', entry.key, serverId)),
        name: entry.name,
        ...(condByKey.has(entry.key) ? { conditions: condByKey.get(entry.key) } : {}),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    const next = nextOffsetOf(request.offset, items.length, total)
    return {
      kind: 'savedSearches',
      library,
      ...(serverId ? { serverId } : {}),
      items,
      total,
      offset: request.offset,
      returned: items.length,
      ...(next !== undefined ? { nextOffset: next } : {}),
    }
  }

  /**
   * Browse tags, optionally scoped: without a scope this is the
   * whole-library `/tags` listing; with a scope the scoped tag endpoints
   * count tags over a faceted item set — a collection or My Publications,
   * top-level by default or all items, optionally narrowed to items matching
   * an item query. That makes "search → which tags do these hits carry →
   * narrow" a server-side round trip instead of client-side guessing.
   */
  private async browseTags(
    request: ZoteroBrowseRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroBrowseResult> {
    const library: SupportedLocalLibrary = request.library ?? PERSONAL_LIBRARY
    const prefix = libraryPrefix(library)
    const itemsSegment = request.itemLevel === 'all' ? 'items' : 'items/top'
    let path = `${prefix}/tags`
    let serverIdClaim: string | undefined
    if (request.scope !== undefined) {
      switch (request.scope.kind) {
        case 'library':
          path = `${prefix}/${itemsSegment}/tags`
          break
        case 'publications':
          path = `${prefix}/publications/${itemsSegment}/tags`
          break
        case 'collection': {
          const found = await this.directory.resolveNamed(
            'collection',
            request.scope.refOrName,
            library,
            signal,
          )
          serverIdClaim = found.ref.serverId
          path = `${libraryPrefix(found.ref.library as SupportedLocalLibrary)}/collections/${found.ref.key}/${itemsSegment}/tags`
          break
        }
      }
    }
    const params = new URLSearchParams()
    if (request.q !== undefined && request.q !== '') {
      params.set('q', request.q)
      params.set('qmode', request.match === 'startsWith' ? 'startsWith' : 'contains')
    }
    if (request.itemQuery !== undefined && request.itemQuery !== '') {
      params.set('itemQ', request.itemQuery)
      params.set('itemQMode', request.itemQueryMode ?? 'titleCreatorYear')
    }
    params.set('start', String(request.offset))
    params.set('limit', String(request.limit))
    const { json, headers } = await this.client.getJson<unknown>(path, params, {
      signal,
      ...(serverIdClaim !== undefined ? { serverId: serverIdClaim } : {}),
    })
    const serverId = headers.get('zotero-server-id') ?? serverIdClaim
    const rawRows = Array.isArray(json) ? json : []
    const total = requireTotalResults(headers, 'tags')
    const items = rawRows
      .map((row) => {
        const rec = asRecord(row)
        const tag = asString(rec?.tag) ?? asString(asRecord(rec?.data)?.tag)
        if (tag === undefined) return null
        const metaCount = asRecord(rec?.meta)?.numItems
        const directCount = rec?.numItems
        const count =
          typeof metaCount === 'number'
            ? metaCount
            : typeof directCount === 'number'
              ? directCount
              : undefined
        return { tag, ...(count !== undefined ? { count } : {}) }
      })
      .filter((x): x is { tag: string; count?: number } => x !== null)
    const next = nextOffsetOf(request.offset, items.length, total)
    return {
      kind: 'tags',
      library,
      ...(serverId ? { serverId } : {}),
      items,
      total,
      offset: request.offset,
      returned: items.length,
      ...(next !== undefined ? { nextOffset: next } : {}),
    }
  }

  private async browseItemTypes(
    request: ZoteroBrowseRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroBrowseResult> {
    const { json, headers } = await this.client.getJson<unknown>('itemTypes', undefined, { signal })
    const serverId = headers.get('zotero-server-id') ?? undefined
    let raw: { itemType: string; localized?: string }[] = []
    if (Array.isArray(json)) {
      raw = json
        .map((row) => {
          const rec = asRecord(row)
          const it = asString(rec?.itemType) ?? asString(rec?.name)
          if (it === undefined) return null
          const loc = asString(rec?.localized) ?? asString(rec?.displayName)
          return { itemType: it, ...(loc ? { localized: loc } : {}) }
        })
        .filter((x): x is { itemType: string; localized?: string } => x !== null)
    }
    raw.sort((a, b) => a.itemType.localeCompare(b.itemType))
    const items = raw
    const total = items.length
    const slice = items.slice(request.offset, request.offset + request.limit)
    const next = nextOffsetOf(request.offset, slice.length, total)
    return {
      kind: 'itemTypes',
      ...(serverId ? { serverId } : {}),
      items: slice,
      total,
      offset: request.offset,
      returned: slice.length,
      ...(next !== undefined ? { nextOffset: next } : {}),
    }
  }

  /**
   * The metadata fields and creator types valid for one item type, with the
   * localized labels Zotero reports for the user's locale. This is the
   * schema-aware read behind `fields:"all"`: when a dataset or patent's
   * fields would be dropped by the normalized model, the model can look up
   * what exists and ask for it by name.
   */
  private async browseItemFields(
    request: ZoteroBrowseRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroBrowseResult> {
    const itemType = request.itemType!
    const params = new URLSearchParams()
    params.set('itemType', itemType)
    const [fields, creatorTypes] = await Promise.all([
      this.client.getJson<unknown>('itemTypeFields', params, { signal }),
      this.client.getJson<unknown>('itemTypeCreatorTypes', params, { signal }),
    ])
    const serverId =
      fields.headers.get('zotero-server-id') ??
      creatorTypes.headers.get('zotero-server-id') ??
      undefined
    const localizedOf = (row: unknown): { field?: string; localized?: string } => {
      const rec = asRecord(row)
      return {
        field: asString(rec?.field),
        localized: asString(rec?.localized),
      }
    }
    const items: (ZoteroItemFieldInfo | ZoteroCreatorTypeInfo)[] = []
    for (const row of Array.isArray(fields.json) ? fields.json : []) {
      const { field, localized } = localizedOf(row)
      if (field === undefined) continue
      items.push({ field, ...(localized !== undefined ? { localized } : {}) })
    }
    for (const row of Array.isArray(creatorTypes.json) ? creatorTypes.json : []) {
      const rec = asRecord(row)
      const creatorType = asString(rec?.creatorType)
      if (creatorType === undefined) continue
      const localized = asString(rec?.localized)
      items.push({ creatorType, ...(localized !== undefined ? { localized } : {}) })
    }
    items.sort((a, b) =>
      'field' in a && 'field' in b
        ? a.field.localeCompare(b.field)
        : 'creatorType' in a && 'creatorType' in b
          ? a.creatorType.localeCompare(b.creatorType)
          : 0,
    )
    const total = items.length
    const slice = items.slice(request.offset, request.offset + request.limit)
    const next = nextOffsetOf(request.offset, slice.length, total)
    return {
      kind: 'itemFields',
      ...(serverId ? { serverId } : {}),
      items: slice,
      total,
      offset: request.offset,
      returned: slice.length,
      ...(next !== undefined ? { nextOffset: next } : {}),
    }
  }
}
