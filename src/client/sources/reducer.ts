/**
 * The session source reducer: turns the session's zotero tool blocks into a
 * {@link SourceWorkspace}. The listed sources are the stable union — every
 * successful search's rows plus every directly referenced item — so viewing
 * one item never shrinks the others, and no search supersedes an earlier
 * one. Facts come only from settled, successful, structurally valid calls;
 * running, failed, and stopped calls count into operations, never into
 * achievements. Pure over the frozen blocks: the same slice builds the same
 * workspace.
 * @module dsh-zotero/client/sources/reducer
 */

import type { ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import {
  argsOf,
  callNameOf,
  isRecord,
  metaOf,
  orderKeyOf,
  resultTextOf,
  rowStateOf,
  stringField,
  type ZoteroRowState,
} from '../presenters.ts'
import {
  attachmentMetaOf,
  exportMetaOf,
  getMetaOf,
  retrieveMetaOf,
  searchMetaOf,
  type ExportMetaView,
} from './decoders.ts'
import type {
  EvidencePassage,
  ExportArtifact,
  OperationFacts,
  SearchProvenance,
  SourceAttachment,
  SourceItem,
  SourceRetrievalFacts,
  SourceScope,
  SourceWorkspace,
} from './model.ts'
import { normalizeRefKey, provenanceOf, serverIdOf } from './provenance.ts'

export interface BuildSourceWorkspaceOptions {
  /** The connected instance's Server ID from the status probe, when known. */
  readonly currentServerId?: string
}

/** One folded logical search: consecutive continuations share one identity. */
interface SearchEpisode {
  readonly identity: string | null
  readonly callId: string
  readonly query?: string
  readonly mode: 'metadata' | 'everything'
  readonly scope: SourceScope
  /** The episode's own filter arguments, normalized at creation. */
  readonly itemTypes: readonly string[]
  readonly tags: readonly string[]
  readonly offset: number
  returned: number
  omitted: number
  readonly keys: Set<string>
}

/** Mutable accumulator shapes; the frozen views come from `model.ts`. */
interface DraftFacts {
  inspected: boolean
  evidenceCount: number
  reportedEvidenceCount: number
  attachmentResolved: boolean
  exportCount: number
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
interface Draft {
  readonly key: string
  readonly ref: string
  readonly serverIds: Set<string>
  title?: string
  creators?: string
  year?: number
  venue?: string
  facts: DraftFacts
  operations: DraftOperations
  evidence: Map<string, EvidenceDraft>
  bestAttachment?: SourceItem['bestAttachment']
  attachment?: SourceAttachment
  retrievalFacts?: SourceRetrievalFacts
  retrievalSummary?: SourceItem['retrievalSummary']
  /** Call ids of the successful, meta-recognizable retrieves (run count). */
  readonly successfulRetrieveCallIds: Set<string>
  exports: ExportArtifact[]
  readonly exportedCallIds: Set<string>
  searches: SearchProvenance[]
  firstSeenAt: number
  lastTouchedAt: number
}

function emptyFacts(): DraftFacts {
  return {
    inspected: false,
    evidenceCount: 0,
    reportedEvidenceCount: 0,
    attachmentResolved: false,
    exportCount: 0,
  }
}

function emptyOperations(): DraftOperations {
  return { running: 0, failed: 0, stopped: 0 }
}

/** The identity of one logical search: query, mode, scope, and filter fields. */
function searchIdentityOf(args: Record<string, unknown> | null): string | null {
  if (args === null) return null
  const query = typeof args['query'] === 'string' ? args['query'] : ''
  const mode = args['mode'] === 'everything' ? 'everything' : 'metadata'
  const itemTypes = normalizedListOf(args['itemTypes'])
  const tags = normalizedListOf(args['tags'])
  const sort = typeof args['sort'] === 'string' ? args['sort'] : ''
  const direction = typeof args['direction'] === 'string' ? args['direction'] : ''
  return JSON.stringify({
    query,
    mode,
    scope: scopeOf(args['scope']),
    itemTypes,
    tags,
    sort,
    direction,
  })
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
  return { kind: 'library' }
}

/** The offset argument of one search call, or the tool default. */
function offsetOf(args: Record<string, unknown> | null): number {
  if (args === null) return 0
  const offset = args['offset']
  return typeof offset === 'number' && Number.isFinite(offset) && offset >= 0 ? offset : 0
}

/** The ref argument of one ref-carrying call; null when absent or unusable. */
function refArgOf(args: Record<string, unknown> | null): string | null {
  if (args === null) return null
  const ref = stringField(args, 'ref')
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
  args: Record<string, unknown> | null,
): { readonly refs: readonly string[]; readonly refsOmitted: number } {
  if (args !== null) {
    const refs = args['refs']
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
function evidenceKeyOf(
  source: string,
  sourceRef: string,
  text: string,
  pageLabel: string | undefined,
): string {
  return `${source}|${sourceRef}|${pageLabel ?? ''}|${text}`
}

/**
 * Build the source workspace from the session's zotero call blocks.
 * @param blocks - zotero tool call blocks in transcript order.
 * @param options - the connected instance's Server ID, when known.
 * @returns the aggregated workspace.
 */
export function buildSourceWorkspace(
  blocks: readonly ToolCallBlock[],
  options: BuildSourceWorkspaceOptions = {},
): SourceWorkspace {
  const byKey = new Map<string, Draft>()
  const exports: ExportArtifact[] = []
  const episodes: SearchEpisode[] = []
  let lastEpisode: SearchEpisode | null = null
  const exportOperations: DraftOperations = emptyOperations()
  let omittedRows = 0

  const draftOf = (ref: string, seq: number): Draft => {
    const key = normalizeRefKey(ref)
    let draft = byKey.get(key)
    if (draft === undefined) {
      draft = {
        key,
        ref,
        serverIds: new Set(),
        facts: emptyFacts(),
        operations: emptyOperations(),
        evidence: new Map(),
        exports: [],
        exportedCallIds: new Set(),
        successfulRetrieveCallIds: new Set(),
        searches: [],
        firstSeenAt: seq,
        lastTouchedAt: seq,
      }
      byKey.set(key, draft)
    }
    draft.firstSeenAt = Math.min(draft.firstSeenAt, seq)
    draft.lastTouchedAt = Math.max(draft.lastTouchedAt, seq)
    const serverId = serverIdOf(ref)
    if (serverId !== undefined) draft.serverIds.add(serverId)
    return draft
  }

  /** Count one attributed call's state on the item's operations. */
  const countOperation = (draft: Draft, state: ZoteroRowState): void => {
    if (state === 'running') draft.operations.running += 1
    else if (state === 'stopped') draft.operations.stopped += 1
    else if (state === 'error') draft.operations.failed += 1
  }

  /**
   * The event time of a settled block. `rowStateOf` maps kind-less blocks
   * to 'running', so every caller reaches here only with a tool result —
   * the cast documents what the state check already proved.
   */
  const eventTimeOf = (block: ToolCallBlock): number => (block as ToolResultNode).time

  const pushEvidence = (
    draft: Draft,
    meta: Record<string, unknown>,
    callId: string,
    seq: number,
    time: number,
  ): void => {
    const view = retrieveMetaOf(meta)
    // A recognized projection always carries `count` (the byte budget may
    // drop `items` alone); only a fully unusable meta yields no facts.
    if (view.items === null && view.count === null) return
    if (!draft.successfulRetrieveCallIds.has(callId)) {
      draft.successfulRetrieveCallIds.add(callId)
      draft.retrievalSummary = {
        runCount: draft.successfulRetrieveCallIds.size,
        latestCallId: callId,
        latestRetrievedAt: time,
        keptPassageCount: 0,
        reportedPassageCount: 0,
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
        const key = evidenceKeyOf(item.source, item.sourceRef, item.preview, item.pageLabel)
        const existing = draft.evidence.get(key)
        if (existing === undefined) {
          draft.evidence.set(key, {
            passage: {
              source: item.source,
              sourceRef: item.sourceRef,
              text: item.preview,
              previewTruncated: item.previewTruncated,
              ...(item.pageLabel === undefined ? {} : { pageLabel: item.pageLabel }),
              ...(item.attachmentRef === undefined ? {} : { attachmentRef: item.attachmentRef }),
              callIds: [callId],
            },
            seq,
          })
        } else {
          existing.passage.callIds.push(callId)
        }
      }
      draft.facts.evidenceCount = draft.evidence.size
    }
    // Refresh the summary's derived counters after the merge, so the latest
    // retrieve's facts are reflected even when this call was already counted.
    // The creation block above guarantees a summary exists by this point.
    draft.retrievalSummary = {
      ...draft.retrievalSummary!,
      keptPassageCount: draft.evidence.size,
      reportedPassageCount: draft.facts.reportedEvidenceCount,
      truncated: draft.retrievalFacts?.truncated === true,
    }
  }

  for (const block of blocks) {
    const seq = orderKeyOf(block)
    const state = rowStateOf(block)
    const name = callNameOf(block)
    const args = argsOf(block)
    const meta = metaOf(block)

    switch (name) {
      case 'zotero_search': {
        if (state !== 'ok') break
        const view = meta === null ? null : searchMetaOf(meta)
        if (view === null || view.rows === null) break
        const identity = searchIdentityOf(args)
        if (lastEpisode === null || identity === null || lastEpisode.identity !== identity) {
          lastEpisode = {
            identity,
            callId: block.callId,
            ...(typeof args?.['query'] === 'string' && args['query'] !== ''
              ? { query: args['query'] }
              : {}),
            mode: args?.['mode'] === 'everything' ? 'everything' : 'metadata',
            scope: scopeOf(args?.['scope']),
            itemTypes: normalizedListOf(args?.['itemTypes']),
            tags: normalizedListOf(args?.['tags']),
            offset: offsetOf(args),
            returned: 0,
            omitted: 0,
            keys: new Set(),
          }
          episodes.push(lastEpisode)
        }
        lastEpisode.returned += view.rows.length
        lastEpisode.omitted += view.omitted ?? 0
        for (const row of view.rows) {
          const draft = draftOf(row.ref, seq)
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
          lastEpisode.keys.add(draft.key)
        }
        break
      }
      case 'zotero_get': {
        // The args carry the ref; when they are unusable, the get projection's
        // own ref still attributes the detail.
        const ref = refArgOf(args) ?? (meta === null ? null : (stringField(meta, 'ref') ?? null))
        if (ref === null) break
        const draft = draftOf(ref, seq)
        countOperation(draft, state)
        if (state !== 'ok' || meta === null) break
        const view = getMetaOf(meta)
        if (view.title === null) break
        draft.facts.inspected = true
        // The get projection is richer than a search row: it wins outright.
        draft.title = view.title
        if (view.creators !== null) draft.creators = view.creators
        if (view.venue !== null) draft.venue = view.venue
        if (view.year !== null) draft.year = view.year
        if (view.bestAttachment !== null) draft.bestAttachment = view.bestAttachment
        break
      }
      case 'zotero_retrieve': {
        const ref = refArgOf(args)
        if (ref === null) break
        const draft = draftOf(ref, seq)
        countOperation(draft, state)
        if (state === 'ok' && meta !== null) {
          pushEvidence(draft, meta, block.callId, seq, eventTimeOf(block))
        }
        break
      }
      case 'zotero_attachment': {
        const ref = refArgOf(args)
        if (ref === null) break
        const draft = draftOf(ref, seq)
        countOperation(draft, state)
        if (state !== 'ok' || meta === null) break
        const view = attachmentMetaOf(meta)
        if (view.kind === null || view.contentType === null) break
        draft.facts.attachmentResolved = true
        draft.attachment = {
          kind: view.kind,
          contentType: view.contentType,
          title: view.title ?? '',
          location: view.location ?? '',
          ...(view.ref === null ? {} : { ref: view.ref }),
        }
        break
      }
      case 'zotero_export': {
        if (state !== 'ok') {
          if (state === 'running') exportOperations.running += 1
          else if (state === 'stopped') exportOperations.stopped += 1
          else exportOperations.failed += 1
        }
        const metaView = meta === null ? null : exportMetaOf(meta)
        const { refs, refsOmitted } = exportRefsOf(metaView, args)
        if (refs.length === 0) break
        for (const ref of refs) {
          const draft = draftOf(ref, seq)
          countOperation(draft, state)
        }
        if (state !== 'ok') break
        const text = (resultTextOf(block) ?? '').trimStart()
        if (text === '') break
        const artifact: ExportArtifact = {
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
        exports.push(artifact)
        for (const ref of refs) {
          const draft = byKey.get(normalizeRefKey(ref))
          if (draft !== undefined && !draft.exportedCallIds.has(block.callId)) {
            draft.exportedCallIds.add(block.callId)
            draft.facts.exportCount += 1
            draft.exports.push(artifact)
          }
        }
        break
      }
      default:
        break
    }
  }

  // Attribute each folded search to the items its rows surfaced, then freeze.
  for (const episode of episodes) {
    omittedRows += episode.omitted
    const provenance: SearchProvenance = {
      callId: episode.callId,
      ...(episode.query === undefined ? {} : { query: episode.query }),
      mode: episode.mode,
      scope: episode.scope,
      itemTypes: episode.itemTypes,
      tags: episode.tags,
    }
    for (const key of episode.keys) {
      // Every episode key entered through `draftOf`, so the draft exists.
      byKey.get(key)!.searches.push(provenance)
    }
  }

  const currentServerId = options.currentServerId
  const sources: SourceItem[] = [...byKey.values()]
    .sort((a, b) => a.firstSeenAt - b.firstSeenAt)
    .map((draft) => {
      const evidence = [...draft.evidence.values()]
        .sort((a, b) => a.seq - b.seq)
        .map((entry) => entry.passage)
      return {
        key: draft.key,
        ref: draft.ref,
        provenance: provenanceOf(draft.serverIds, currentServerId),
        ...(draft.title === undefined ? {} : { title: draft.title }),
        ...(draft.creators === undefined ? {} : { creators: draft.creators }),
        ...(draft.year === undefined ? {} : { year: draft.year }),
        ...(draft.venue === undefined ? {} : { venue: draft.venue }),
        facts: draft.facts,
        operations: draft.operations,
        searches: draft.searches,
        evidence,
        ...(draft.bestAttachment === undefined ? {} : { bestAttachment: draft.bestAttachment }),
        ...(draft.attachment === undefined ? {} : { attachment: draft.attachment }),
        ...(draft.retrievalFacts === undefined ? {} : { retrievalFacts: draft.retrievalFacts }),
        ...(draft.retrievalSummary === undefined
          ? {}
          : { retrievalSummary: draft.retrievalSummary }),
        exports: draft.exports,
        firstSeenAt: draft.firstSeenAt,
        lastTouchedAt: draft.lastTouchedAt,
      }
    })

  return {
    sources,
    exports,
    exportOperations,
    omittedRows,
  }
}
