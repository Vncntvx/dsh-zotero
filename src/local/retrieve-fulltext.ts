/**
 * @module dsh-zotero/local/retrieve-fulltext
 */

import { mapWithConcurrency } from '../concurrency.js'
import { isNotFoundError, NO_FULLTEXT_MESSAGE, ZOTERO_NO_FULLTEXT, ZoteroError } from '../errors.js'
import { chunkText, type EvidenceChunk } from '../evidence.js'
import { libraryPrefix, refStringFor } from '../refs.js'
import { truncateText } from '../normalize-context.js'
import type { ZoteroHttpClient } from '../http-client.js'
import type { LocalApiLimits } from './limits.js'
import type { DiagnosticSink } from '../diagnostics.js'
import {
  isPdfContentType,
  type FulltextEnhancer,
  type FulltextEnhancerInput,
} from './fulltext-enhancer.js'

/**
 * The full-text deps. `enhancer` is the optional document-parsing slot the
 * core holds for `dsh-zotero/parsing`; when it is absent every read below runs
 * exactly the original loopback path. `sink` records an explicit reason when
 * the enhancer declines, so a fallback is never a silent success.
 */
export interface FulltextDeps {
  readonly client: ZoteroHttpClient
  readonly limits: LocalApiLimits
  readonly enhancer?: FulltextEnhancer
  readonly sink?: DiagnosticSink
}

/**
 * Try the optional higher-quality parser for one PDF. Returns its text on
 * success, `undefined` when the caller should keep local extraction, and
 * rethrows a fatal (authorization/configuration) failure. A recoverable
 * fallback is reported to the diagnostics ring with its stated reason.
 */
export async function tryEnhanceFulltext(
  deps: FulltextDeps,
  input: FulltextEnhancerInput,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  if (deps.enhancer === undefined) return undefined
  const outcome = await deps.enhancer.enhance(input, signal)
  if (outcome.kind === 'ok') return outcome.text
  if (outcome.kind === 'fatal') throw outcome.error
  deps.sink?.warn('parsing.fallback', outcome.reason)
  return undefined
}

/** Only PDF candidates are offered to the parser; known non-PDF types skip it. */
export const isPdfCandidate = isPdfContentType
import type {
  SupportedLocalLibrary,
  ZoteroCoverage,
  ZoteroFulltextPayload,
  ZoteroObjectRef,
  ZoteroRetrieveAttachmentStatus,
} from '../types.js'

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
  /** Internal provenance flag; never projected into the tool's wire schema. */
  readonly enhanced?: boolean
} & (
  | {
      readonly status: 'indexed'
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
export function attachmentFactOf(source: FulltextSource): {
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

      // Prefer the optional higher-quality parser for PDF candidates. A
      // `fatal` outcome propagates (fail-closed); `ok` text is chunked under
      // the same per-source budget as a Zotero index; a `fallback` is reported
      // and the original loopback read runs unchanged.
      if (isPdfCandidate(candidate.contentType) && deps.enhancer !== undefined) {
        const attachmentRef = refStringFor(
          ref.library as SupportedLocalLibrary,
          'attachment',
          candidate.key,
          serverId,
        )
        const enhanced = await tryEnhanceFulltext(
          deps,
          {
            key: attachmentRef,
            source: { kind: 'local', attachmentRef },
            contentType: candidate.contentType,
          },
          poolSignal,
        )
        if (enhanced !== undefined) {
          const chunked = chunkFulltext(enhanced, perSourceChars, deps.limits)
          return {
            ...base,
            status: 'indexed',
            enhanced: true,
            inputTruncated: chunked.inputTruncated,
            chunks: chunked.chunks,
          }
        }
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
      const chunked = chunkFulltext(
        typeof payload.content === 'string' ? payload.content : '',
        perSourceChars,
        deps.limits,
      )
      return {
        ...base,
        status: 'indexed',
        coverage: normalizeCoverage(payload),
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
