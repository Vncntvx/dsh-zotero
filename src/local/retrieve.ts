/**
 * The `zotero_retrieve` domain: one item's annotations, notes, abstract, and
 * full-text chunks ranked as a single BM25 passage corpus, with per-passage
 * attachment provenance under the multi-attachment policies. An annotation
 * ranks on its highlight and the reader's comment together, and reports which
 * of the two matched; notes, the abstract, and full-text chunks rank on their
 * own text.
 * @module dsh-zotero/local/retrieve
 */

import type { ZoteroHttpClient } from '../http-client.js'
import { mapWithConcurrency } from '../concurrency.js'
import { ZOTERO_GRAPH_CONCURRENCY, ZOTERO_RETRIEVE_ATTACHMENT_CAP } from '../constants.js'
import {
  isNotFoundError,
  NO_FULLTEXT_MESSAGE,
  SERVER_MISMATCH_MESSAGE,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_NO_FULLTEXT,
  ZOTERO_SERVER_MISMATCH,
  ZoteroError,
} from '../errors.js'
import { chunkText, rankChunks, tokenize, type EvidenceChunk } from '../evidence.js'
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
  ZoteroEvidenceField,
  ZoteroEvidenceSource,
  ZoteroFulltextPayload,
  ZoteroObjectRef,
  ZoteroRetrieveAttachment,
  ZoteroRetrieveAttachmentStatus,
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
 * refs instead of a result-level attachment. A named attachment is only
 * read once its ref is proven to describe an attachment of *this* item on
 * *this* instance: the same key in another library or another Zotero
 * database names a different object, and its text is not this item's
 * evidence. A note item's own body is its
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
      await loadChildRows(deps, ref.key, ref.library as SupportedLocalLibrary, serverId, signal, {
        // Full-text fallback and note sources still read the bare listing;
        // annotations ride their own filtered contract.
        direct: true,
        annotations: wantsAnnotations,
      })
    ).rows
  }

  const skipped: ZoteroEvidenceSource[] = []
  let fulltextWasCut = false
  let attachmentRef: string | undefined
  let attachmentContentType: string | undefined
  let coverage: ZoteroCoverage | undefined
  let attachments: ZoteroRetrieveAttachment[] | undefined
  const passages: {
    source: ZoteroEvidenceSource
    sourceRef: string
    text: string
    chunkIndex?: number
    chunkCount?: number
    comment?: string
    pageLabel?: string
    attachmentRef?: string
    /** The text ranking scores, when it differs from the text returned. */
    rankText?: string
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
      // One attachment contributes once: the same text entering the corpus
      // twice would read as two sources agreeing with each other. The set is
      // taken before the cap so a list that repeats one ref is not rejected
      // as if it named many.
      const distinct = new Map<string, ZoteroObjectRef>()
      for (const attachmentRef of request.attachmentRefs!) {
        const identity = `${attachmentRef.library.type}/${attachmentRef.library.id}/${attachmentRef.key}?${attachmentRef.serverId ?? ''}`
        if (!distinct.has(identity)) distinct.set(identity, attachmentRef)
      }
      if (distinct.size > ZOTERO_RETRIEVE_ATTACHMENT_CAP) {
        throw new ZoteroError(
          `attachmentRefs lists ${distinct.size} attachments; at most ${ZOTERO_RETRIEVE_ATTACHMENT_CAP} can enter one ranking — split the work across calls.`,
          ZOTERO_INVALID_ARGUMENT,
        )
      }
      candidates = await mapWithConcurrency(
        [...distinct.values()],
        ZOTERO_GRAPH_CONCURRENCY,
        async (wanted, poolSignal): Promise<{ key: string; contentType?: string }> => {
          // The ref is a claim about where this text comes from. Reading a
          // same-key object out of the wrong library or the wrong database
          // would attach a stranger's words to this item, so the claim is
          // checked against the ref itself before any read, and against the
          // object's own answer after it.
          if (wanted.library.type !== ref.library.type || wanted.library.id !== ref.library.id) {
            throw new ZoteroError(
              `Attachment ref ${wanted.key} belongs to library ${wanted.library.type}/${wanted.library.id}, not to ${ref.library.type}/${ref.library.id}. Full text entering this item's evidence must come from this item's own library.`,
              ZOTERO_INVALID_ARGUMENT,
            )
          }
          if (wanted.serverId !== undefined && wanted.serverId !== serverId) {
            throw new ZoteroError(SERVER_MISMATCH_MESSAGE, ZOTERO_SERVER_MISMATCH)
          }
          const row = await deps.client.getJson<unknown>(
            `${prefix}/items/${wanted.key}`,
            undefined,
            { signal: poolSignal, serverId },
          )
          const rowData = asRecord(asRecord(row.json)?.data)
          const rowType = asString(rowData?.itemType)
          const parentKey = asString(rowData?.parentItem)
          if (rowType !== 'attachment') {
            throw new ZoteroError(
              rowType === undefined
                ? `Attachment ref ${wanted.key} cannot be proven an attachment: Zotero's answer named no item type for it, so nothing rules out a bibliographic item. Read the item's children with zotero_children and name an attachment ref from there.`
                : `Attachment ref ${wanted.key} names a ${rowType}, not an attachment.`,
              ZOTERO_INVALID_ARGUMENT,
            )
          }
          if (parentKey !== ref.key) {
            throw new ZoteroError(
              parentKey === undefined
                ? `Attachment ref ${wanted.key} is a top-level attachment with no parent item, so its text is not evidence for ${ref.key}.`
                : `Attachment ref ${wanted.key} is attached to item ${parentKey}, not to ${ref.key}; its text would be another work's evidence. Read this item's children with zotero_children to get refs that belong to it.`,
              ZOTERO_INVALID_ARGUMENT,
            )
          }
          return { key: wanted.key, contentType: asString(rowData?.contentType) }
        },
        { signal },
      )
    }
    // An `allIndexed` selection can repeat a key only if the listing did; the
    // set is taken for both policies so no attachment enters the corpus twice.
    const unique = new Map<string, { key: string; contentType?: string }>()
    for (const candidate of candidates) {
      if (!unique.has(candidate.key)) unique.set(candidate.key, candidate)
    }
    candidates = [...unique.values()]
    if (candidates.length === 0) {
      skipped.push('fulltext')
    } else {
      const sources = await readFulltextSources(deps, ref, serverId, candidates, signal)
      const indexed = sources.filter(
        (source): source is Extract<FulltextSource, { status: 'indexed' }> =>
          source.status === 'indexed',
      )
      if (indexed.length === 0) skipped.push('fulltext')
      for (const source of indexed) {
        const passageAttachmentRef = formatRef(
          refForLibrary(ref.library as SupportedLocalLibrary, 'attachment', source.key, serverId),
        )
        fulltextWasCut = fulltextWasCut || source.inputTruncated
        for (const chunk of source.chunks) {
          passages.push({
            source: 'fulltext',
            sourceRef: passageAttachmentRef,
            text: chunk.text,
            chunkIndex: chunk.index,
            chunkCount: source.chunks.length,
          })
        }
      }
      attachments = sources.map((source) => ({
        ref: formatRef(
          refForLibrary(ref.library as SupportedLocalLibrary, 'attachment', source.key, serverId),
        ),
        ...(source.contentType === undefined || source.contentType === ''
          ? {}
          : { contentType: source.contentType }),
        ...attachmentFactOf(source),
      }))
      // Result-level provenance stays unambiguous: with exactly one
      // contributing attachment it names that file; with several, the
      // per-passage refs carry the mapping.
      if (indexed.length === 1) {
        const source = indexed[0]!
        attachmentRef = formatRef(
          refForLibrary(ref.library as SupportedLocalLibrary, 'attachment', source.key, serverId),
        )
        if (source.contentType !== undefined && source.contentType !== '') {
          attachmentContentType = source.contentType
        }
        coverage = source.coverage
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
        // A reader's comment is part of what the annotation says about the
        // paper — "the method looks biased here" is a finding in its own
        // right, and a highlight whose words say nothing about it must still
        // be findable by the comment's terms. Both fields rank; the evidence
        // keeps them apart and names the one that matched.
        ...(annotation.comment === undefined
          ? {}
          : { rankText: `${annotation.text}\n${annotation.comment}` }),
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
    passages.map((passage, index) => ({ text: passage.rankText ?? passage.text, index })),
  )
  // Zero-score passages share nothing with the query; returning them as
  // "evidence" would present arbitrary excerpts as matches. A query with no
  // token overlap therefore yields an empty evidence array, which the
  // contract reads as "no match", not "no content".
  const matched = ranked.filter((entry) => entry.score > 0)
  const queryTerms = new Set(tokenize(request.query))
  const evidence: ZoteroEvidence[] = []
  let used = 0
  let truncated = matched.length > request.passages || fulltextWasCut || abstractWasCut
  for (const entry of matched.slice(0, request.passages)) {
    const passage = passages[entry.index]!
    // The budget charges every character the passage puts in front of the
    // model: the text and, for an annotation, its comment. Charging only the
    // text let a long comment ride in above the configured bound.
    const charged = passage.text.length + (passage.comment?.length ?? 0)
    if (used + charged > deps.limits.maxEvidenceChars) {
      truncated = true
      break
    }
    used += charged
    const matchedFields = matchedFieldsOf(queryTerms, passage)
    evidence.push({
      source: passage.source,
      sourceRef: passage.sourceRef,
      text: passage.text,
      ...(passage.chunkIndex !== undefined ? { chunkIndex: passage.chunkIndex } : {}),
      ...(passage.chunkCount !== undefined ? { chunkCount: passage.chunkCount } : {}),
      ...(passage.comment !== undefined ? { comment: passage.comment } : {}),
      ...(passage.pageLabel !== undefined ? { pageLabel: passage.pageLabel } : {}),
      ...(passage.attachmentRef !== undefined ? { attachmentRef: passage.attachmentRef } : {}),
      ...(matchedFields !== undefined ? { matchedFields } : {}),
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
    ...(attachments !== undefined ? { attachments } : {}),
    evidence,
    truncated,
    sourcesSkipped,
  }
}

/**
 * One full-text source of a retrieval and what reading it produced. The arms
 * carry exactly what their status can prove: an indexed source has Zotero's
 * coverage facts, its accepted chunks and whether this call's budget cut it;
 * an unindexed or unread one has nothing to report beyond the fact that it
 * contributed no text. The fetched payload is read in the worker and not
 * kept — the chunks are what survives, so a large body is released instead of
 * being held until the ranking pass.
 */
type FulltextSource = {
  readonly key: string
  readonly contentType?: string
} & (
  | {
      readonly status: 'indexed'
      readonly coverage: ZoteroCoverage
      readonly inputTruncated: boolean
      readonly chunks: readonly EvidenceChunk[]
    }
  | { readonly status: 'unindexed' }
  | { readonly status: 'unread' }
)

/**
 * The per-source fact a result reports for one considered attachment: an
 * indexed source carries what it gave, the others carry only their status,
 * which is itself the finding ("Zotero's index has no text for this file" /
 * "this call did not read it").
 */
function attachmentFactOf(source: FulltextSource): {
  status: ZoteroRetrieveAttachmentStatus
  coverage?: ZoteroCoverage
  inputTruncated?: boolean
  passages?: number
} {
  if (source.status !== 'indexed') return { status: source.status }
  return {
    status: 'indexed',
    coverage: source.coverage,
    inputTruncated: source.inputTruncated,
    passages: source.chunks.length,
  }
}

/**
 * Read every candidate attachment's full text and cut each one to its share
 * of the call's input budget.
 *
 * Three bounds meet here, all of them about the call rather than the work:
 * at most {@link ZOTERO_RETRIEVE_ATTACHMENT_CAP} attachments are read at all
 * (the rest report `unread` instead of silently vanishing), the whole call
 * accepts at most `maxFulltextChars` characters — split evenly across the
 * sources it reads, so no single file can starve the others and the result
 * does not depend on which read finished first — and an unindexed member
 * degrades alone rather than failing the call. Each file is chunked as it
 * arrives, so its full text is released instead of being held for a ranking
 * pass at the end.
 */
async function readFulltextSources(
  deps: { client: ZoteroHttpClient; limits: LocalApiLimits },
  ref: ZoteroObjectRef,
  serverId: string | undefined,
  candidates: readonly { key: string; contentType?: string }[],
  signal: AbortSignal | undefined,
): Promise<FulltextSource[]> {
  const read = candidates.slice(0, ZOTERO_RETRIEVE_ATTACHMENT_CAP)
  const perSourceChars = Math.max(1, Math.floor(deps.limits.maxFulltextChars / read.length))
  const results = await mapWithConcurrency(
    read,
    ZOTERO_GRAPH_CONCURRENCY,
    async (candidate, poolSignal): Promise<FulltextSource> => {
      const base = {
        key: candidate.key,
        ...(candidate.contentType !== undefined ? { contentType: candidate.contentType } : {}),
      }
      let payload: ZoteroFulltextPayload
      try {
        payload = await fetchFulltext(
          deps,
          candidate.key,
          ref.library as SupportedLocalLibrary,
          serverId,
          poolSignal,
        )
      } catch (error) {
        if (error instanceof ZoteroError && error.code === ZOTERO_NO_FULLTEXT) {
          return { ...base, status: 'unindexed' }
        }
        throw error
      }
      const content = typeof payload.content === 'string' ? payload.content : ''
      const bounded = truncateText(content, perSourceChars)
      return {
        ...base,
        status: 'indexed',
        coverage: normalizeCoverage(payload),
        inputTruncated: bounded.truncated,
        chunks: chunkText(
          bounded.text,
          deps.limits.fulltextChunkWords,
          deps.limits.maxEvidenceChars,
        ),
      }
    },
    { signal },
  )
  return [
    ...results,
    ...candidates.slice(ZOTERO_RETRIEVE_ATTACHMENT_CAP).map((candidate): FulltextSource => ({
      key: candidate.key,
      ...(candidate.contentType !== undefined ? { contentType: candidate.contentType } : {}),
      status: 'unread',
    })),
  ]
}

/**
 * Which of a passage's ranked fields carry query terms. An annotation is the
 * only two-field source — the highlight a reader selected and the comment
 * they wrote — and the comment is the reader's own view rather than the
 * paper's, so the evidence names the field that matched. A ranked passage
 * always matched somewhere (`score > 0` means a query term sits in its
 * text-or-comment token stream, and a single field's tokens are a subset of
 * that stream), so the returned list is never empty.
 */
function matchedFieldsOf(
  queryTerms: ReadonlySet<string>,
  passage: { readonly text: string; readonly comment?: string },
): ZoteroEvidenceField[] | undefined {
  if (passage.comment === undefined) return undefined
  const fields: ZoteroEvidenceField[] = []
  if (carriesQueryTerm(queryTerms, passage.text)) fields.push('text')
  if (carriesQueryTerm(queryTerms, passage.comment)) fields.push('comment')
  return fields
}

/** Whether any query term appears in a field's own tokens. */
function carriesQueryTerm(queryTerms: ReadonlySet<string>, text: string): boolean {
  return tokenize(text).some((term) => queryTerms.has(term))
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
