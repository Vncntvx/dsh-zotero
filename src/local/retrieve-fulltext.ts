/**
 * @module dsh-zotero/local/retrieve-fulltext
 */

import { mapWithConcurrency } from '../concurrency.js'
import {
  isNotFoundError,
  NO_FULLTEXT_MESSAGE,
  ZOTERO_CAPABILITY_UNAVAILABLE,
  ZOTERO_ENRICHMENT_ARTIFACT_NOT_FOUND,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_NO_FULLTEXT,
  ZoteroError,
} from '../errors.js'
import { chunkText, type EvidenceChunk } from '../evidence.js'
import {
  formatRef,
  libraryPrefix,
  parseSupportedRef,
  refStringFor,
  requireSupportedLocalRef,
} from '../refs.js'
import { truncateText } from '../normalize-context.js'
import type {
  SupportedLocalLibrary,
  ZoteroCoverage,
  ZoteroFulltextPayload,
  ZoteroObjectRef,
  ZoteroRetrieveAttachment,
} from '../types.js'
import type { ZoteroHttpClient } from '../http-client.js'
import type { LocalApiLimits } from './limits.js'
import type { DiagnosticSink } from '../diagnostics.js'
import {
  isPdfCandidateContentType,
  type FulltextEnhancer,
  type FulltextEnhancerInput,
  type FulltextLookupResult,
} from './fulltext-enhancer.js'
import type { EvidenceRanker } from './evidence-ranker.js'

export { isPdfCandidateContentType } from './fulltext-enhancer.js'

/**
 * Persist one bounded whole document so a model can read it through a single
 * handle instead of walking every window. The tool layer supplies it from the
 * host spill store; the domain only decides when a document is large enough
 * to be worth one. Returning undefined means no store was available, which
 * leaves the window chain as the only read path.
 */
export type FulltextSpillSink = (
  text: string,
) => Promise<
  { readonly locator: string; readonly bytes: number; readonly retrievalHint: string } | undefined
>

/**
 * The full-text deps. `enhancer` is the optional document-enrichment slot the
 * core holds for `dsh-zotero/enrichment`; when it is absent every read below runs
 * exactly the original loopback path. Enhancer errors propagate. `ranker` is
 * the ranking strategy the retrieve domain ranks through: the core's lexical
 * ranker, or the hybrid one the enrichment component installs, read live per
 * request.
 */
export interface FulltextDeps {
  readonly client: ZoteroHttpClient
  readonly limits: LocalApiLimits
  readonly enhancer?: FulltextEnhancer
  readonly sink?: DiagnosticSink
  readonly ranker: EvidenceRanker
  /** Optional whole-document spill for fulltext-mode reads. */
  readonly spill?: FulltextSpillSink
}

/**
 * Reuse a valid parsed artifact for one PDF. A missing artifact returns
 * `undefined` so the caller reads Zotero's index; storage faults propagate.
 */
export async function lookupParsedFulltext(
  deps: FulltextDeps,
  input: FulltextEnhancerInput,
  signal: AbortSignal | undefined,
): Promise<Extract<FulltextLookupResult, { kind: 'hit' }> | undefined> {
  if (deps.enhancer === undefined) return undefined
  const outcome = await deps.enhancer.lookup(input, signal)
  if (outcome.kind === 'hit') return outcome
  if (outcome.kind === 'fault') throw outcome.error
  return undefined
}

/**
 * The complete text of one document and the provenance of its source.
 * Parsed artifacts provide MinerU Markdown; indexed attachments provide
 * Zotero's text and coverage facts.
 */
export interface FulltextDocument {
  readonly text: string
  readonly textFormat: 'markdown' | 'text'
  readonly sourceKind: 'attachment' | 'url'
  /** Display label using an attachment ref or URL origin. */
  readonly sourceLabel: string
  readonly artifact?: Extract<FulltextLookupResult, { kind: 'hit' }>['provenance']
  readonly coverage?: import('../types.js').ZoteroCoverage
  readonly attachmentRef?: string
}

/**
 * What reading one attachment produced, before any caller-specific budgeting:
 * an indexed source carries the artifact or index text with its provenance,
 * an unindexed source names its absence. This is the single
 * "artifact first, index fallback" kernel every fulltext read shares.
 */
export type OneFulltextOutcome =
  | {
      readonly status: 'indexed'
      readonly text: string
      readonly textFormat: 'markdown' | 'text'
      readonly artifact?: Extract<FulltextLookupResult, { kind: 'hit' }>['provenance']
      /** Zotero's own indexing coverage; absent for parsed artifacts. */
      readonly coverage?: ZoteroCoverage
    }
  | { readonly status: 'unindexed' }

/**
 * Read one attachment's full text: a valid parsed artifact carries its own
 * format and immutable provenance; a miss falls back to Zotero's index text,
 * and only an absent index is unindexed. A non-PDF candidate never asks the
 * enhancer — the artifact store holds parsed PDFs, so asking it for anything
 * else would spend a lookup the caller knows is doomed. Artifact faults
 * propagate even when their code happens to name an index condition.
 */
export async function readOneFulltext(
  deps: FulltextDeps,
  source: {
    key: string
    contentType?: string
    attachmentRef: string
    library: SupportedLocalLibrary
    serverId: string | undefined
  },
  signal: AbortSignal | undefined,
): Promise<OneFulltextOutcome> {
  if (isPdfCandidateContentType(source.contentType) && deps.enhancer !== undefined) {
    const parsed = await lookupParsedFulltext(
      deps,
      {
        key: source.attachmentRef,
        source: { kind: 'local', attachmentRef: source.attachmentRef },
        ...(source.contentType === undefined ? {} : { contentType: source.contentType }),
      },
      signal,
    )
    if (parsed !== undefined) {
      return {
        status: 'indexed',
        text: parsed.text,
        textFormat: parsed.format,
        artifact: parsed.provenance,
      }
    }
  }
  let payload: ZoteroFulltextPayload
  try {
    payload = await fetchFulltext(deps, source.key, source.library, source.serverId, signal)
  } catch (error) {
    if (error instanceof ZoteroError && error.code === ZOTERO_NO_FULLTEXT) {
      return { status: 'unindexed' }
    }
    throw error
  }
  const content = typeof payload.content === 'string' ? payload.content : ''
  return {
    status: 'indexed',
    text: content,
    textFormat: 'text',
    coverage: normalizeCoverage(payload),
  }
}

/** Read one document's complete text in source order. */
export async function readFulltextDocument(
  deps: FulltextDeps,
  source: import('../types.js').ZoteroFulltextSource,
  signal: AbortSignal | undefined,
): Promise<FulltextDocument> {
  if (source.kind === 'artifactId') {
    const outcome = deps.enhancer?.lookupArtifact
      ? await deps.enhancer.lookupArtifact(source.artifactId, signal)
      : undefined
    if (outcome === undefined) {
      throw new ZoteroError(
        'Reading a parsed artifact requires the dsh-zotero/enrichment component.',
        ZOTERO_CAPABILITY_UNAVAILABLE,
      )
    }
    if (outcome.kind === 'fault') throw outcome.error
    if (outcome.kind === 'miss') {
      throw new ZoteroError(
        'The parsed artifact is not available.',
        ZOTERO_ENRICHMENT_ARTIFACT_NOT_FOUND,
      )
    }
    return {
      text: outcome.text,
      textFormat: outcome.format,
      sourceKind: outcome.sourceKind,
      sourceLabel: outcome.sourceLabel,
      artifact: outcome.provenance,
      ...(outcome.attachmentRef === undefined ? {} : { attachmentRef: outcome.attachmentRef }),
    }
  }
  const ref = requireSupportedLocalRef(parseSupportedRef(source.ref, ['attachment']))
  const attachmentRef = formatRef(ref)
  // The shared single-source kernel: artifact first (PDF candidates only),
  // then Zotero's index text. A missing artifact and an unindexed source are
  // the same answer here — the complete read has nothing to fall back to.
  const outcome = await readOneFulltext(
    deps,
    {
      key: ref.key,
      attachmentRef,
      library: ref.library as SupportedLocalLibrary,
      serverId: ref.serverId,
    },
    signal,
  )
  if (outcome.status === 'unindexed') {
    throw new ZoteroError(NO_FULLTEXT_MESSAGE, ZOTERO_NO_FULLTEXT)
  }
  return {
    text: outcome.text,
    textFormat: outcome.textFormat,
    sourceKind: 'attachment',
    sourceLabel: attachmentRef,
    ...(outcome.artifact === undefined ? {} : { artifact: outcome.artifact }),
    ...(outcome.coverage === undefined ? {} : { coverage: outcome.coverage }),
    attachmentRef,
  }
}

/**
 * Apply the call's input bound, then take one exact character window.
 * Character slicing keeps consecutive windows losslessly joinable through
 * `nextStart`. The bounded whole text rides out with the window so the caller
 * can offer a one-handle copy without re-truncating.
 */
export function fulltextWindowOf(
  document: FulltextDocument,
  start: number,
  maxChars: number,
  maxFulltextChars: number,
): { readonly read: import('../types.js').ZoteroFulltextRead; readonly boundedText: string } {
  const bounded = truncateText(document.text, maxFulltextChars)
  const totalChars = bounded.text.length
  if (Math.floor(start) > totalChars || start < 0) {
    throw new ZoteroError(
      `start must name a character within the document (0..${totalChars}).`,
      ZOTERO_INVALID_ARGUMENT,
    )
  }
  const offset = Math.min(Math.floor(start), totalChars)
  const end = Math.min(totalChars, offset + Math.max(1, Math.floor(maxChars)))
  const isTruncated = end < totalChars
  const read: import('../types.js').ZoteroFulltextRead = {
    sourceKind: document.sourceKind,
    sourceLabel: document.sourceLabel,
    textFormat: document.textFormat,
    ...(document.artifact === undefined ? {} : { artifact: document.artifact }),
    ...(document.coverage === undefined ? {} : { coverage: document.coverage }),
    totalChars,
    inputTruncated: bounded.truncated,
    start: offset,
    end,
    text: bounded.text.slice(offset, end),
    isTruncated,
    ...(isTruncated ? { nextStart: end } : {}),
    ...(document.attachmentRef === undefined ? {} : { attachmentRef: document.attachmentRef }),
  }
  return { read, boundedText: bounded.text }
}
/**
 * One full-text source of a retrieval and what reading it produced. The arms
 * carry exactly what their status can prove: an indexed source has Zotero's
 * coverage facts, its accepted chunks and whether this call's budget cut it;
 * an unindexed or unread one has nothing to report beyond the fact that it
 * contributed no text. The fetched payload is read in the worker and not
 * kept, because the chunks are what survives, so a large body is released
 * instead of being held until the ranking pass.
 */
export type FulltextSource = {
  readonly key: string
  readonly contentType?: string
} & (
  | {
      readonly status: 'indexed'
      readonly textFormat: 'markdown' | 'text'
      readonly artifact?: Extract<FulltextLookupResult, { kind: 'hit' }>['provenance']
      /** Absent for MinerU-derived text, which has no Zotero index coverage. */
      readonly coverage?: ZoteroCoverage
      readonly inputTruncated: boolean
      readonly chunks: readonly EvidenceChunk[]
    }
  | { readonly status: 'unindexed' }
  | { readonly status: 'unread' }
)

/** Cut enhanced or index text to a per-source budget and chunk it. */
export function chunkFulltext(
  text: string,
  perSourceChars: number,
  limits: LocalApiLimits,
): {
  readonly bounded: string
  readonly inputTruncated: boolean
  readonly chunks: readonly EvidenceChunk[]
} {
  const bounded = truncateText(text, perSourceChars)
  return {
    bounded: bounded.text,
    inputTruncated: bounded.truncated,
    chunks: chunkText(bounded.text, limits.fulltextChunkWords, limits.maxEvidenceChars),
  }
}

/**
 * Full-text indexing coverage as reported by Zotero. `complete` is derived
 * per axis: the chars axis (text files) and the pages axis (PDFs) each count
 * as complete when the server reports both sides and they agree; the overall
 * answer is complete when at least one axis is reportable and every
 * reportable axis agrees. Anything else is an incomplete answer, never a
 * guess, so a full PDF index without char counts still reads complete.
 */
export function normalizeCoverage(payload: ZoteroFulltextPayload): ZoteroCoverage {
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
  return {
    ...(indexedPages !== undefined ? { indexedPages } : {}),
    ...(totalPages !== undefined ? { totalPages } : {}),
    ...(indexedChars !== undefined ? { indexedChars } : {}),
    ...(totalChars !== undefined ? { totalChars } : {}),
    complete: axes.length > 0 && axes.every((value) => value),
  }
}

/**
 * The per-source fact a result reports for one considered attachment: an
 * indexed source carries what it gave, the others carry only their status,
 * which is itself the finding ("Zotero's index has no text for this file" /
 * "this call did not read it").
 */
export function attachmentFactOf(
  source: FulltextSource,
): Omit<ZoteroRetrieveAttachment, 'ref' | 'contentType'> {
  if (source.status !== 'indexed') return { status: source.status }
  return {
    status: 'indexed',
    textFormat: source.textFormat,
    ...(source.artifact === undefined ? {} : { artifact: source.artifact }),
    ...(source.coverage === undefined ? {} : { coverage: source.coverage }),
    inputTruncated: source.inputTruncated,
    passages: source.chunks.length,
  }
}

/**
 * Read every candidate attachment's full text and cut each one to its share
 * of the call's input budget.
 *
 * Three bounds meet here, all of them about the call rather than the work:
 * at most the configured `retrieveAttachmentCap` attachments are read at all
 * (the rest report `unread` instead of silently vanishing), the whole call
 * accepts at most `maxFulltextChars` characters, split evenly across the
 * sources it reads, so no single file can starve the others and the result
 * does not depend on which read finished first, and an unindexed member
 * degrades alone rather than failing the call. Each file is chunked as it
 * arrives, so its full text is released instead of being held for a ranking
 * pass at the end.
 */
export async function readFulltextSources(
  deps: FulltextDeps,
  ref: ZoteroObjectRef,
  serverId: string | undefined,
  candidates: readonly { key: string; contentType?: string }[],
  signal: AbortSignal | undefined,
): Promise<FulltextSource[]> {
  const read = candidates.slice(0, deps.limits.retrieveAttachmentCap)
  const perSourceChars = Math.max(1, Math.floor(deps.limits.maxFulltextChars / read.length))
  const results = await mapWithConcurrency(
    read,
    deps.limits.graphConcurrency,
    async (candidate, poolSignal): Promise<FulltextSource> => {
      const base = {
        key: candidate.key,
        ...(candidate.contentType !== undefined ? { contentType: candidate.contentType } : {}),
      }
      const attachmentRef = refStringFor(
        ref.library as SupportedLocalLibrary,
        'attachment',
        candidate.key,
        serverId,
      )
      const outcome = await readOneFulltext(
        deps,
        {
          key: candidate.key,
          attachmentRef,
          library: ref.library as SupportedLocalLibrary,
          serverId,
          ...(candidate.contentType === undefined ? {} : { contentType: candidate.contentType }),
        },
        poolSignal,
      )
      if (outcome.status === 'unindexed') return { ...base, status: 'unindexed' }
      const chunked = chunkFulltext(outcome.text, perSourceChars, deps.limits)
      return {
        ...base,
        status: 'indexed',
        textFormat: outcome.textFormat,
        ...(outcome.artifact === undefined ? {} : { artifact: outcome.artifact }),
        ...(outcome.coverage === undefined ? {} : { coverage: outcome.coverage }),
        inputTruncated: chunked.inputTruncated,
        chunks: chunked.chunks,
      }
    },
    { signal },
  )
  return [
    ...results,
    ...candidates.slice(deps.limits.retrieveAttachmentCap).map((candidate): FulltextSource => ({
      key: candidate.key,
      ...(candidate.contentType !== undefined ? { contentType: candidate.contentType } : {}),
      status: 'unread',
    })),
  ]
}

export async function fetchFulltext(
  deps: { client: ZoteroHttpClient },
  attachmentKey: string,
  library: SupportedLocalLibrary,
  serverId: string | undefined,
  signal: AbortSignal | undefined,
): Promise<ZoteroFulltextPayload> {
  try {
    const response = await deps.client.getJson<ZoteroFulltextPayload>(
      `${libraryPrefix(library)}/items/${attachmentKey}/fulltext`,
      undefined,
      { signal, serverId },
    )
    return response.json
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new ZoteroError(NO_FULLTEXT_MESSAGE, ZOTERO_NO_FULLTEXT)
    }
    throw error
  }
}
