/**
 * @module dsh-zotero/local/retrieve-fulltext
 */

import { mapWithConcurrency } from '../concurrency.js'
import { isNotFoundError, NO_FULLTEXT_MESSAGE, ZOTERO_NO_FULLTEXT, ZoteroError } from '../errors.js'
import { chunkText, type EvidenceChunk } from '../evidence.js'
import { libraryPrefix } from '../refs.js'
import { truncateText } from '../normalize-context.js'
import type { ZoteroHttpClient } from '../http-client.js'
import type { LocalApiLimits } from './limits.js'
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
  deps: { client: ZoteroHttpClient; limits: LocalApiLimits },
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
      const bounded = truncateText(
        typeof payload.content === 'string' ? payload.content : '',
        perSourceChars,
      )
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
