/**
 * The `zotero_retrieve` domain: one item's annotations, notes, abstract, and
 * full-text chunks ranked as a single BM25 passage corpus, with per-passage
 * attachment provenance under the multi-attachment policies.
 * @module dsh-zotero/local/retrieve
 */

import type { ZoteroHttpClient } from '../http-client.js'
import { mapWithConcurrency } from '../concurrency.js'
import { ZOTERO_GRAPH_CONCURRENCY } from '../constants.js'
import {
  isNotFoundError,
  NO_FULLTEXT_MESSAGE,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_NO_FULLTEXT,
  ZoteroError,
} from '../errors.js'
import { chunkText, rankChunks, tokenize } from '../evidence.js'
import { asRecord, asString } from '../json.js'
import { selectAttachments, bestAttachmentFromLinks } from '../attachments.js'
import { formatRef, libraryPrefix, refForLibrary, requireSupportedLocalRef } from '../refs.js'
import {
  partitionChildren,
  plainNoteText,
  truncateText,
  type PartitionedChildren,
  type ZoteroChildKind,
} from '../normalize.js'
import { loadChildRows } from './detail.js'
import type { LocalApiLimits } from './limits.js'
import type {
  SupportedLocalLibrary,
  ZoteroCoverage,
  ZoteroEvidence,
  ZoteroEvidenceSource,
  ZoteroFulltextPayload,
  ZoteroObjectRef,
  ZoteroRetrieveRequest,
  ZoteroRetrieveResult,
} from '../types.js'

/** The order `sourcesSkipped` reports in; stable regardless of the request order. */
const SOURCE_ORDER: readonly ZoteroEvidenceSource[] = ['annotation', 'note', 'abstract', 'fulltext']

/**
 * Full-text indexing coverage as reported by Zotero. `complete` is derived
 * per axis: the chars axis (text files) and the pages axis (PDFs) each count
 * as complete when the server reports both sides and they agree; the overall
 * answer is complete when at least one axis is reportable and every
 * reportable axis agrees. Anything else is an incomplete answer, never a
 * guess — so a full PDF index without char counts still reads complete.
 */
function normalizeCoverage(payload: ZoteroFulltextPayload): ZoteroCoverage {
  const indexedChars = typeof payload.indexedChars === 'number' ? payload.indexedChars : undefined
  const totalChars = typeof payload.totalChars === 'number' ? payload.totalChars : undefined
  const indexedPages = typeof payload.indexedPages === 'number' ? payload.indexedPages : undefined
  const totalPages = typeof payload.totalPages === 'number' ? payload.totalPages : undefined
  const charsComplete =
    indexedChars !== undefined && totalChars !== undefined ? indexedChars === totalChars : undefined
  const pagesComplete =
    indexedPages !== undefined && totalPages !== undefined ? indexedPages === totalPages : undefined
  const axes = [charsComplete, pagesComplete].filter(
    (value): value is boolean => value !== undefined,
  )
  const complete = axes.length > 0 && axes.every((value) => value)
  return {
    ...(indexedPages !== undefined ? { indexedPages } : {}),
    ...(totalPages !== undefined ? { totalPages } : {}),
    ...(indexedChars !== undefined ? { indexedChars } : {}),
    ...(totalChars !== undefined ? { totalChars } : {}),
    complete,
  }
}

/**
 * Gather ranked evidence for one item: annotations, notes, the abstract,
 * and full-text chunks are scored as one passage corpus with BM25. Fetch
 * stays lazy — children only when annotation/note sources (or a PDF
 * fallback) need them, fulltext only when requested (started concurrently
 * with children when the parent carries the attachment link). Annotations
 * live under each attachment, so annotation sources walk the graph's
 * second level and rank every attachment's annotations as one corpus; each
 * passage keeps its own attachment provenance. The `attachmentPolicy`
 * picks the fulltext sources: `best` (default) keeps Zotero's single
 * choice, `allIndexed` ranks every PDF child, and `specified` ranks the
 * named attachments — multi-attachment results speak through per-passage
 * refs instead of a result-level attachment. A note item's own body is its
 * note source; child notes contribute every chunk of their full text, so
 * long notes rank beyond their first chunk. Sources the item cannot
 * provide are skipped and reported in `sourcesSkipped` — retrieval degrades
 * instead of failing. Passage count and character budgets are enforced
 * with the `truncated` flag, never by silently editing passage text.
 */
export async function retrieve(
  deps: { client: ZoteroHttpClient; limits: LocalApiLimits },
  request: ZoteroRetrieveRequest,
  signal?: AbortSignal,
): Promise<ZoteroRetrieveResult> {
  const policy = request.attachmentPolicy ?? 'best'
  if (policy === 'specified' && (request.attachmentRefs?.length ?? 0) === 0) {
    throw new ZoteroError(
      'attachmentPolicy "specified" requires at least one attachmentRef.',
      ZOTERO_INVALID_ARGUMENT,
    )
  }
  const ref = requireSupportedLocalRef(request.ref, ['item'])
  const prefix = libraryPrefix(ref.library as SupportedLocalLibrary)
  const parent = await deps.client.getJson<unknown>(`${prefix}/items/${ref.key}`, undefined, {
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
  // needed for annotation sources, the PDF fallback, or an allIndexed scan.
  const isNoteItem = itemType === 'note'
  const needsChildrenForFulltext =
    wantsFulltext &&
    (policy === 'allIndexed' || (policy === 'best' && linkAttachment === undefined))
  const fetchChildren = wantsAnnotations || (wantsNotes && !isNoteItem) || needsChildrenForFulltext
  // Children and a linked fulltext are independent once the parent has
  // arrived; start both before awaiting either. The noop handler keeps a
  // fulltext rejection that lands while children are still in flight from
  // being reported as unhandled before the try below awaits it.
  const bestFulltextKey = wantsFulltext && policy === 'best' ? linkAttachment?.key : undefined
  const fulltextPromise =
    bestFulltextKey === undefined
      ? undefined
      : fetchFulltext(deps, bestFulltextKey, ref.library as SupportedLocalLibrary, serverId, signal)
  fulltextPromise?.catch(() => {})
  let childrenRows: readonly unknown[] = []
  if (fetchChildren) {
    childrenRows = (
      await loadChildRows(
        deps,
        ref.key,
        ref.library as SupportedLocalLibrary,
        serverId,
        signal,
        wantsAnnotations,
      )
    ).rows
  }

  const skipped: ZoteroEvidenceSource[] = []
  let fulltextWasCut = false
  let attachmentRef: string | undefined
  let attachmentContentType: string | undefined
  let coverage: ZoteroCoverage | undefined
  const passages: {
    source: ZoteroEvidenceSource
    sourceRef: string
    text: string
    chunkIndex?: number
    chunkCount?: number
    comment?: string
    pageLabel?: string
    attachmentRef?: string
  }[] = []
  if (wantsFulltext && policy === 'best') {
    let attachmentKey = bestFulltextKey
    // The link arm reports Zotero's own type (possibly empty); the child
    // fallback selects an application/pdf candidate whose type is known.
    let selectedContentType = linkAttachment?.contentType
    if (attachmentKey === undefined) {
      const pdf = selectAttachments(childrenRows, 'pdf')[0]
      if (pdf === undefined) skipped.push('fulltext')
      else {
        attachmentKey = pdf.key
        selectedContentType = pdf.contentType
      }
    }
    if (attachmentKey !== undefined) {
      try {
        attachmentRef = formatRef(
          refForLibrary(
            ref.library as SupportedLocalLibrary,
            'attachment',
            attachmentKey,
            serverId,
          ),
        )
        if (selectedContentType !== undefined && selectedContentType !== '') {
          attachmentContentType = selectedContentType
        }
        const payload = await (fulltextPromise ??
          fetchFulltext(
            deps,
            attachmentKey,
            ref.library as SupportedLocalLibrary,
            serverId,
            signal,
          ))
        const content = typeof payload.content === 'string' ? payload.content : ''
        const bounded = truncateText(content, deps.limits.maxFulltextChars)
        fulltextWasCut = bounded.truncated
        const chunks = chunkText(
          bounded.text,
          deps.limits.fulltextChunkWords,
          deps.limits.maxEvidenceChars,
        )
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
  } else if (wantsFulltext) {
    // Multi-attachment policies: every selected PDF is a first-class
    // source, and each passage carries its own attachment provenance.
    let candidates: { key: string; contentType?: string }[]
    if (policy === 'allIndexed') {
      candidates = selectAttachments(childrenRows, 'pdf').map((candidate) => ({
        key: candidate.key,
        contentType: candidate.contentType,
      }))
    } else {
      candidates = await mapWithConcurrency(
        request.attachmentRefs!,
        ZOTERO_GRAPH_CONCURRENCY,
        async (wanted): Promise<{ key: string; contentType?: string }> => {
          const row = await deps.client.getJson<unknown>(
            `${prefix}/items/${wanted.key}`,
            undefined,
            { signal, serverId },
          )
          const rowData = asRecord(asRecord(row.json)?.data)
          const rowType = asString(rowData?.itemType)
          if (rowType !== undefined && rowType !== 'attachment') {
            throw new ZoteroError(
              `Attachment ref ${wanted.key} names a ${rowType}, not an attachment.`,
              ZOTERO_INVALID_ARGUMENT,
            )
          }
          return { key: wanted.key, contentType: asString(rowData?.contentType) }
        },
      )
    }
    if (candidates.length === 0) {
      skipped.push('fulltext')
    } else {
      const fetched = await mapWithConcurrency(
        candidates,
        ZOTERO_GRAPH_CONCURRENCY,
        async (candidate) => {
          try {
            return {
              candidate,
              payload: await fetchFulltext(
                deps,
                candidate.key,
                ref.library as SupportedLocalLibrary,
                serverId,
                signal,
              ),
            }
          } catch (error) {
            // An unindexed member of the set degrades alone; only an
            // entirely unindexed set reads as a skipped source.
            if (error instanceof ZoteroError && error.code === ZOTERO_NO_FULLTEXT) {
              return { candidate, payload: undefined }
            }
            throw error
          }
        },
      )
      const indexed = fetched.filter(
        (entry): entry is typeof entry & { payload: ZoteroFulltextPayload } =>
          entry.payload !== undefined,
      )
      if (indexed.length === 0) skipped.push('fulltext')
      for (const { candidate, payload } of indexed) {
        const passageAttachmentRef = formatRef(
          refForLibrary(
            ref.library as SupportedLocalLibrary,
            'attachment',
            candidate.key,
            serverId,
          ),
        )
        const content = typeof payload.content === 'string' ? payload.content : ''
        const bounded = truncateText(content, deps.limits.maxFulltextChars)
        fulltextWasCut = fulltextWasCut || bounded.truncated
        const chunks = chunkText(
          bounded.text,
          deps.limits.fulltextChunkWords,
          deps.limits.maxEvidenceChars,
        )
        for (const chunk of chunks) {
          passages.push({
            source: 'fulltext',
            sourceRef: passageAttachmentRef,
            text: chunk.text,
            chunkIndex: chunk.index,
            chunkCount: chunks.length,
          })
        }
      }
      // Result-level provenance stays unambiguous: with exactly one
      // contributing attachment it names that file; with several, the
      // per-passage refs carry the mapping.
      if (indexed.length === 1) {
        const { candidate, payload } = indexed[0]!
        attachmentRef = formatRef(
          refForLibrary(
            ref.library as SupportedLocalLibrary,
            'attachment',
            candidate.key,
            serverId,
          ),
        )
        if (candidate.contentType !== undefined && candidate.contentType !== '') {
          attachmentContentType = candidate.contentType
        }
        coverage = normalizeCoverage(payload)
      }
    }
  }

  const partitioned: PartitionedChildren = fetchChildren
    ? partitionChildren(
        childrenRows,
        { library: ref.library as SupportedLocalLibrary, serverId },
        undefined,
        new Set<ZoteroChildKind>([
          ...(wantsNotes ? (['note'] as const) : []),
          ...(wantsAnnotations ? (['annotation'] as const) : []),
        ]),
      )
    : { notes: [], annotations: [], attachments: [] }
  if (wantsAnnotations) {
    if (partitioned.annotations.length === 0) skipped.push('annotation')
    for (const annotation of partitioned.annotations) {
      passages.push({
        source: 'annotation',
        sourceRef: annotation.ref,
        text: annotation.text,
        ...(annotation.comment !== undefined ? { comment: annotation.comment } : {}),
        ...(annotation.pageLabel !== undefined ? { pageLabel: annotation.pageLabel } : {}),
        ...(annotation.parentRef === undefined ? {} : { attachmentRef: annotation.parentRef }),
      })
    }
  }
  if (wantsNotes) {
    const noteRef = formatRef(
      refForLibrary(ref.library as SupportedLocalLibrary, 'item', ref.key, serverId),
    )
    const noteSources: { ref: string; text: string }[] = isNoteItem
      ? [{ ref: noteRef, text: plainNoteText(data?.note) }]
      : partitioned.notes.map((note) => ({ ref: note.ref, text: note.text }))
    // A note item's own body is its note source, so only a non-note item
    // without child notes cannot provide the source.
    if (!isNoteItem && partitioned.notes.length === 0) skipped.push('note')
    for (const note of noteSources) {
      const chunks = chunkText(
        note.text,
        deps.limits.fulltextChunkWords,
        deps.limits.maxEvidenceChars,
      )
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
      const bounded = truncateText(raw, deps.limits.maxEvidenceChars)
      abstractWasCut = bounded.truncated
      passages.push({
        source: 'abstract',
        sourceRef: formatRef(
          refForLibrary(ref.library as SupportedLocalLibrary, 'item', ref.key, serverId),
        ),
        text: bounded.text,
      })
    } else {
      skipped.push('abstract')
    }
  }

  const ranked = rankChunks(
    request.query,
    passages.map((passage, index) => ({ text: passage.text, index })),
  )
  // Zero-score passages share nothing with the query; returning them as
  // "evidence" would present arbitrary excerpts as matches. A query with no
  // token overlap therefore yields an empty evidence array, which the
  // contract reads as "no match", not "no content".
  const matched = ranked.filter((entry) => entry.score > 0)
  const evidence: ZoteroEvidence[] = []
  let used = 0
  let truncated = matched.length > request.passages || fulltextWasCut || abstractWasCut
  for (const entry of matched.slice(0, request.passages)) {
    const passage = passages[entry.index]!
    if (used + passage.text.length > deps.limits.maxEvidenceChars) {
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
      ...(passage.attachmentRef !== undefined ? { attachmentRef: passage.attachmentRef } : {}),
    })
  }
  // A stable report order keeps the contract predictable: the sources the
  // caller asked for but the item could not provide, deduplicated.
  const sourcesSkipped = [...new Set(skipped)].sort(
    (a, b) => SOURCE_ORDER.indexOf(a) - SOURCE_ORDER.indexOf(b),
  )
  return {
    ref: formatRef(refForLibrary(ref.library as SupportedLocalLibrary, 'item', ref.key, serverId)),
    ...(attachmentRef !== undefined ? { attachmentRef } : {}),
    ...(attachmentContentType !== undefined ? { attachmentContentType } : {}),
    ...(coverage !== undefined ? { coverage } : {}),
    evidence,
    truncated,
    sourcesSkipped,
  }
}

async function fetchFulltext(
  deps: { client: ZoteroHttpClient },
  attachmentKey: string,
  library: SupportedLocalLibrary,
  serverId: string | undefined,
  signal: AbortSignal | undefined,
): Promise<ZoteroFulltextPayload> {
  try {
    const prefix = libraryPrefix(library)
    const response = await deps.client.getJson<ZoteroFulltextPayload>(
      `${prefix}/items/${attachmentKey}/fulltext`,
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
