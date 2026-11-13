/**
 * The session source reducer: turns the session's zotero tool blocks into a
 * {@link SourceWorkspace}. The listed sources are the stable union (every
 * successful search's rows plus every directly referenced item), so viewing
 * one item never shrinks the others, and no search supersedes an earlier
 * one. Facts come only from settled, successful, structurally valid calls;
 * running, failed, and stopped calls count into operations, never into
 * achievements.
 *
 * The fold is incremental. `SourceWorkspaceIndex.apply` folds one block into a
 * mutable accumulator, and `workspace` freezes only the items whose draft
 * changed since the last freeze, reusing every other frozen item. The host
 * projection reads its view once per committed event on a session of any
 * length, so a per-view cost proportional to the whole log would make the
 * trail quadratic in the event count. `buildSourceWorkspace` keeps the
 * one-shot contract the browser fallback and the specs use: fold every block,
 * then freeze once. Both paths share the same fold and the same freeze, so the
 * incremental index cannot drift from the pure builder.
 * @module dsh-zotero/sources/ledger
 */

import { receiptOf } from './receipt.js'
import { exportBodyOf } from './export-body.js'
import { windowedItem } from './window.js'

import type { ArgsView, ToolBlockLike } from './block-types.js'
import {
  argsViewOf,
  boolArg,
  callNameOf,
  isSettledTool,
  listArg,
  metaOf,
  recordArg,
  rowStateOf,
  textArg,
  valueArg,
  type ZoteroRowState,
} from './presenters.js'
import { isRecord, stringField } from '../json.js'
import {
  getBatchMetaOf,
  getMetaOf,
  matchReferencesMetaOf,
  retrieveMetaOf,
  searchMetaOf,
} from './decoders.js'
import { exportMetaOf, type ExportMetaView } from './export-decoder.js'
import type {
  EvidencePassage,
  ExportArtifact,
  SearchOccurrence,
  SourceAttachment,
  SourceItem,
  SourceRetrievalFacts,
  SourceScope,
  SourceWorkspace,
  SupportedLocalLibrary,
} from './model.js'
import { supportedLocalLibraryOf } from './model.js'
import { evidenceMatchOf, normalizeRefKey, serverIdOf } from './evidence-match.js'
import { hasIssue, type SourceFilterCounts } from './filters.js'
import { hasPdf } from './source-capabilities.js'
import {
  ZOTERO_SOURCE_WORKSPACE_MAX_ITEM_ROWS,
  ZOTERO_SOURCE_WORKSPACE_MAX_SOURCES,
} from '../constants.js'
import type { ZoteroResolvedScope } from '../contract.js'

/** How one workspace read shapes its lists. */
export interface BuildSourceWorkspaceOptions {
  /** The connected instance's Server ID from the status probe, when known. */
  readonly currentServerId?: string
  /** Keep the existing bounded view; internal session paging requests the full fold. */
  readonly windowed?: boolean
}

/** One folded logical search: consecutive continuations share one identity. */
interface SearchDraft {
  readonly identity: string | null
  readonly callId: string
  readonly query?: string
  readonly mode: 'metadata' | 'everything'
  readonly scope: SourceScope
  readonly library?: SupportedLocalLibrary
  /** The episode's own filter arguments, normalized at creation. */
  readonly itemTypes: readonly string[]
  readonly tags: readonly string[]
  readonly tagMatch?: 'all' | 'any'
  readonly excludeTags: readonly string[]
  readonly includeTrashed: boolean
  /**
   * The first page's whole-hit count and note-scan matches. Later pages of the
   * same identity never overwrite them: they describe the episode, not a page.
   */
  readonly total?: number
  readonly noteMatches?: number
  returned: number
  /** The items whose `searches` list carries this occurrence; a page changes them all. */
  readonly members: Set<ItemDraft>
}

/** Mutable accumulator shapes; the frozen views come from `model.ts`. */
interface DraftFacts {
  reportedEvidenceCount: number
}

interface DraftOperations {
  running: number
  failed: number
  stopped: number
}

interface EvidenceDraft {
  passage: Omit<EvidencePassage, 'callIds'> & { callIds: string[] }
  readonly seq: number
}

/** The mutable accumulator; structurally the frozen SourceItem view. */
interface ItemDraft {
  readonly key: string
  readonly ref: string
  readonly serverIds: Set<string>
  title?: string
  creators?: string
  year?: number
  venue?: string
  readonly facts: DraftFacts
  readonly operations: DraftOperations
  readonly evidence: Map<string, EvidenceDraft>
  bestAttachment?: SourceItem['bestAttachment']
  attachment?: SourceAttachment
  retrievalFacts?: SourceRetrievalFacts
  retrievalSummary?: SourceItem['retrievalSummary']
  /** Call ids of the successful, meta-recognizable retrieves (run count). */
  readonly successfulRetrieveCallIds: Set<string>
  exports: ExportArtifact[]
  readonly exportedCallIds: Set<string>
  /** Occurrences in episode order; the same draft object is shared across items. */
  readonly searches: SearchDraft[]
  firstSeenAt: number
  lastTouchedAt: number
  /**
   * Bumped by every fold step that may change the draft. A frozen view is
   * reused exactly while this matches the version its cache froze.
   */
  version: number
  /**
   * The filter membership of the last frozen view (see {@link MASK_PDF}); the
   * shared aggregate counters are adjusted by the delta on each refreeze.
   */
  mask: number
}

const MASK_PDF = 1
const MASK_RETRIEVED = 2
const MASK_EVIDENCE = 4
const MASK_EXPORTED = 8

/** The mask bits and the aggregate counter each one feeds. */
const MASK_FIELDS: ReadonlyArray<readonly [number, 'pdf' | 'retrieved' | 'evidence' | 'exported']> =
  [
    [MASK_PDF, 'pdf'],
    [MASK_RETRIEVED, 'retrieved'],
    [MASK_EVIDENCE, 'evidence'],
    [MASK_EXPORTED, 'exported'],
  ]

function emptyOperations(): DraftOperations {
  return { running: 0, failed: 0, stopped: 0 }
}

/**
 * The normalized shape of one search call: the identity string and every
 * field the occurrence carries, parsed once.
 *
 * A null result means the arguments are not a readable object payload, so
 * nothing can be compared: two calls whose payload merely failed to index are
 * not the same search, and folding them would merge distinct queries. The
 * view reports that through `invalid` (`packages/util/values/src/
 * partial-json.ts`), which covers malformed JSON and every non-object payload
 * (array, number, string, boolean, null).
 */
interface NormalizedSearch {
  readonly identity: string
  readonly query?: string
  readonly mode: 'metadata' | 'everything'
  readonly scope: SourceScope
  /** The library the occurrence carries; absent when the call did not name one. */
  readonly occurrenceLibrary?: SupportedLocalLibrary
  readonly itemTypes: readonly string[]
  readonly tags: readonly string[]
  readonly tagMatch: 'all' | 'any'
  readonly excludeTags: readonly string[]
  readonly includeTrashed: boolean
}

function normalizedSearchOf(
  args: ArgsView,
  overrides?: {
    readonly resolvedScope: ZoteroResolvedScope
    readonly resolvedLibrary: SupportedLocalLibrary
  },
): NormalizedSearch | null {
  if (args.invalid) return null
  const query = textArg(args, 'query')
  const mode = textArg(args, 'mode') === 'everything' ? 'everything' : 'metadata'
  const scope =
    overrides !== undefined
      ? resolvedToSourceScope(overrides.resolvedScope)
      : scopeOf(valueArg(args, 'scope'))
  const namedLibrary =
    overrides?.resolvedLibrary ?? supportedLocalLibraryOf(recordArg(args, 'library'))
  const identityLibrary = namedLibrary ?? { type: 'user' as const, id: 0 as const }
  const itemTypes = normalizedListOf(listArg(args, 'itemTypes'))
  const tags = normalizedListOf(listArg(args, 'tags'))
  const tagMatch = textArg(args, 'tagMatch') === 'any' ? 'any' : 'all'
  const excludeTags = normalizedListOf(listArg(args, 'excludeTags'))
  const includeTrashed = boolArg(args, 'includeTrashed')
  const sort = textArg(args, 'sort') ?? ''
  const direction = textArg(args, 'direction') ?? ''
  return {
    identity: JSON.stringify({
      query: query ?? '',
      mode,
      library: identityLibrary,
      scope,
      itemTypes,
      tags,
      tagMatch,
      excludeTags,
      includeTrashed,
      sort,
      direction,
    }),
    ...(query !== undefined && query !== '' ? { query } : {}),
    mode,
    scope,
    ...(namedLibrary === undefined ? {} : { occurrenceLibrary: namedLibrary }),
    itemTypes,
    tags,
    tagMatch,
    excludeTags,
    includeTrashed,
  }
}

/** String entries of a list field, deduplicated and ordered (order-free identity). */
function normalizedListOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string'))].sort()
}

/** The normalized scope of one search call; unparseable scopes fall back to the library. */
function scopeOf(value: unknown): SourceScope {
  if (isRecord(value)) {
    const kind = value['kind']
    const refOrName = value['refOrName']
    if (
      (kind === 'collection' || kind === 'savedSearch') &&
      typeof refOrName === 'string' &&
      refOrName !== ''
    ) {
      return refOrName.startsWith('zotero://')
        ? { kind, ref: refOrName }
        : { kind, name: refOrName }
    }
  }
  return { kind: 'library', library: { type: 'user', id: 0 } }
}

function resolvedToSourceScope(scope: ZoteroResolvedScope): SourceScope {
  if (scope.kind === 'library') return { kind: 'library', library: scope.library }
  if (scope.kind === 'publications') return { kind: 'publications', library: scope.library }
  if (scope.kind === 'collection') return { kind: 'collection', ref: scope.ref, name: scope.name }
  if (scope.kind === 'savedSearch') return { kind: 'savedSearch', ref: scope.ref, name: scope.name }
  // Trash is the library panel's own scope; a tool result never carries it,
  // and the Sources projection has no trash container, so it reads as the
  // library it belongs to.
  return { kind: 'library', library: scope.library }
}

/** The ref argument of one ref-carrying call; null when absent or unusable. */
function refArgOf(args: ArgsView): string | null {
  const ref = textArg(args, 'ref')
  return ref === undefined || ref === '' ? null : ref
}

/**
 * The exported refs of one export call: the arguments are the complete,
 * validated business attribution, so they win and report no omitted refs;
 * the meta projection only previews (bounded, with its own omitted count)
 * when the args are unusable.
 */
function exportRefsOf(
  metaView: ExportMetaView | null,
  args: ArgsView,
): { readonly refs: readonly string[]; readonly refsOmitted: number } {
  if (args.has('refs')) {
    const refs = args.value('refs')
    if (Array.isArray(refs)) {
      return {
        refs: refs.filter((entry): entry is string => typeof entry === 'string' && entry !== ''),
        refsOmitted: 0,
      }
    }
  }
  return {
    refs: metaView === null ? [] : [...metaView.refs],
    refsOmitted: metaView === null ? 0 : metaView.refsOmitted,
  }
}

/** The dedup identity of one evidence passage: its verbatim fields, no hashing. */
function evidenceKeyOf(item: import('../evidence-item.js').EvidenceItem): string {
  const artifact = item.artifact
  return JSON.stringify([
    item.source,
    item.sourceRef,
    item.pageLabel,
    item.preview,
    item.textFormat,
    item.start,
    item.end,
    artifact === undefined
      ? null
      : [
          artifact.parser,
          artifact.mode,
          artifact.artifactId,
          artifact.fingerprint,
          artifact.sourceId,
          artifact.generation,
        ],
  ])
}

/**
 * The event time of a settled block. Guarded by isSettledTool (which
 * `rowStateOf` also funnels through), so an unsettled block never arrives
 * here: the early return, not a cast, carries the proof.
 */
function eventTimeOf(block: ToolBlockLike): number {
  if (!isSettledTool(block)) return 0
  return block.time
}

/** The filter membership one frozen item contributes to the aggregate counters. */
function maskOf(item: SourceItem): number {
  return (
    (hasPdf(item) ? MASK_PDF : 0) |
    (item.retrievalFacts === undefined ? 0 : MASK_RETRIEVED) |
    (item.evidence.length === 0 ? 0 : MASK_EVIDENCE) |
    (item.exports.length === 0 ? 0 : MASK_EXPORTED)
  )
}

/** Freeze one occurrence; the argument arrays are written once and never mutated. */
function frozenSearchOf(draft: SearchDraft): SearchOccurrence {
  return {
    callId: draft.callId,
    ...(draft.query === undefined ? {} : { query: draft.query }),
    mode: draft.mode,
    scope: draft.scope,
    ...(draft.library ? { library: draft.library } : {}),
    itemTypes: draft.itemTypes,
    tags: draft.tags,
    ...(draft.tagMatch ? { tagMatch: draft.tagMatch } : {}),
    excludeTags: draft.excludeTags,
    includeTrashed: draft.includeTrashed,
    returned: draft.returned,
    ...(draft.total === undefined ? {} : { total: draft.total }),
    ...(draft.noteMatches === undefined ? {} : { noteMatches: draft.noteMatches }),
  }
}

/**
 * Freeze one item. Every nested value the draft still mutates is copied: the
 * draft outlives the view, so sharing `facts`, `operations`, the row arrays or
 * their `callIds` would let a later fold rewrite a view already published.
 */
function frozenItemOf(draft: ItemDraft, currentServerId: string | undefined): SourceItem {
  const searches = draft.searches.map(frozenSearchOf)
  // Insertion order is transcript order (the fold is sequential), so the sort
  // is a stable no-op that keeps the guarantee explicit for a resumed index.
  const evidence = [...draft.evidence.values()]
    .sort((a, b) => a.seq - b.seq)
    .map((entry) => ({ ...entry.passage, callIds: [...entry.passage.callIds] }))
  return {
    key: draft.key,
    ref: draft.ref,
    serverIds: [...draft.serverIds].sort(),
    evidenceMatch: evidenceMatchOf(draft.serverIds, currentServerId),
    ...(draft.title === undefined ? {} : { title: draft.title }),
    ...(draft.creators === undefined ? {} : { creators: draft.creators }),
    ...(draft.year === undefined ? {} : { year: draft.year }),
    ...(draft.venue === undefined ? {} : { venue: draft.venue }),
    facts: { reportedEvidenceCount: draft.facts.reportedEvidenceCount },
    operations: {
      running: draft.operations.running,
      failed: draft.operations.failed,
      stopped: draft.operations.stopped,
    },
    searches,
    searchesTotal: searches.length,
    evidence,
    evidenceTotal: evidence.length,
    ...(draft.bestAttachment === undefined ? {} : { bestAttachment: draft.bestAttachment }),
    ...(draft.attachment === undefined ? {} : { attachment: draft.attachment }),
    ...(draft.retrievalFacts === undefined ? {} : { retrievalFacts: draft.retrievalFacts }),
    ...(draft.retrievalSummary === undefined ? {} : { retrievalSummary: draft.retrievalSummary }),
    exports: [...draft.exports],
    exportsTotal: draft.exports.length,
    firstSeenAt: draft.firstSeenAt,
    lastTouchedAt: draft.lastTouchedAt,
  }
}

/**
 * The pending tail folded on top of the settled items: the calls still in
 * flight, which the reducer counts as running operations.
 */
interface PendingOverlay {
  /** Every item the pending calls touched, in first-seen order. */
  readonly items: readonly SourceItem[]
  readonly exportRunning: number
}

const EMPTY_OVERLAY: PendingOverlay = { items: [], exportRunning: 0 }

function sameOverlay(left: PendingOverlay | undefined, right: PendingOverlay): boolean {
  if (left === undefined) return right === EMPTY_OVERLAY
  if (right === EMPTY_OVERLAY) return left === EMPTY_OVERLAY
  if (left.exportRunning !== right.exportRunning) return false
  if (left.items.length !== right.items.length) return false
  for (let i = 0; i < left.items.length; i += 1) {
    const a = left.items[i]!
    const b = right.items[i]!
    if (a.key !== b.key || a.operations.running !== b.operations.running) return false
    if (a.firstSeenAt !== b.firstSeenAt || a.lastTouchedAt !== b.lastTouchedAt) return false
  }
  return true
}

/**
 * Merge one item a pending call touched into its settled view. A pending block
 * carries no result, so the only facts it adds are the ones `draftOf` records
 * for every touch — the ref's Server ID, the touch position, and the running
 * operation — and this merge states exactly those, in the same order the fold
 * applies them.
 */
function mergePending(
  existing: SourceItem,
  touched: SourceItem,
  currentServerId: string | undefined,
): SourceItem {
  const serverIds = [...new Set([...existing.serverIds, ...touched.serverIds])].sort()
  return {
    ...existing,
    serverIds,
    evidenceMatch: evidenceMatchOf(new Set(serverIds), currentServerId),
    operations: {
      ...existing.operations,
      running: existing.operations.running + touched.operations.running,
    },
    firstSeenAt: Math.min(existing.firstSeenAt, touched.firstSeenAt),
    lastTouchedAt: Math.max(existing.lastTouchedAt, touched.lastTouchedAt),
  }
}

/** One Server-ID's frozen view of the index. */
interface ViewCache {
  /** Frozen items, parallel to the index's drafts (append-only). */
  readonly items: SourceItem[]
  /** The draft version each frozen item was built from. */
  readonly versions: number[]
  /** Items whose `hasIssue` verdict is true under this cache's Server ID. */
  issues: number
  overlay?: PendingOverlay
  /** The views built from the current fold and overlay; each shape is built at most once. */
  built?: { windowed?: SourceWorkspace; full?: SourceWorkspace }
  /** The scalar revision this cache's views were built at. */
  scalarRevision: number
  /** How many entries of the index change log this cache has processed. */
  changeCursor: number
}

/**
 * The incremental workspace fold: one mutable accumulator plus one frozen view
 * per Server ID, so a read costs the blocks folded since the last read rather
 * than the whole session.
 *
 * The index owns no lifecycle of its own; whoever creates it owns it. The host
 * projection creates one per session state chain (see
 * `createSourceLedgerProjection`) and the one-shot builder creates one per
 * call.
 */
export class SourceWorkspaceIndex {
  private readonly drafts: ItemDraft[] = []
  private readonly indexByKey = new Map<string, number>()
  private readonly artifacts: ExportArtifact[] = []
  private readonly artifactOperations: DraftOperations = emptyOperations()
  private readonly artifactRefs = new Set<string>()
  private readonly viewCaches = new Map<string | undefined, ViewCache>()
  private readonly filterTotals = { pdf: 0, retrieved: 0, evidence: 0, exported: 0 }
  private openSearch: SearchDraft | null = null
  private passages = 0
  private omitted = 0
  private folded = 0
  /**
   * The drafts whose frozen view must be rebuilt, in mutation order. Each view
   * cache keeps a cursor into this log, so a read costs the changes since its
   * last read rather than a scan of every source.
   */
  private readonly changeLog: number[] = []
  /**
   * A counter for session-wide scalar aggregates that have no draft to bump
   * (`artifactOperations`, `omitted`). A cache whose views were built at an
   * older revision rebuilds even when no draft version changed.
   */
  private scalarRevision = 0

  constructor(startSeq = 0) {
    this.folded = startSeq
  }

  /** How many blocks this index folded; the transcript index of the next one. */
  get applied(): number {
    return this.folded
  }

  /**
   * Fold one block. A running block only creates its item and counts a running
   * operation; every outcome fact needs a settled, successful result.
   * @param block - the next block in transcript order.
   */
  apply(block: ToolBlockLike): void {
    const seq = this.folded
    this.folded += 1
    this.fold(block, seq)
  }

  /**
   * The workspace at this point of the fold, with an optional tail of pending
   * blocks folded on top without mutating the index.
   *
   * A read that changes nothing returns the previous workspace object, so the
   * host projection's `Object.is` comparison suppresses a redundant publish.
   * @param pending - the calls still in flight, in transcript order, after every folded block.
   * @param options - the connected Server ID and the list window.
   * @returns the aggregated workspace.
   */
  workspace(
    pending: readonly ToolBlockLike[] = [],
    options: BuildSourceWorkspaceOptions = {},
  ): SourceWorkspace {
    const currentServerId = options.currentServerId
    const cache = this.cacheFor(currentServerId)
    const changed = this.refreeze(cache, currentServerId)
    const overlay = this.overlayOf(pending, currentServerId)
    if (
      changed ||
      cache.scalarRevision !== this.scalarRevision ||
      cache.built === undefined ||
      !sameOverlay(cache.overlay, overlay)
    ) {
      cache.overlay = overlay
      cache.scalarRevision = this.scalarRevision
      cache.built = {}
    }
    const built = cache.built
    if (options.windowed === false) {
      built.full ??= this.freezeFull(cache, overlay, currentServerId)
      return built.full
    }
    built.windowed ??= this.freezeWindowed(cache, overlay, currentServerId)
    return built.windowed
  }

  /**
   * The view cache for one connected Server ID. The wire view (`undefined`)
   * plus the one instance the paging endpoint currently reads are the whole
   * live set: a new ID evicts the previous page view instead of retaining a
   * full frozen source array per client-supplied string.
   */
  private cacheFor(currentServerId: string | undefined): ViewCache {
    let cache = this.viewCaches.get(currentServerId)
    if (cache !== undefined) return cache
    if (currentServerId !== undefined) {
      for (const key of [...this.viewCaches.keys()]) {
        if (key !== undefined) this.viewCaches.delete(key)
      }
    }
    cache = {
      items: [],
      versions: [],
      issues: 0,
      scalarRevision: -1,
      changeCursor: 0,
    }
    this.viewCaches.set(currentServerId, cache)
    return cache
  }

  /**
   * Freeze every draft this cache has not yet frozen at its current version.
   * The index records each mutation in `changeLog`, and a cache keeps a cursor
   * into it, so a read costs the changes since its last read plus the items it
   * actually has to rebuild, not a scan of every source.
   */
  private refreeze(cache: ViewCache, currentServerId: string | undefined): boolean {
    let changed = false
    for (let cursor = cache.changeCursor; cursor < this.changeLog.length; cursor += 1) {
      const index = this.changeLog[cursor]!
      const draft = this.drafts[index]
      if (draft === undefined) continue
      if ((cache.versions[index] ?? 0) === draft.version) continue
      const previous = cache.items[index]
      const item = frozenItemOf(draft, currentServerId)
      if (previous !== undefined && hasIssue(previous)) cache.issues -= 1
      if (hasIssue(item)) cache.issues += 1
      cache.items[index] = item
      cache.versions[index] = draft.version
      this.retally(draft, item)
      changed = true
    }
    cache.changeCursor = this.changeLog.length
    return changed
  }

  /** Move the shared filter aggregates by one draft's membership change. */
  private retally(draft: ItemDraft, item: SourceItem): void {
    const next = maskOf(item)
    const prior = draft.mask
    if (next === prior) return
    draft.mask = next
    for (const [bit, field] of MASK_FIELDS) {
      if (((next ^ prior) & bit) === 0) continue
      this.filterTotals[field] += (next & bit) === 0 ? -1 : 1
    }
  }

  /**
   * Fold the pending tail through the same reducer, into a throwaway index
   * seeded at this fold's position. A pending block carries no result, so it
   * can only create an item and count a running operation; folding it here
   * rather than into the shared accumulator keeps every already-published view
   * untouched. The spec "pending tail equals the one-shot build" pins that
   * equivalence for every block kind.
   */
  private overlayOf(
    pending: readonly ToolBlockLike[],
    currentServerId: string | undefined,
  ): PendingOverlay {
    if (pending.length === 0) return EMPTY_OVERLAY
    const tail = new SourceWorkspaceIndex(this.folded)
    for (const block of pending) tail.apply(block)
    const items = tail.workspace([], {
      ...(currentServerId === undefined ? {} : { currentServerId }),
      windowed: false,
    }).sources
    return { items, exportRunning: tail.artifactOperations.running }
  }

  /**
   * Assemble one view: the cached items (bounded to `limit`, or all) plus the
   * pending tail. The overlay merge runs over the whole overlay either way, so
   * the aggregates stay exact over every source even when the list is windowed;
   * only the array writes are limited.
   */
  private assemble(
    cache: ViewCache,
    overlay: PendingOverlay,
    currentServerId: string | undefined,
    limit: number,
  ): { readonly sources: SourceItem[]; readonly sourceTotal: number; readonly issues: number } {
    const sources = cache.items.slice(0, limit)
    let issues = cache.issues
    let added = 0
    for (const item of overlay.items) {
      const at = this.indexByKey.get(item.key)
      if (at === undefined) {
        added += 1
        if (hasIssue(item)) issues += 1
        if (sources.length < limit) sources.push(item)
        continue
      }
      const existing = cache.items[at]!
      const merged = mergePending(existing, item, currentServerId)
      if (hasIssue(existing)) issues -= 1
      if (hasIssue(merged)) issues += 1
      if (at < sources.length) sources[at] = merged
    }
    return { sources, sourceTotal: this.drafts.length + added, issues }
  }

  /** The complete view: every source and every row. Internal paging reads this. */
  private freezeFull(
    cache: ViewCache,
    overlay: PendingOverlay,
    currentServerId: string | undefined,
  ): SourceWorkspace {
    const { sources, sourceTotal, issues } = this.assemble(
      cache,
      overlay,
      currentServerId,
      Infinity,
    )
    return this.workspaceOf(sources, sourceTotal, issues, overlay, this.artifacts.slice())
  }

  /**
   * The wire view: the source union and each row list keep their transcript
   * head. The array itself is cut before it is built, so a long session's
   * per-event read does not walk the whole trail.
   */
  private freezeWindowed(
    cache: ViewCache,
    overlay: PendingOverlay,
    currentServerId: string | undefined,
  ): SourceWorkspace {
    const { sources, sourceTotal, issues } = this.assemble(
      cache,
      overlay,
      currentServerId,
      ZOTERO_SOURCE_WORKSPACE_MAX_SOURCES,
    )
    return this.workspaceOf(
      sources.map(windowedItem),
      sourceTotal,
      issues,
      overlay,
      this.artifacts.slice(0, ZOTERO_SOURCE_WORKSPACE_MAX_ITEM_ROWS),
    )
  }

  private workspaceOf(
    sources: SourceItem[],
    sourceTotal: number,
    issues: number,
    overlay: PendingOverlay,
    exports: ExportArtifact[],
  ): SourceWorkspace {
    return {
      sources,
      sourceTotal,
      exports,
      exportTotal: this.artifacts.length,
      exportOperations: {
        running: this.artifactOperations.running + overlay.exportRunning,
        failed: this.artifactOperations.failed,
        stopped: this.artifactOperations.stopped,
      },
      omittedRows: this.omitted,
      filterCounts: {
        all: sourceTotal,
        pdf: this.filterTotals.pdf,
        retrieved: this.filterTotals.retrieved,
        evidence: this.filterTotals.evidence,
        exported: this.filterTotals.exported,
        issues,
      } satisfies SourceFilterCounts,
      evidencePassageTotal: this.passages,
      exportedRefCount: this.artifactRefs.size,
    }
  }

  /** The draft of one ref, created on first sight; marks it for refreeze. */
  private draftOf(ref: string, seq: number): ItemDraft {
    const key = normalizeRefKey(ref)
    const at = this.indexByKey.get(key)
    let draft: ItemDraft
    if (at === undefined) {
      draft = {
        key,
        ref,
        serverIds: new Set(),
        facts: { reportedEvidenceCount: 0 },
        operations: emptyOperations(),
        evidence: new Map(),
        exports: [],
        exportedCallIds: new Set(),
        successfulRetrieveCallIds: new Set(),
        searches: [],
        firstSeenAt: seq,
        lastTouchedAt: seq,
        version: 1,
        mask: 0,
      }
      this.indexByKey.set(key, this.drafts.length)
      this.changeLog.push(this.drafts.length)
      this.drafts.push(draft)
    } else {
      draft = this.drafts[at]!
      this.touchDraft(at)
    }
    if (seq < draft.firstSeenAt) draft.firstSeenAt = seq
    if (seq > draft.lastTouchedAt) draft.lastTouchedAt = seq
    const serverId = serverIdOf(ref)
    if (serverId !== undefined) draft.serverIds.add(serverId)
    return draft
  }

  /** Count one attributed call's state on the item's operations. */
  private countOperation(draft: ItemDraft, state: ZoteroRowState): void {
    if (state === 'running') draft.operations.running += 1
    else if (state === 'stopped') draft.operations.stopped += 1
    else if (state === 'error') draft.operations.failed += 1
  }

  /** Mark one draft changed and record its index for the view caches. */
  private touchDraft(index: number): void {
    const draft = this.drafts[index]
    if (draft === undefined) return
    draft.version += 1
    this.changeLog.push(index)
  }

  /** Mark a draft reached through an episode's member set. */
  private touchMember(draft: ItemDraft): void {
    const index = this.indexByKey.get(draft.key)
    if (index !== undefined) this.touchDraft(index)
  }

  /** A session-wide scalar aggregate changed with no draft to invalidate. */
  private bumpScalar(): void {
    this.scalarRevision += 1
  }

  private pushEvidence(
    draft: ItemDraft,
    meta: Record<string, unknown>,
    callId: string,
    seq: number,
  ): void {
    const view = retrieveMetaOf(meta)
    // A recognized projection always carries `count` (the byte budget may
    // drop `items` alone); only a fully unusable meta yields no facts.
    if (view.items === null && view.count === null) return
    if (!draft.successfulRetrieveCallIds.has(callId)) {
      draft.successfulRetrieveCallIds.add(callId)
      draft.retrievalSummary = {
        runCount: draft.successfulRetrieveCallIds.size,
        truncated: false,
      }
    }
    if (view.count !== null) {
      draft.facts.reportedEvidenceCount += view.count
    }
    const nextFacts: SourceRetrievalFacts = {
      ...(view.attachmentRef === null ? {} : { attachmentRef: view.attachmentRef }),
      ...(view.attachmentContentType === null
        ? {}
        : { attachmentContentType: view.attachmentContentType }),
      ...(view.coverage === null ? {} : { coverage: view.coverage }),
      truncated: view.truncated === true,
      sourceAvailability: view.sourceAvailability,
    }
    if (draft.retrievalFacts !== undefined) {
      const prev = draft.retrievalFacts
      const mergedAvailability = { ...prev.sourceAvailability }
      for (const [source, entry] of Object.entries(nextFacts.sourceAvailability)) {
        mergedAvailability[source] = entry
      }
      draft.retrievalFacts = {
        // The latest carried values win, so the attachment deep link (with
        // its paired content type) and the coverage line always describe the
        // same retrieve.
        ...(view.attachmentRef === null
          ? prev.attachmentRef !== undefined
            ? {
                attachmentRef: prev.attachmentRef,
                ...(prev.attachmentContentType === undefined
                  ? {}
                  : { attachmentContentType: prev.attachmentContentType }),
              }
            : {}
          : {
              attachmentRef: view.attachmentRef,
              ...(view.attachmentContentType === null
                ? {}
                : { attachmentContentType: view.attachmentContentType }),
            }),
        ...(view.coverage === null
          ? prev.coverage !== undefined
            ? { coverage: prev.coverage }
            : {}
          : { coverage: view.coverage }),
        truncated: prev.truncated || nextFacts.truncated,
        sourceAvailability: mergedAvailability,
      }
    } else {
      draft.retrievalFacts = nextFacts
    }
    if (view.items !== null) {
      for (const item of view.items) {
        const key = evidenceKeyOf(item)
        const existing = draft.evidence.get(key)
        if (existing === undefined) {
          draft.evidence.set(key, {
            passage: {
              source: item.source,
              sourceRef: item.sourceRef,
              text: item.preview,
              previewTruncated: item.previewTruncated,
              ...(item.textFormat === undefined ? {} : { textFormat: item.textFormat }),
              ...(item.artifact === undefined ? {} : { artifact: item.artifact }),
              ...(item.start === undefined || item.end === undefined
                ? {}
                : { start: item.start, end: item.end }),
              ...(item.pageLabel === undefined ? {} : { pageLabel: item.pageLabel }),
              ...(item.attachmentRef === undefined ? {} : { attachmentRef: item.attachmentRef }),
              callIds: [callId],
            },
            seq,
          })
          this.passages += 1
        } else {
          existing.passage.callIds.push(callId)
        }
      }
    }
    // Refresh the truncation flag after the merge, so the latest retrieve's
    // facts are reflected even when this call was already counted. The
    // creation block above guarantees a summary exists by this point.
    draft.retrievalSummary = {
      ...draft.retrievalSummary!,
      truncated: draft.retrievalFacts?.truncated === true,
    }
  }

  /** Fold one block at its transcript position. */
  private fold(block: ToolBlockLike, seq: number): void {
    const state = rowStateOf(block)
    const receipt = receiptOf(block)
    const name = typeof receipt?.tool === 'string' ? receipt.tool : callNameOf(block)
    const args = argsViewOf(block)
    const meta =
      receipt === null
        ? metaOf(block)
        : { ...(isRecord(receipt.facts) ? receipt.facts : {}), ...receipt }

    switch (name) {
      case 'zotero_search': {
        if (state !== 'ok') break
        const view = meta === null ? null : searchMetaOf(meta)
        if (view === null || view.rows === null) break
        const resolvedScope = view.scope
        const resolvedLibrary = view.library
        // The resolved pair overrides the raw args only when both are
        // present, which is exactly what Zotero served for this call.
        const normalized =
          resolvedScope !== null && resolvedLibrary !== null
            ? normalizedSearchOf(args, { resolvedScope, resolvedLibrary })
            : normalizedSearchOf(args)
        const identity = normalized?.identity ?? null
        let episode = this.openSearch
        if (episode === null || identity === null || episode.identity !== identity) {
          episode = {
            identity,
            callId: block.callId,
            ...(normalized?.query === undefined ? {} : { query: normalized.query }),
            mode: normalized?.mode ?? 'metadata',
            scope: normalized?.scope ?? scopeOf(valueArg(args, 'scope')),
            ...(normalized?.occurrenceLibrary === undefined
              ? {}
              : { library: normalized.occurrenceLibrary }),
            itemTypes: normalized?.itemTypes ?? [],
            tags: normalized?.tags ?? [],
            tagMatch: normalized?.tagMatch ?? 'all',
            excludeTags: normalized?.excludeTags ?? [],
            includeTrashed: normalized?.includeTrashed ?? false,
            returned: 0,
            ...(view.total === null ? {} : { total: view.total }),
            ...(view.noteMatches === null ? {} : { noteMatches: view.noteMatches }),
            members: new Set(),
          }
          this.openSearch = episode
        }
        // `returned` is the hits the paged listing returned to the agent. The
        // rows are the byte-budget-bounded presentation projection: they drop
        // hits over the budget and carry note-supplement rows, so they cannot
        // stand in for the hit count when the projection reports one.
        episode.returned += view.returned ?? view.rows.length
        const omitted = view.omitted ?? 0
        if (omitted !== 0) {
          this.omitted += omitted
          this.bumpScalar()
        }
        for (const row of view.rows) {
          const draft = this.draftOf(row.ref, seq)
          draft.title ??= row.title
          draft.creators ??= row.creatorSummary
          draft.year ??= row.year
          if (row.bestAttachmentRef !== undefined && draft.bestAttachment === undefined) {
            draft.bestAttachment = {
              ref: row.bestAttachmentRef,
              ...(row.bestAttachmentType === undefined
                ? {}
                : { contentType: row.bestAttachmentType }),
            }
          }
          // The occurrence is shared by every item its rows surfaced; a
          // repeated row within one episode must not add it twice.
          if (draft.searches[draft.searches.length - 1] !== episode) {
            draft.searches.push(episode)
            episode.members.add(draft)
          }
        }
        // `returned` describes the episode, so a continuation page changes the
        // occurrence of every item the episode already listed, not only the
        // rows this page happened to repeat.
        for (const member of episode.members) this.touchMember(member)
        break
      }
      case 'zotero_get': {
        // The args carry the ref; when they are unusable, the get projection's
        // own ref still attributes the detail.
        const ref = refArgOf(args) ?? (meta === null ? null : (stringField(meta, 'ref') ?? null))
        if (ref === null) break
        const draft = this.draftOf(ref, seq)
        this.countOperation(draft, state)
        if (state !== 'ok' || meta === null) break
        const view = getMetaOf(meta)
        if (view.title === null) break
        // The get projection is richer than a search row: it wins outright.
        draft.title = view.title
        if (view.creators !== null) draft.creators = view.creators
        if (view.venue !== null) draft.venue = view.venue
        if (view.year !== null) draft.year = view.year
        if (view.bestAttachment !== null) draft.bestAttachment = view.bestAttachment
        const attachment = view.resolvedAttachment
        if (attachment?.kind && attachment.contentType)
          draft.attachment = {
            kind: attachment.kind,
            contentType: attachment.contentType,
            title: attachment.title ?? '',
            location: attachment.location ?? '',
            ...(attachment.ref ? { ref: attachment.ref } : {}),
          }
        break
      }
      case 'zotero_get_batch': {
        const view = getBatchMetaOf(meta ?? {}, listArg(args, 'refs'))
        for (const ref of view.attributedRefs) {
          const raw = view.rows?.get(ref)
          const hasOutcome = view.outcomes.has(ref) || raw !== undefined
          if (state === 'ok' && !hasOutcome) continue
          const outcome = view.outcomes.get(ref) ?? (raw?.status === 'error' ? 'error' : 'ok')
          const draft = this.draftOf(ref, seq)
          const itemState = state === 'ok' && outcome === 'error' ? 'error' : state
          this.countOperation(draft, itemState)
          if (state !== 'ok' || itemState !== 'ok' || raw === undefined) continue
          if (raw.title !== null) draft.title = raw.title
          if (raw.creators !== null) draft.creators = raw.creators
          if (raw.venue !== null) draft.venue = raw.venue
          if (raw.year !== null) draft.year = raw.year
          if (raw.bestAttachmentRef !== null) {
            draft.bestAttachment = {
              ref: raw.bestAttachmentRef,
              ...(raw.bestAttachmentType === null ? {} : { contentType: raw.bestAttachmentType }),
            }
          }
        }
        break
      }
      case 'zotero_match_references': {
        if (state !== 'ok') break
        const view = matchReferencesMetaOf(meta ?? {})
        if (view.items === null) break
        for (const item of view.items) {
          for (const candidate of item.selected.length > 0 ? item.selected : item.candidates) {
            const draft = this.draftOf(candidate.ref, seq)
            draft.title = candidate.title
            if (candidate.authors.length > 0) draft.creators = candidate.authors.join(', ')
            if (candidate.venue !== null) draft.venue = candidate.venue
            if (candidate.year !== null) draft.year = candidate.year
          }
        }
        break
      }
      case 'zotero_retrieve': {
        const ref = refArgOf(args)
        if (ref === null) break
        const draft = this.draftOf(ref, seq)
        this.countOperation(draft, state)
        if (state === 'ok' && meta !== null) {
          this.pushEvidence(draft, meta, block.callId, seq)
        }
        break
      }
      case 'zotero_export': {
        if (state !== 'ok') {
          if (state === 'running') this.artifactOperations.running += 1
          else if (state === 'stopped') this.artifactOperations.stopped += 1
          else this.artifactOperations.failed += 1
          this.bumpScalar()
        }
        const metaView = meta === null ? null : exportMetaOf(meta)
        const { refs, refsOmitted } = exportRefsOf(metaView, args)
        if (refs.length === 0) break
        for (const ref of refs) {
          const draft = this.draftOf(ref, seq)
          this.countOperation(draft, state)
        }
        if (state !== 'ok') break
        const text = exportBodyOf(block, meta)
        const resultFile =
          receipt !== null && 'seq' in block ? { seq: block.seq, index: 0 } : undefined
        if (text === '' && resultFile === undefined) break
        const artifact: ExportArtifact = {
          ...(resultFile ? { resultFile } : {}),
          callId: block.callId,
          format: metaView?.format ?? '',
          ...(metaView?.style === null || metaView?.style === undefined
            ? {}
            : { style: metaView.style }),
          ...(metaView?.locale === null || metaView?.locale === undefined
            ? {}
            : { locale: metaView.locale }),
          refs,
          refsOmitted,
          ...(metaView === null || metaView.items.length === 0 ? {} : { items: metaView.items }),
          // The settled result's event time (Unix epoch ms), never a
          // transcript position.
          settledAt: eventTimeOf(block),
          text,
        }
        this.artifacts.push(artifact)
        for (const ref of refs) this.artifactRefs.add(normalizeRefKey(ref))
        for (const ref of refs) {
          const draft = this.drafts[this.indexByKey.get(normalizeRefKey(ref))!]
          if (draft !== undefined && !draft.exportedCallIds.has(block.callId)) {
            draft.exportedCallIds.add(block.callId)
            draft.exports.push(artifact)
            this.touchMember(draft)
          }
        }
        break
      }
      default:
        break
    }
  }
}

/**
 * The workspace's wire window is built by the index directly; the item-level
 * cut lives in `./window` and is shared with the paging endpoint.
 */

/**
 * Build the source workspace in one pass over the session's zotero call
 * blocks. The browser fallback and the specs use this; the host projection
 * keeps a {@link SourceWorkspaceIndex} instead so a long session does not
 * refold its whole log on every event.
 * @param blocks - zotero tool call blocks in transcript order.
 * @param options - the connected instance's Server ID, when known.
 * @returns the aggregated workspace.
 */
export function buildSourceWorkspace(
  blocks: readonly ToolBlockLike[],
  options: BuildSourceWorkspaceOptions = {},
): SourceWorkspace {
  const index = new SourceWorkspaceIndex()
  for (const block of blocks) index.apply(block)
  return index.workspace([], options)
}
