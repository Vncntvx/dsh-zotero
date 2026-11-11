/**
 * The `zotero_retrieve` domain: one item's annotations, notes, abstract, and
 * full-text chunks ranked as a single passage corpus by the ranking strategy
 * `src/local/evidence-ranker.ts` defines, with per-passage attachment
 * provenance under the multi-attachment policies. An annotation ranks on its
 * highlight and the reader's comment together, and reports which of the two
 * matched; notes, the abstract, and full-text chunks rank on their own text.
 * Each passage reports why it was returned (`matchKind`), so a meaning-level
 * hit is never presented as wording the source contains.
 * @module dsh-zotero/local/retrieve
 */

import { mapWithConcurrency } from '../concurrency.js'
import { ZOTERO_INVALID_ARGUMENT, ZOTERO_NO_FULLTEXT, ZoteroError } from '../errors.js'
import { chunkText, tokenize } from '../evidence.js'
import { queryTermsAcross } from './evidence-ranker.js'
import { asRecord, asString } from '../json.js'
import { selectAttachments, bestAttachmentFromLinks } from '../attachments.js'
import {
  formatRef,
  libraryPrefix,
  refStringFor,
  requireSupportedLocalRef,
  sameLibrary,
} from '../refs.js'
import { assertServerIdMatches, serverIdFromHeaders } from './identity.js'
import {
  partitionChildren,
  type PartitionedChildren,
  type ZoteroChildKind,
} from '../normalize-children.js'
import { plainNoteText, truncateText } from '../normalize-context.js'
import { loadChildRows } from './detail.js'
import {
  attachmentFactOf,
  chunkFulltext,
  fetchFulltext,
  isPdfCandidate,
  normalizeCoverage,
  readFulltextSources,
  tryEnhanceFulltext,
  type FulltextDeps,
  type FulltextSource,
} from './retrieve-fulltext.js'
import type {
  SupportedLocalLibrary,
  ZoteroCoverage,
  ZoteroEvidence,
  ZoteroEvidenceField,
  ZoteroEvidenceSource,
  ZoteroObjectRef,
  ZoteroRetrieveAttachment,
  ZoteroRetrieveRequest,
  ZoteroRetrieveResult,
} from '../types.js'
import type { EvidenceMatchKind } from '../evidence-item.js'

/** The order `sourcesSkipped` reports in; stable regardless of the request order. */
const SOURCE_ORDER: readonly ZoteroEvidenceSource[] = ['annotation', 'note', 'abstract', 'fulltext']

/**
 * Gather ranked evidence for one item: annotations, notes, the abstract,
 * and full-text chunks are scored as one passage corpus by `deps.ranker`,
 * the strategy the core or the enrichment component installed. Fetch
 * stays lazy: children only when annotation/note sources (or a PDF
 * fallback) need them, fulltext only when requested, and under the `best`
 * policy a linked fulltext starts concurrently with children. Annotations
 * live under each attachment, so annotation sources walk the graph's
 * second level and rank every attachment's annotations as one corpus; each
 * passage keeps its own attachment provenance. The `attachmentPolicy`
 * picks the fulltext sources: `best` (default) keeps Zotero's single
 * choice, `allIndexed` ranks every PDF child, and `specified` ranks the
 * named attachments, so multi-attachment results speak through per-passage
 * refs instead of a result-level attachment. A named attachment is only
 * read once its ref is proven to describe an attachment of *this* item on
 * *this* instance: the same key in another library or another Zotero
 * database names a different object, and its text is not this item's
 * evidence. A note item's own body is its note source; child notes
 * contribute every chunk of their full text, so long notes rank beyond
 * their first chunk. Sources the item cannot provide are skipped and
 * reported in `sourcesSkipped`, so retrieval degrades instead of failing.
 * Passage count and character budgets are enforced with the `truncated`
 * flag, never by silently editing passage text.
 */
/** One evidence passage accumulated by the retrieve policies, before ranking. */
interface RetrievePassage {
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
}

/** What one fulltext policy arm contributed; `skippedFulltext` reports the source's absence. */
interface FulltextPolicyOutcome {
  readonly skippedFulltext: boolean
  readonly fulltextWasCut: boolean
  readonly attachmentRef?: string
  readonly attachmentContentType?: string
  readonly coverage?: ZoteroCoverage
  readonly attachments?: ZoteroRetrieveAttachment[]
  readonly passages: RetrievePassage[]
}

/** The payload shape the fulltext reads produce and coverage is normalized from. */
type FulltextPayload = Awaited<ReturnType<typeof fetchFulltext>>

/** Append one attachment's chunks as fulltext passages. */
function appendFulltextChunks(
  passages: RetrievePassage[],
  attachmentRef: string,
  chunks: readonly { text: string; index: number }[],
): void {
  for (const chunk of chunks) {
    passages.push({
      source: 'fulltext',
      sourceRef: attachmentRef,
      text: chunk.text,
      chunkIndex: chunk.index,
      chunkCount: chunks.length,
    })
  }
}

/**
 * The `best` policy's fulltext read: the linked attachment when Zotero names
 * one, else the first PDF child. An unindexed attachment degrades like an
 * absent one — the other requested sources still answer.
 */
async function readBestFulltext(
  deps: FulltextDeps,
  ref: ZoteroObjectRef,
  serverId: string | undefined,
  linkAttachment: ReturnType<typeof bestAttachmentFromLinks>,
  childrenRows: readonly unknown[],
  bestFulltextKey: string | undefined,
  fulltextPromise: Promise<FulltextPayload> | undefined,
  signal: AbortSignal | undefined,
): Promise<FulltextPolicyOutcome> {
  const passages: RetrievePassage[] = []
  let skippedFulltext = false
  let fulltextWasCut = false
  let attachmentRef: string | undefined
  let attachmentContentType: string | undefined
  let coverage: ZoteroCoverage | undefined
  let attachmentKey = bestFulltextKey
  // The link arm reports Zotero's own type (possibly empty); the child
  // fallback selects an application/pdf candidate whose type is known.
  let selectedContentType = linkAttachment?.contentType
  if (attachmentKey === undefined) {
    const pdf = selectAttachments(childrenRows, 'pdf')[0]
    if (pdf === undefined) skippedFulltext = true
    else {
      attachmentKey = pdf.key
      selectedContentType = pdf.contentType
    }
  }
  if (attachmentKey !== undefined) {
    try {
      attachmentRef = refStringFor(
        ref.library as SupportedLocalLibrary,
        'attachment',
        attachmentKey,
        serverId,
      )
      if (selectedContentType !== undefined && selectedContentType !== '') {
        attachmentContentType = selectedContentType
      }

      // Prefer the optional higher-quality parser for a PDF. Every non-`ok`
      // outcome propagates fail-closed; `ok` text is chunked under the same
      // budget as the index.
      const enhanced =
        isPdfCandidate(selectedContentType) && deps.enhancer !== undefined
          ? await tryEnhanceFulltext(
              deps,
              {
                key: attachmentRef,
                source: { kind: 'local', attachmentRef },
                contentType: selectedContentType,
              },
              signal,
            )
          : undefined

      if (enhanced !== undefined) {
        // MinerU text has no Zotero index coverage; leave `coverage` unset.
        const chunked = chunkFulltext(enhanced, deps.limits.maxFulltextChars, deps.limits)
        fulltextWasCut = chunked.inputTruncated
        appendFulltextChunks(passages, attachmentRef, chunked.chunks)
      } else {
        const payload = await (fulltextPromise ??
          fetchFulltext(
            deps,
            attachmentKey,
            ref.library as SupportedLocalLibrary,
            serverId,
            signal,
          ))
        const content = typeof payload.content === 'string' ? payload.content : ''
        const chunked = chunkFulltext(content, deps.limits.maxFulltextChars, deps.limits)
        fulltextWasCut = chunked.inputTruncated
        appendFulltextChunks(passages, attachmentRef, chunked.chunks)
        coverage = normalizeCoverage(payload)
      }
    } catch (error) {
      // An unindexed attachment degrades like an absent one: the other
      // requested sources still answer, and `sourcesSkipped` reports it.
      if (error instanceof ZoteroError && error.code === ZOTERO_NO_FULLTEXT) {
        skippedFulltext = true
      } else {
        throw error
      }
    }
  }
  return {
    skippedFulltext,
    fulltextWasCut,
    ...(attachmentRef !== undefined ? { attachmentRef } : {}),
    ...(attachmentContentType !== undefined ? { attachmentContentType } : {}),
    ...(coverage !== undefined ? { coverage } : {}),
    passages,
  }
}

/**
 * The multi-attachment policies' fulltext read: every selected PDF is a
 * first-class source, and each passage carries its own attachment provenance.
 */
async function readMultiAttachmentFulltext(
  deps: FulltextDeps,
  ref: ZoteroObjectRef,
  serverId: string | undefined,
  prefix: string,
  policy: 'allIndexed' | 'specified',
  attachmentRefs: readonly ZoteroObjectRef[],
  childrenRows: readonly unknown[],
  signal: AbortSignal | undefined,
): Promise<FulltextPolicyOutcome> {
  const passages: RetrievePassage[] = []
  let skippedFulltext = false
  let fulltextWasCut = false
  let attachmentRef: string | undefined
  let attachmentContentType: string | undefined
  let coverage: ZoteroCoverage | undefined
  let attachments: ZoteroRetrieveAttachment[] | undefined
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
    for (const attachmentRef of attachmentRefs) {
      const identity = formatRef(attachmentRef)
      if (!distinct.has(identity)) distinct.set(identity, attachmentRef)
    }
    if (distinct.size > deps.limits.retrieveAttachmentCap) {
      throw new ZoteroError(
        `attachmentRefs lists ${distinct.size} attachments; at most ${deps.limits.retrieveAttachmentCap} can enter one ranking; split the work across calls.`,
        ZOTERO_INVALID_ARGUMENT,
      )
    }
    candidates = await mapWithConcurrency(
      [...distinct.values()],
      deps.limits.graphConcurrency,
      async (wanted, poolSignal): Promise<{ key: string; contentType?: string }> => {
        // The ref is a claim about where this text comes from. Reading a
        // same-key object out of the wrong library or the wrong database
        // would attach a stranger's words to this item, so the claim is
        // checked against the ref itself before any read, and against the
        // object's own answer after it.
        if (!sameLibrary(wanted.library, ref.library)) {
          throw new ZoteroError(
            `Attachment ref ${wanted.key} belongs to library ${wanted.library.type}/${wanted.library.id}, not to ${ref.library.type}/${ref.library.id}. Full text entering this item's evidence must come from this item's own library.`,
            ZOTERO_INVALID_ARGUMENT,
          )
        }
        assertServerIdMatches(wanted.serverId, serverId)
        const row = await deps.client.getJson<unknown>(`${prefix}/items/${wanted.key}`, undefined, {
          signal: poolSignal,
          serverId,
        })
        const rowData = asRecord(asRecord(row.json)?.data)
        const rowType = asString(rowData?.itemType)
        const parentKey = asString(rowData?.parentItem)
        if (rowType !== 'attachment') {
          throw new ZoteroError(
            rowType === undefined
              ? `Attachment ref ${wanted.key} cannot be proven an attachment: Zotero's answer named no item type for it, so nothing rules out a bibliographic item. Read the item's attachments with zotero_get (with include: ["attachments"]) and name an attachment ref from there.`
              : `Attachment ref ${wanted.key} names a ${rowType}, not an attachment.`,
            ZOTERO_INVALID_ARGUMENT,
          )
        }
        if (parentKey !== ref.key) {
          throw new ZoteroError(
            parentKey === undefined
              ? `Attachment ref ${wanted.key} is a top-level attachment with no parent item, so its text is not evidence for ${ref.key}.`
              : `Attachment ref ${wanted.key} is attached to item ${parentKey}, not to ${ref.key}; its text would be another work's evidence. Read this item's attachments with zotero_get to get refs that belong to it.`,
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
    skippedFulltext = true
  } else {
    const sources = await readFulltextSources(deps, ref, serverId, candidates, signal)
    const indexed = sources.filter(
      (source): source is Extract<FulltextSource, { status: 'indexed' }> =>
        source.status === 'indexed',
    )
    if (indexed.length === 0) skippedFulltext = true
    for (const source of indexed) {
      const passageAttachmentRef = refStringFor(
        ref.library as SupportedLocalLibrary,
        'attachment',
        source.key,
        serverId,
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
      ref: refStringFor(ref.library as SupportedLocalLibrary, 'attachment', source.key, serverId),
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
      attachmentRef = refStringFor(
        ref.library as SupportedLocalLibrary,
        'attachment',
        source.key,
        serverId,
      )
      if (source.contentType !== undefined && source.contentType !== '') {
        attachmentContentType = source.contentType
      }
      coverage = source.coverage
    }
  }
  return {
    skippedFulltext,
    fulltextWasCut,
    ...(attachmentRef !== undefined ? { attachmentRef } : {}),
    ...(attachmentContentType !== undefined ? { attachmentContentType } : {}),
    ...(coverage !== undefined ? { coverage } : {}),
    ...(attachments !== undefined ? { attachments } : {}),
    passages,
  }
}

export async function retrieve(
  deps: FulltextDeps,
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
  const serverId = serverIdFromHeaders(parent.headers, ref.serverId)
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
  // With an enhancer installed the higher-quality parser is tried first; an
  // eager index read would be wasted work whenever it succeeds. The fallback
  // path starts the same loopback request after the enhancer declines. With no
  // enhancer, the original overlap with the children fetch is preserved.
  const fulltextPromise =
    bestFulltextKey === undefined || deps.enhancer !== undefined
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
  const passages: RetrievePassage[] = []
  let fulltext: FulltextPolicyOutcome | undefined
  if (wantsFulltext && policy === 'best') {
    fulltext = await readBestFulltext(
      deps,
      ref,
      serverId,
      linkAttachment,
      childrenRows,
      bestFulltextKey,
      fulltextPromise,
      signal,
    )
  } else if (wantsFulltext && policy !== 'best') {
    fulltext = await readMultiAttachmentFulltext(
      deps,
      ref,
      serverId,
      prefix,
      policy,
      request.attachmentRefs ?? [],
      childrenRows,
      signal,
    )
  }
  if (fulltext !== undefined) {
    if (fulltext.skippedFulltext) skipped.push('fulltext')
    fulltextWasCut = fulltext.fulltextWasCut
    attachmentRef = fulltext.attachmentRef
    attachmentContentType = fulltext.attachmentContentType
    coverage = fulltext.coverage
    attachments = fulltext.attachments
    passages.push(...fulltext.passages)
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
        // paper ("the method looks biased here" is a finding in its own
        // right, and a highlight whose words say nothing about it must still
        // be findable by the comment's terms). Both fields rank; the evidence
        // keeps them apart and names the one that matched.
        ...(annotation.comment === undefined
          ? {}
          : { rankText: `${annotation.text}\n${annotation.comment}` }),
      })
    }
  }
  if (wantsNotes) {
    const noteRef = refStringFor(ref.library as SupportedLocalLibrary, 'item', ref.key, serverId)
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
        sourceRef: refStringFor(ref.library as SupportedLocalLibrary, 'item', ref.key, serverId),
        text: bounded.text,
      })
    } else {
      skipped.push('abstract')
    }
  }

  const rankResult = await deps.ranker.rank({
    query: request.query,
    ...(request.queryVariants === undefined ? {} : { queryVariants: request.queryVariants }),
    chunks: passages.map((passage, index) => ({ text: passage.rankText ?? passage.text, index })),
    ...(signal === undefined ? {} : { signal }),
  })
  const ranked = rankResult.matches
  // The ranker returns only passages some route hit, so "no entries" is the one
  // fact it reports: no overlap between this query and the sources read. Zero-
  // score passages are never returned as "evidence", which would present
  // arbitrary excerpts as matches. An empty corpus is a different fact — no
  // overlap test ever ran — and is named separately below.
  const queryTerms = queryTermsAcross(request.query, request.queryVariants)
  const queryTermSet = new Set(queryTerms)
  const evidence: ZoteroEvidence[] = []
  let used = 0
  let truncated = ranked.length > request.passages || fulltextWasCut || abstractWasCut
  for (const entry of ranked.slice(0, request.passages)) {
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
    const matchedFields = matchedFieldsOf(queryTermSet, passage, entry.matchKind)
    evidence.push({
      source: passage.source,
      sourceRef: passage.sourceRef,
      text: passage.text,
      ...(passage.chunkIndex !== undefined ? { chunkIndex: passage.chunkIndex } : {}),
      ...(passage.chunkCount !== undefined ? { chunkCount: passage.chunkCount } : {}),
      ...(passage.comment !== undefined ? { comment: passage.comment } : {}),
      ...(passage.pageLabel !== undefined ? { pageLabel: passage.pageLabel } : {}),
      ...(passage.attachmentRef !== undefined ? { attachmentRef: passage.attachmentRef } : {}),
      matchKind: entry.matchKind,
      ...(matchedFields !== undefined ? { matchedFields } : {}),
    })
  }
  // A stable report order keeps the contract predictable: the sources the
  // caller asked for but the item could not provide, deduplicated.
  const sourcesSkipped = [...new Set(skipped)].sort(
    (a, b) => SOURCE_ORDER.indexOf(a) - SOURCE_ORDER.indexOf(b),
  )
  return {
    ref: refStringFor(ref.library as SupportedLocalLibrary, 'item', ref.key, serverId),
    ...(attachmentRef !== undefined ? { attachmentRef } : {}),
    ...(attachmentContentType !== undefined ? { attachmentContentType } : {}),
    ...(coverage !== undefined ? { coverage } : {}),
    ...(attachments !== undefined ? { attachments } : {}),
    evidence,
    truncated,
    sourcesSkipped,
    queryTerms,
    rankedRoutes: [...rankResult.routes],
    ...(ranked.length === 0
      ? {
          noMatch: (passages.length === 0 ? 'no-sources' : 'no-overlap') as
            'no-sources' | 'no-overlap',
        }
      : {}),
  }
}

/**
 * Which of a passage's ranked fields carry query terms. An annotation is the
 * only two-field source (the highlight a reader selected and the comment
 * they wrote), and the comment is the reader's own view rather than the
 * paper's, so the evidence names the field that matched.
 *
 * A `semantic` match names no field at all: the passage answered the query
 * without sharing its wording, so claiming a field carried the terms would
 * assert an overlap that does not exist. For a lexical or hybrid match a ranked
 * passage always matched somewhere, and a single field's tokens are a subset of
 * the stream that was scored.
 * @param queryTerms - the distinct terms the lexical route scored.
 * @param passage - the passage's two text fields, when it has a comment.
 * @param matchKind - why the passage was returned.
 * @returns the matched field names, or `undefined` when none apply.
 */
function matchedFieldsOf(
  queryTerms: ReadonlySet<string>,
  passage: { readonly text: string; readonly comment?: string },
  matchKind: EvidenceMatchKind,
): ZoteroEvidenceField[] | undefined {
  if (matchKind === 'semantic') return undefined
  if (passage.comment === undefined) return undefined
  const fields: ZoteroEvidenceField[] = []
  if (carriesQueryTerm(queryTerms, passage.text)) fields.push('text')
  if (carriesQueryTerm(queryTerms, passage.comment)) fields.push('comment')
  return fields.length === 0 ? undefined : fields
}

/** Whether any query term appears in a field's own tokens. */
function carriesQueryTerm(queryTerms: ReadonlySet<string>, text: string): boolean {
  return tokenize(text).some((term) => queryTerms.has(term))
}
