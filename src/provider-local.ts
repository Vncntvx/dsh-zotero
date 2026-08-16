/**
 * The `local` provider: the Zotero Local API at `127.0.0.1:23119/api`.
 * Capabilities are declared only for what this provider currently
 * implements, so a capability gate can never route work into a method that
 * does not exist. Search semantics follow the Local API's documented
 * behavior: server-side pagination over `/items/top`, collection and saved
 * search scopes resolved client-side (the Local API has no server-side name
 * search), and literal tag names escaped so they never become query syntax.
 * Zotero's index never covers note bodies, so the first page of a queried
 * search also merges client-side note-content matches (capped by
 * `maxNoteScanRecords`; collection scopes filter by membership).
 * @module dsh-zotero/provider-local
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ZoteroHttpClient } from './http-client.js'
import { LOCAL_PROVIDER_ID } from './constants.js'
import {
  NO_FULLTEXT_MESSAGE,
  isNotFoundError,
  ZOTERO_FILE_MISSING,
  ZOTERO_OUTPUT_TOO_LARGE,
  ZOTERO_NO_ATTACHMENT,
  ZOTERO_UNEXPECTED,
  ZOTERO_NO_FULLTEXT,
  ZOTERO_NOT_FOUND,
  ZOTERO_SCOPE_AMBIGUOUS,
  ZoteroError,
  errorMessageOf,
} from './errors.js'
import { chunkText, rankChunks, tokenize } from './evidence.js'
import { asRecord, asString, isObjectKey } from './json.js'
import {
  collectionKeysOf,
  matchScopeName,
  nearScopeCandidates,
  normalizeItemDetail,
  normalizeScopeEntry,
  normalizeSearchItem,
  partitionChildren,
  plainNoteText,
  truncateText,
  type PartitionedChildren,
  type ScopeNameEntry,
  type ZoteroChildKind,
} from './normalize.js'
import {
  bestAttachmentFromLinks,
  normalizeAttachmentRecord,
  selectAttachment,
} from './attachments.js'
import { formatRef, isRefString, localRef, parseRef, requireLocalRef } from './refs.js'
import type {
  ZoteroAttachmentLocation,
  ZoteroCapability,
  ZoteroCoverage,
  ZoteroEvidence,
  ZoteroEvidenceSource,
  ZoteroExportRequest,
  ZoteroExportResult,
  ZoteroFulltextPayload,
  ZoteroGetRequest,
  ZoteroInclude,
  ZoteroItemDetail,
  ZoteroObjectRef,
  ZoteroProvider,
  ZoteroResolvedScope,
  ZoteroRetrieveRequest,
  ZoteroRetrieveResult,
  ZoteroSearchRequest,
  ZoteroSearchResult,
  ZoteroSearchScope,
  ZoteroStatus,
} from './types.js'

/** Escape a literal tag so a leading `-` never becomes Zotero's NOT syntax. */
export function encodeLiteralTag(tag: string): string {
  return tag.startsWith('-') ? `\\-${tag.slice(1)}` : tag
}

/** Serialize a search request into the Local API's documented query parameters. */
export function buildSearchParams(request: ZoteroSearchRequest): URLSearchParams {
  const params = new URLSearchParams()
  if (request.query !== undefined && request.query !== '') params.set('q', request.query)
  if (request.mode === 'everything') params.set('qmode', 'everything')
  if (request.itemTypes !== undefined && request.itemTypes.length > 0) {
    params.set('itemType', request.itemTypes.join(' || '))
  }
  for (const tag of request.tags ?? []) params.append('tag', encodeLiteralTag(tag))
  params.set('sort', request.sort)
  params.set('direction', request.direction)
  params.set('start', String(request.offset))
  params.set('limit', String(request.limit))
  return params
}

interface ResolvedScopeResult {
  readonly path: string
  readonly resolved: ZoteroResolvedScope
  readonly serverId?: string
  /** The collection key a note must belong to for the body scan; library/search scopes are unset. */
  readonly collectionKey?: string
}

/** A cached full listing of one scope endpoint, with the identity header it was served under. */
interface ScopeListing {
  readonly entries: readonly ScopeNameEntry[]
  readonly serverId?: string
}

/** Deployment-varying bounds the local provider needs beyond the HTTP client limits. */
export interface LocalApiLimits {
  /** Upper bound for note records the search scan fetches for body matches. */
  readonly maxNoteScanRecords: number
  /** Character budget for `zotero_get` abstract previews. */
  readonly maxDetailChars: number
  /** Character budget for a note item's own body returned by `zotero_get`. */
  readonly maxNoteBodyChars: number
  /** Per-note character budget for `zotero_get` note previews. */
  readonly maxNoteChars: number
  /** Upper bound for note records returned by `zotero_get`. */
  readonly maxNoteRecords: number
  /** Upper bound for annotation records returned by `zotero_get`. */
  readonly maxAnnotationRecords: number
  /** Word count of each full-text passage entering evidence ranking. */
  readonly fulltextChunkWords: number
  /** Total character budget for retrieved evidence passages. */
  readonly maxEvidenceChars: number
  /** Upper bound for the number of evidence passages. */
  readonly maxEvidencePassages: number
  /** Character bound for full text accepted into evidence ranking. */
  readonly maxFulltextChars: number
  /** Provider hard limit for export output; never mid-truncated. */
  readonly maxExportChars: number
  /** CSL style for citation/bibliography formats. */
  readonly defaultStyle: string
  /** CSL locale for citation/bibliography formats. */
  readonly defaultLocale: string
}

const INCLUDE_ORDER: readonly ZoteroInclude[] = ['notes', 'annotations', 'attachments']

/**
 * Full-text indexing coverage as reported by Zotero. `complete` requires
 * the server to report both sides of one axis and agree; anything else is
 * an incomplete answer, never a guess.
 */
function normalizeCoverage(payload: ZoteroFulltextPayload): ZoteroCoverage {
  const indexedChars = typeof payload.indexedChars === 'number' ? payload.indexedChars : undefined
  const totalChars = typeof payload.totalChars === 'number' ? payload.totalChars : undefined
  const indexedPages = typeof payload.indexedPages === 'number' ? payload.indexedPages : undefined
  const totalPages = typeof payload.totalPages === 'number' ? payload.totalPages : undefined
  const complete =
    totalChars !== undefined && indexedChars !== undefined && indexedChars === totalChars
  return {
    ...(indexedPages !== undefined ? { indexedPages } : {}),
    ...(totalPages !== undefined ? { totalPages } : {}),
    ...(indexedChars !== undefined ? { indexedChars } : {}),
    ...(totalChars !== undefined ? { totalChars } : {}),
    complete,
  }
}

export class LocalApiProvider implements ZoteroProvider {
  readonly id = LOCAL_PROVIDER_ID
  readonly capabilities: ReadonlySet<ZoteroCapability> = new Set<ZoteroCapability>([
    'metadata',
    'search',
    'attachments',
    'fulltext',
    'citation',
  ])

  constructor(
    private readonly client: ZoteroHttpClient,
    private readonly limits: LocalApiLimits,
  ) {}

  /** Cached full listings of the scope endpoints; the provider instance is the invalidation boundary. */
  private readonly scopeListingCache = new Map<'collections' | 'searches', ScopeListing>()

  /**
   * The cached full listing of one plural endpoint (`collections` or
   * `searches`), fetched once per provider instance. The service rebuilds the
   * provider on every settings commit, which is the cache's invalidation
   * point; a second call reuses the first response, identity header included.
   */
  private async scopeListingOf(
    plural: 'collections' | 'searches',
    serverId: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<ScopeListing> {
    const cached = this.scopeListingCache.get(plural)
    if (cached !== undefined) return cached
    const { json, headers } = await this.client.getJson<unknown>(`users/0/${plural}`, undefined, {
      signal,
      serverId,
    })
    const entries = (Array.isArray(json) ? json : []).map((row) => normalizeScopeEntry(row))
    const servedBy = headers.get('zotero-server-id') ?? serverId
    const listing: ScopeListing =
      servedBy === undefined ? { entries } : { entries, serverId: servedBy }
    this.scopeListingCache.set(plural, listing)
    return listing
  }

  /**
   * Probe `GET /api/` and report connectivity plus the instance identity
   * headers. Health checks live here, not on every tool call.
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
      return {
        providerId: this.id,
        connected: false,
        diagnosis: errorMessageOf(error),
      }
    }
  }

  async search(request: ZoteroSearchRequest, signal?: AbortSignal): Promise<ZoteroSearchResult> {
    const scope = await this.resolveScope(request.scope, signal)
    const { json, headers } = await this.client.getJson<unknown>(
      scope.path,
      buildSearchParams(request),
      {
        signal,
        serverId: scope.serverId,
      },
    )
    const rows = Array.isArray(json) ? json : []
    const responseServerId = headers.get('zotero-server-id') ?? scope.serverId
    const items = rows.map((row) => normalizeSearchItem(row, responseServerId ?? undefined))
    const headerTotal = headers.get('total-results')
    const apiTotal =
      headerTotal !== null && headerTotal !== '' && Number.isInteger(Number(headerTotal))
        ? Number(headerTotal)
        : items.length
    // Zotero's index never searches note bodies, so the first page of a
    // queried search merges client-side note-content matches. Pagination
    // stays API-driven: later pages skip the scan.
    let total = apiTotal
    if (this.shouldScanNotes(request, scope.resolved)) {
      const query = request.query!
      const terms = tokenize(query.toLowerCase())
      const seen = new Set(
        rows
          .map((row) => asString(asRecord(row)?.key))
          .filter((key): key is string => key !== undefined),
      )
      for (const row of await this.fetchNoteRows(scope, signal)) {
        const key = asString(asRecord(row)?.key)
        if (key === undefined || seen.has(key)) continue
        if (!this.noteRowMatches(row, terms, request.tags, scope.collectionKey)) continue
        seen.add(key)
        items.push(normalizeSearchItem(row, responseServerId ?? undefined))
      }
      total = apiTotal + (items.length - rows.length)
    }
    const nextOffset =
      request.offset + rows.length < apiTotal ? request.offset + rows.length : undefined
    // Omit (rather than null) the pagination cursor on the final page, so the
    // result stays a pure lossless-JSON value for the tool output snapshot.
    const result: ZoteroSearchResult = {
      scope: scope.resolved,
      items,
      total,
      offset: request.offset,
      returned: items.length,
    }
    if (nextOffset !== undefined) result.nextOffset = nextOffset
    return result
  }

  /** Whether a search request qualifies for the client-side note-body scan. */
  private shouldScanNotes(request: ZoteroSearchRequest, resolved: ZoteroResolvedScope): boolean {
    const query = request.query?.trim()
    return (
      query !== undefined &&
      query !== '' &&
      request.offset === 0 &&
      resolved.kind !== 'savedSearch' &&
      (request.itemTypes === undefined || request.itemTypes.includes('note'))
    )
  }

  /**
   * Fetch note rows for the body scan in dateModified-descending batches,
   * stopping at `maxNoteScanRecords`. The Local API caps a request at 100
   * rows, so the scan pages until the budget or the end of the notes.
   */
  private async fetchNoteRows(
    scope: ResolvedScopeResult,
    signal: AbortSignal | undefined,
  ): Promise<readonly unknown[]> {
    const out: unknown[] = []
    let start = 0
    while (out.length < this.limits.maxNoteScanRecords) {
      const wanted = Math.min(100, this.limits.maxNoteScanRecords - out.length)
      const params = new URLSearchParams()
      params.set('itemType', 'note')
      params.set('sort', 'dateModified')
      params.set('direction', 'desc')
      params.set('start', String(start))
      params.set('limit', String(wanted))
      const { json } = await this.client.getJson<unknown>('users/0/items/top', params, {
        signal,
        serverId: scope.serverId,
      })
      const rows = Array.isArray(json) ? json : []
      if (rows.length === 0) break
      out.push(...rows.slice(0, wanted))
      // Fewer rows than requested means the library has no more notes.
      if (rows.length < wanted) break
      start += rows.length
    }
    return out
  }

  /**
   * Whether a note row satisfies the body scan: every query token appears
   * in the note text, plus the scope's collection and the literal tag
   * filters when present. The caller has already tokenized the non-empty
   * query, so `terms` are the lowercased query tokens.
   */
  private noteRowMatches(
    row: unknown,
    terms: readonly string[],
    tags: readonly string[] | undefined,
    collectionKey: string | undefined,
  ): boolean {
    const data = asRecord(asRecord(row)?.data)
    if (asString(data?.itemType) !== 'note') return false
    if (collectionKey !== undefined && !collectionKeysOf(row).includes(collectionKey)) return false
    if (tags !== undefined && tags.length > 0) {
      const tagNames = new Set(
        (Array.isArray(data?.tags) ? data.tags : [])
          .map((tag) => asString(asRecord(tag)?.tag))
          .filter((tag): tag is string => tag !== undefined),
      )
      if (!tags.every((tag) => tagNames.has(tag))) return false
    }
    const text = plainNoteText(data?.note).toLowerCase()
    return terms.every((term) => text.includes(term))
  }

  /**
   * Fetch one item's full detail. The parent is always fetched once; child
   * rows are fetched lazily (one extra request) only when the caller asked
   * to include notes/annotations/attachments — the Local API ignores
   * `?include=` on single-item responses, so children come from the
   * dedicated `/children` endpoint. Collection names resolve from a cached
   * full listing (one listing request per provider instance) only when the
   * item belongs to collections.
   */
  async getItem(request: ZoteroGetRequest, signal?: AbortSignal): Promise<ZoteroItemDetail> {
    const ref = requireLocalRef(request.ref, ['item'])
    const parent = await this.client.getJson<unknown>(`users/0/items/${ref.key}`, undefined, {
      signal,
      serverId: ref.serverId,
    })
    const serverId = parent.headers.get('zotero-server-id') ?? ref.serverId
    const includes = INCLUDE_ORDER.filter((kind) => request.include.has(kind))
    const keys = collectionKeysOf(parent.json)
    // Children and the collections listing are independent once the parent
    // has arrived; the Local API is a loopback server with no per-client
    // throttling, so both ride the same await.
    const [childrenRows, collectionNames] = await Promise.all([
      includes.length > 0 ? this.fetchChildRows(ref.key, serverId, signal) : undefined,
      keys.length > 0 ? this.collectionNamesFor(keys, serverId, signal) : undefined,
    ])
    return normalizeItemDetail({
      parent: parent.json,
      serverId: serverId ?? undefined,
      include: request.include,
      childrenRows,
      collectionNames,
      maxAbstractChars: this.limits.maxDetailChars,
      maxNoteBodyChars: this.limits.maxNoteBodyChars,
      maxNoteChars: this.limits.maxNoteChars,
      maxNoteRecords: this.limits.maxNoteRecords,
      maxAnnotationRecords: this.limits.maxAnnotationRecords,
    })
  }

  /** Fetch one item's child rows; undefined when the caller asked for none. */
  private async fetchChildRows(
    key: string,
    serverId: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<readonly unknown[]> {
    const children = await this.client.getJson<unknown>(
      `users/0/items/${key}/children`,
      undefined,
      {
        signal,
        serverId,
      },
    )
    return Array.isArray(children.json) ? children.json : []
  }

  /**
   * Collection names for exactly the requested keys, resolved from the cached
   * full listing. The Local API returns list endpoints in full by default
   * (unlike the Web API's 25-per-page), so one unpaginated listing serves
   * every call; the provider instance is rebuilt on every settings commit,
   * which is the cache's invalidation point.
   */
  private async collectionNamesFor(
    keys: readonly string[],
    serverId: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<ReadonlyMap<string, string>> {
    const listing = await this.scopeListingOf('collections', serverId, signal)
    const wanted = new Set(keys)
    return new Map(
      listing.entries
        .filter((entry) => wanted.has(entry.key))
        .map((entry) => [entry.key, entry.name]),
    )
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
    const local = requireLocalRef(ref, ['item', 'attachment'])
    const attachmentKey = await this.resolveAttachmentKey(local, signal)
    const item = await this.client.getJson<unknown>(`users/0/items/${attachmentKey}`, undefined, {
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
    const formattedRef = formatRef(localRef('attachment', attachment.key, serverId))
    const title = attachment.title
    const contentType = attachment.contentType
    if (attachment.linkMode === 'linked_url') {
      if (attachment.url === undefined || attachment.url === '') {
        throw new ZoteroError(
          `Attachment ${attachmentKey} is linked to a URL but Zotero reported none.`,
          ZOTERO_NO_ATTACHMENT,
        )
      }
      return { ref: formattedRef, title, contentType, kind: 'url', url: attachment.url }
    }
    const file = await this.client.get(`users/0/items/${attachmentKey}/file/view/url`, undefined, {
      signal,
      serverId: local.serverId,
    })
    let target: URL
    try {
      target = new URL(file.body.trim())
    } catch (error) {
      throw new ZoteroError(
        `Zotero reported no usable file location for attachment ${attachmentKey}.`,
        ZOTERO_NO_ATTACHMENT,
        { cause: error },
      )
    }
    if (target.protocol !== 'file:') {
      return { ref: formattedRef, title, contentType, kind: 'url', url: target.toString() }
    }
    const path = fileURLToPath(target)
    if (!existsSync(path)) {
      throw new ZoteroError(
        `The attachment file is missing from disk: ${path}`,
        ZOTERO_FILE_MISSING,
      )
    }
    return { ref: formattedRef, title, contentType, kind: 'file', path }
  }

  /**
   * Gather ranked evidence for one item: annotations, notes, the abstract,
   * and full-text chunks are scored as one passage corpus with BM25. Fetch
   * stays lazy — children only when annotation/note sources (or a PDF
   * fallback) need them, fulltext only when requested (started concurrently
   * with children when the parent carries the attachment link). A note
   * item's own body is its note source; child notes contribute every chunk
   * of their full text, so long notes rank beyond their first chunk. Sources
   * the item cannot provide are skipped and reported in `sourcesSkipped` —
   * retrieval degrades instead of failing. Passage count and character
   * budgets are enforced with the `truncated` flag, never by silently
   * editing passage text.
   */
  async retrieve(
    request: ZoteroRetrieveRequest,
    signal?: AbortSignal,
  ): Promise<ZoteroRetrieveResult> {
    const ref = requireLocalRef(request.ref, ['item'])
    const parent = await this.client.getJson<unknown>(`users/0/items/${ref.key}`, undefined, {
      signal,
      serverId: ref.serverId,
    })
    const serverId = parent.headers.get('zotero-server-id') ?? ref.serverId
    const record = asRecord(parent.json)
    const data = asRecord(record?.data)
    const itemType = asString(data?.itemType) ?? asString(record?.itemType)
    const linkAttachment = bestAttachmentFromLinks(parent.json)

    const wantsAnnotations = request.sources.includes('annotation')
    const wantsNotes = request.sources.includes('note')
    const wantsFulltext = request.sources.includes('fulltext')
    // A note item's own body is its note source, so its children are only
    // needed for annotation sources or the PDF fallback.
    const isNoteItem = itemType === 'note'
    const fetchChildren =
      wantsAnnotations ||
      (wantsNotes && !isNoteItem) ||
      (wantsFulltext && linkAttachment === undefined)
    // Children and a linked fulltext are independent once the parent has
    // arrived; start both before awaiting either. The noop handler keeps a
    // fulltext rejection that lands while children are still in flight from
    // being reported as unhandled before the try below awaits it.
    const fulltextKey = wantsFulltext ? linkAttachment?.key : undefined
    const fulltextPromise =
      fulltextKey === undefined ? undefined : this.fetchFulltext(fulltextKey, serverId, signal)
    fulltextPromise?.catch(() => {})
    let childrenRows: readonly unknown[] = []
    if (fetchChildren) {
      const children = await this.client.getJson<unknown>(
        `users/0/items/${ref.key}/children`,
        undefined,
        {
          signal,
          serverId,
        },
      )
      childrenRows = Array.isArray(children.json) ? children.json : []
    }

    const skipped: ZoteroEvidenceSource[] = []
    let fulltextWasCut = false
    let attachmentRef: string | undefined
    let coverage: ZoteroCoverage | undefined
    const passages: {
      source: ZoteroEvidenceSource
      sourceRef: string
      text: string
      chunkIndex?: number
      chunkCount?: number
      comment?: string
      pageLabel?: string
    }[] = []
    if (wantsFulltext) {
      let attachmentKey = fulltextKey
      if (attachmentKey === undefined) {
        const pdf = selectAttachment(childrenRows, 'pdf')
        if (pdf === undefined) skipped.push('fulltext')
        else attachmentKey = pdf.key
      }
      if (attachmentKey !== undefined) {
        try {
          attachmentRef = formatRef(localRef('attachment', attachmentKey, serverId))
          const payload = await (fulltextPromise ??
            this.fetchFulltext(attachmentKey, serverId, signal))
          const content = typeof payload.content === 'string' ? payload.content : ''
          const bounded = truncateText(content, this.limits.maxFulltextChars)
          fulltextWasCut = bounded.truncated
          const chunks = chunkText(bounded.text, this.limits.fulltextChunkWords)
          for (const chunk of chunks) {
            passages.push({
              source: 'fulltext',
              sourceRef: attachmentRef,
              text: chunk.text,
              chunkIndex: chunk.index,
              chunkCount: chunks.length,
            })
          }
          coverage = normalizeCoverage(payload)
        } catch (error) {
          // An unindexed attachment degrades like an absent one: the other
          // requested sources still answer, and `sourcesSkipped` reports it.
          if (error instanceof ZoteroError && error.code === ZOTERO_NO_FULLTEXT) {
            skipped.push('fulltext')
          } else {
            throw error
          }
        }
      }
    }

    const partitioned: PartitionedChildren = fetchChildren
      ? partitionChildren(
          childrenRows,
          serverId,
          undefined,
          new Set<ZoteroChildKind>([
            ...(wantsNotes ? (['note'] as const) : []),
            ...(wantsAnnotations ? (['annotation'] as const) : []),
          ]),
        )
      : { notes: [], annotations: [], attachments: [] }
    if (wantsAnnotations) {
      for (const annotation of partitioned.annotations) {
        passages.push({
          source: 'annotation',
          sourceRef: annotation.ref,
          text: annotation.text,
          ...(annotation.comment !== undefined ? { comment: annotation.comment } : {}),
          ...(annotation.pageLabel !== undefined ? { pageLabel: annotation.pageLabel } : {}),
        })
      }
    }
    if (wantsNotes) {
      const noteRef = formatRef(localRef('item', ref.key, serverId))
      const noteSources: { ref: string; text: string }[] = isNoteItem
        ? [{ ref: noteRef, text: plainNoteText(data?.note) }]
        : partitioned.notes.map((note) => ({ ref: note.ref, text: note.text }))
      for (const note of noteSources) {
        const chunks = chunkText(note.text, this.limits.fulltextChunkWords)
        for (const chunk of chunks) {
          passages.push({
            source: 'note',
            sourceRef: note.ref,
            text: chunk.text,
            chunkIndex: chunk.index,
            chunkCount: chunks.length,
          })
        }
      }
    }
    let abstractWasCut = false
    if (request.sources.includes('abstract')) {
      const raw = asString(data?.abstractNote) ?? ''
      if (raw !== '') {
        const bounded = truncateText(raw, this.limits.maxEvidenceChars)
        abstractWasCut = bounded.truncated
        passages.push({
          source: 'abstract',
          sourceRef: formatRef(localRef('item', ref.key, serverId)),
          text: bounded.text,
        })
      }
    }

    const ranked = rankChunks(
      request.query,
      passages.map((passage, index) => ({ text: passage.text, index })),
    )
    const evidence: ZoteroEvidence[] = []
    let used = 0
    let truncated = ranked.length > request.passages || fulltextWasCut || abstractWasCut
    for (const entry of ranked.slice(0, request.passages)) {
      const passage = passages[entry.index]!
      if (used + passage.text.length > this.limits.maxEvidenceChars) {
        truncated = true
        break
      }
      used += passage.text.length
      evidence.push({
        source: passage.source,
        sourceRef: passage.sourceRef,
        text: passage.text,
        ...(passage.chunkIndex !== undefined ? { chunkIndex: passage.chunkIndex } : {}),
        ...(passage.chunkCount !== undefined ? { chunkCount: passage.chunkCount } : {}),
        ...(passage.comment !== undefined ? { comment: passage.comment } : {}),
        ...(passage.pageLabel !== undefined ? { pageLabel: passage.pageLabel } : {}),
      })
    }
    return {
      ref: formatRef(localRef('item', ref.key, serverId)),
      ...(attachmentRef !== undefined ? { attachmentRef } : {}),
      ...(coverage !== undefined ? { coverage } : {}),
      evidence,
      truncated,
      sourcesSkipped: skipped,
    }
  }

  /**
   * Export the requested items through the Local API's format pipeline:
   * `include=citation` pairs each item with its HTML citation in one list
   * request (reordered to match the requested refs), `format=bib` yields a
   * joined CSL-sorted bibliography, and the translator formats
   * (`bibtex`/`biblatex`/`ris`/`csljson`) export the whole set at once.
   * Output that exceeds `maxExportChars` fails with OUTPUT_TOO_LARGE —
   * export text is never mid-truncated.
   */
  async export(request: ZoteroExportRequest, signal?: AbortSignal): Promise<ZoteroExportResult> {
    for (const ref of request.refs) requireLocalRef(ref, ['item'])
    const search = new URLSearchParams()
    search.set('itemKey', request.refs.map((ref) => ref.key).join(','))
    const serverId = request.refs[0]?.serverId
    const style = request.style ?? this.limits.defaultStyle
    const locale = request.locale ?? this.limits.defaultLocale
    if (request.format === 'citation') {
      search.set('include', 'citation')
      search.set('style', style)
      search.set('locale', locale)
      const { json } = await this.client.getJson<unknown>('users/0/items', search, {
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
      const citations = request.refs.map((ref) => {
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
    if (request.format === 'bibliography') {
      search.set('format', 'bib')
      search.set('style', style)
      search.set('locale', locale)
    } else {
      search.set('format', request.format)
    }
    const { body } = await this.client.get('users/0/items', search, { signal, serverId })
    if (body.length > this.limits.maxExportChars) {
      throw new ZoteroError(
        `Export output of ${body.length} characters exceeds the ${this.limits.maxExportChars}-character export limit.`,
        ZOTERO_OUTPUT_TOO_LARGE,
      )
    }
    if (request.format === 'bibliography') {
      return { format: 'bibliography', style, locale, text: body }
    }
    return { format: request.format, text: body }
  }

  /**
   * Pick the attachment key an item ref resolves to: Zotero's own
   * `links.attachment` choice when present, otherwise the earliest PDF
   * child from a lazy `/children` fetch.
   * @throws {ZoteroError} `ZOTERO_NO_ATTACHMENT` when the item has none.
   */
  private async resolveAttachmentKey(ref: ZoteroObjectRef, signal?: AbortSignal): Promise<string> {
    if (ref.kind === 'attachment') return ref.key
    const parent = await this.client.getJson<unknown>(`users/0/items/${ref.key}`, undefined, {
      signal,
      serverId: ref.serverId,
    })
    const link = bestAttachmentFromLinks(parent.json)
    if (link !== undefined) return link.key
    const children = await this.client.getJson<unknown>(
      `users/0/items/${ref.key}/children`,
      undefined,
      {
        signal,
        serverId: ref.serverId,
      },
    )
    const pdf = selectAttachment(Array.isArray(children.json) ? children.json : [], 'pdf')
    if (pdf === undefined) {
      throw new ZoteroError(`Item ${ref.key} has no attachment to resolve.`, ZOTERO_NO_ATTACHMENT)
    }
    return pdf.key
  }

  private async fetchFulltext(
    attachmentKey: string,
    serverId: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<ZoteroFulltextPayload> {
    try {
      const response = await this.client.getJson<ZoteroFulltextPayload>(
        `users/0/items/${attachmentKey}/fulltext`,
        undefined,
        { signal, serverId },
      )
      return response.json
    } catch (error) {
      // The Local API reports unindexed attachments as 404, which the HTTP
      // layer maps to NOT_FOUND; only this endpoint reinterprets that status.
      if (isNotFoundError(error)) {
        throw new ZoteroError(NO_FULLTEXT_MESSAGE, ZOTERO_NO_FULLTEXT)
      }
      throw error
    }
  }

  private async resolveScope(
    scope: ZoteroSearchScope,
    signal?: AbortSignal,
  ): Promise<ResolvedScopeResult> {
    switch (scope.kind) {
      case 'library':
        return { path: 'users/0/items/top', resolved: { kind: 'library' } }
      case 'collection': {
        const found = await this.resolveNamed('collection', scope.refOrName, signal)
        return {
          path: `users/0/collections/${found.ref.key}/items/top`,
          resolved: { kind: 'collection', ref: formatRef(found.ref), name: found.name },
          serverId: found.ref.serverId,
          collectionKey: found.ref.key,
        }
      }
      case 'savedSearch': {
        const found = await this.resolveNamed('search', scope.refOrName, signal)
        return {
          path: `users/0/searches/${found.ref.key}/items`,
          resolved: { kind: 'savedSearch', ref: formatRef(found.ref), name: found.name },
          serverId: found.ref.serverId,
        }
      }
    }
  }

  /**
   * Resolve a collection or saved search from a ref or a name. A ref fetches
   * that single object (validating existence and reading its name); a name
   * matches client-side over the full listing, since the Local API has no
   * server-side name search for these endpoints.
   */
  private async resolveNamed(
    kind: 'collection' | 'search',
    refOrName: string,
    signal?: AbortSignal,
  ): Promise<{ ref: ZoteroObjectRef; name: string }> {
    const plural = kind === 'collection' ? 'collections' : 'searches'
    if (isRefString(refOrName)) {
      const ref = requireLocalRef(parseRef(refOrName), [kind])
      const { json, headers } = await this.client.getJson<unknown>(
        `users/0/${plural}/${ref.key}`,
        undefined,
        {
          signal,
          serverId: ref.serverId,
        },
      )
      const entry = normalizeScopeEntry(json)
      return {
        ref: localRef(kind, entry.key, headers.get('zotero-server-id') ?? ref.serverId),
        name: entry.name,
      }
    }
    // The Local API returns list endpoints in full by default (unlike the
    // Web API's 25-per-page), so one unpaginated listing sees every name;
    // the listing is cached per provider instance.
    const listing = await this.scopeListingOf(plural, undefined, signal)
    const matched = matchScopeName(listing.entries, refOrName)
    if (matched.length === 1) {
      const found = matched[0]!
      return {
        ref: localRef(kind, found.key, listing.serverId),
        name: found.name,
      }
    }
    const label = kind === 'collection' ? 'collection' : 'saved search'
    if (matched.length > 1) {
      const list = matched
        .slice(0, 5)
        .map((entry) => formatRef(localRef(kind, entry.key)))
        .join(', ')
      throw new ZoteroError(
        `More than one ${label} matches "${refOrName}". Pick one of: ${list}`,
        ZOTERO_SCOPE_AMBIGUOUS,
      )
    }
    const near = nearScopeCandidates(listing.entries, refOrName, 5)
    const hint =
      near.length > 0 ? ` Possible matches: ${near.map((entry) => entry.name).join(', ')}` : ''
    throw new ZoteroError(`No ${label} named "${refOrName}" was found.${hint}`, ZOTERO_NOT_FOUND)
  }
}
