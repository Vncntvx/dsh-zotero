/**
 * Cross-component integration between the scholarly search engine and the local
 * Zotero library: annotates search hits the user already holds.
 *
 * Two rules shape this module:
 *
 * 1. **The ref grammar has one owner.** `src/refs.ts` decides what a
 *    `zotero://` ref is, and this module never recovers an identity from a
 *    string that `parseRef` rejected. A hit whose `ref` is outside the grammar
 *    is not a match, so it is skipped: inventing a key (and defaulting its
 *    library to personal `0`) would assert group-library membership the record
 *    never stated, and the detail seam only accepts the parsed object.
 * 2. **Absence is not evidence.** A lookup that could not run is counted in
 *    {@link LibraryStatusReport}, so the caller reports "library status
 *    unavailable" instead of leaving every hit unmarked, which a reader would
 *    take for "not in the library".
 *
 * @module dsh-zotero/scholarly/zotero-link
 */

import { parseRef } from '../refs.js'
import { mapWithConcurrency } from '../concurrency.js'
import type {
  ZoteroGetRequest,
  ZoteroItemDetail,
  ZoteroObjectRef,
  ZoteroSearchRequest,
  ZoteroSearchResult,
  ZoteroCreateItemRequest,
  ZoteroCreateItemCommittedOutcome,
  ZoteroWriteCall,
} from '../types.js'
import { titleKey } from './normalize.js'
import type { ScholarlyPaper } from './types.js'

export interface ZoteroServiceLike {
  search(request: ZoteroSearchRequest, signal?: AbortSignal): Promise<ZoteroSearchResult>
  get?(request: ZoteroGetRequest, signal?: AbortSignal): Promise<ZoteroItemDetail>
  createItem?(
    request: ZoteroCreateItemRequest,
    call: ZoteroWriteCall,
  ): Promise<ZoteroCreateItemCommittedOutcome | { kind: 'declined' }>
}

/** What one library-status pass managed to determine. */
interface LibraryStatusReport {
  /** Hits that received an `inLibrary` annotation. */
  readonly matched: number
  /** Hits whose lookup failed; these carry no annotation and must not read as "absent". */
  readonly failed: number
  /** Hits skipped because their `ref` fell outside the grammar. */
  readonly unparseable: number
}

/** A title shorter than this is too weak to assert an identity. */
const MIN_TITLE_MATCH_LENGTH = 15

/** A `10.xxxx/…` identifier inside an item's free-form `extra` field. */
const EXTRA_DOI_PATTERN = /\b10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+\b/

/**
 * The DOI a record carries in its free-form `extra` field.
 * @param extra - the item's `extra` text, when present.
 * @returns the normalized lowercase DOI, or undefined when it names none.
 */
function extraDoiOf(extra: string | undefined): string | undefined {
  return EXTRA_DOI_PATTERN.exec(extra ?? '')?.[0]?.toLowerCase()
}

/**
 * Whether one compact library record identifies the paper being annotated.
 * @param paper - the scholarly hit.
 * @param item - the library record's compact fields.
 * @param paperDoi - the hit's normalized DOI, when known.
 * @returns true when the record identifies the same work.
 */
function compactRecordMatches(
  paper: ScholarlyPaper,
  item: { title: string; extra?: string; doi?: string },
  paperDoi: string | undefined,
): boolean {
  const itemDoi = item.doi?.trim().toLowerCase() ?? extraDoiOf(item.extra)
  if (itemDoi !== undefined && paperDoi !== undefined && itemDoi === paperDoi) return true
  return (
    paper.title.length >= MIN_TITLE_MATCH_LENGTH && titleKey(item.title) === titleKey(paper.title)
  )
}

/**
 * Annotate a set of papers with their library status, and report what the
 * pass determined: how many matched, how many lookups failed, and how many
 * refs fell outside the grammar.
 * @param papers - hits to annotate in place.
 * @param zoteroService - the library service, when the host provides one.
 * @returns what the pass determined.
 */
export async function attachLibraryStatus(
  papers: ScholarlyPaper[],
  zoteroService?: ZoteroServiceLike,
  signal?: AbortSignal,
): Promise<LibraryStatusReport> {
  const report = { matched: 0, failed: 0, unparseable: 0 }
  if (zoteroService === undefined || typeof zoteroService.search !== 'function') {
    return report
  }

  await mapWithConcurrency(papers, 4, async (paper) => {
    const queryTerm = paper.doi ?? paper.title
    let res: ZoteroSearchResult
    try {
      res = await zoteroService.search(
        {
          query: queryTerm,
          mode: 'metadata',
          scope: { kind: 'library' },
          sort: 'dateModified',
          direction: 'desc',
          offset: 0,
          limit: 3,
        },
        signal,
      )
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      report.failed += 1
      return
    }

    const paperDoi = paper.doi?.trim().toLowerCase()

    for (const item of res.items ?? []) {
      // The grammar owns ref identity: an unparseable ref is not a match, and
      // the detail seam below takes the parsed object, never a string.
      let ref: ZoteroObjectRef
      try {
        ref = parseRef(item.ref)
      } catch {
        report.unparseable += 1
        continue
      }

      let isMatch = compactRecordMatches(paper, item, paperDoi)
      let collections: string[] = []

      // When the compact record does not match and the paper has no DOI, the
      // detail lookup can match neither the DOI nor the title, so it is skipped.
      if (typeof zoteroService.get === 'function' && (isMatch || paperDoi !== undefined)) {
        try {
          const detail = await zoteroService.get({ ref, include: new Set() }, signal)
          const detailDoi = detail.doi?.trim().toLowerCase()
          if (paperDoi !== undefined && detailDoi !== undefined && paperDoi === detailDoi) {
            isMatch = true
          } else if (
            paper.title.length >= MIN_TITLE_MATCH_LENGTH &&
            titleKey(detail.title) === titleKey(paper.title)
          ) {
            isMatch = true
          }
          if (isMatch && detail.collections) {
            collections = detail.collections.map((c) => c.name ?? c.ref)
          }
        } catch (error) {
          if (signal?.aborted) throw signal.reason ?? error
          // A failed detail read leaves the compact record's own match intact;
          // the collection list stays empty rather than invented.
        }
      }

      if (isMatch) {
        paper.inLibrary = {
          itemKey: ref.key,
          libraryId: String(ref.library.id),
          collections,
        }
        report.matched += 1
        break
      }
    }
  })

  return report
}

/**
 * Annotate papers with their library status and, when any lookup failed,
 * format the notice the caller appends. A failed lookup is not evidence of
 * absence, so the notice says "unavailable" rather than leaving hits unmarked.
 * @param papers - papers to annotate in place.
 * @param zoteroService - optional local library service.
 * @param signal - optional cancellation signal.
 * @param style - 'batch' reports counts (search, citations); 'item' reports one result (get).
 * @returns the notice and the raw status report.
 */
export async function annotateWithLibraryStatus(
  papers: ScholarlyPaper[],
  zoteroService?: ZoteroServiceLike,
  signal?: AbortSignal,
  style: 'batch' | 'item' = 'batch',
): Promise<{ notice: string; report: LibraryStatusReport }> {
  if (papers.length === 0 || !zoteroService) {
    return { notice: '', report: { matched: 0, failed: 0, unparseable: 0 } }
  }
  const report = await attachLibraryStatus(papers, zoteroService, signal)
  let notice = ''
  if (report.failed > 0) {
    notice =
      style === 'item'
        ? '\n\nLibrary status unavailable (local Zotero lookup failed).'
        : `\n\nLibrary status unavailable for ${report.failed} of ${papers.length} results (local Zotero lookup failed).`
  }
  return { notice, report }
}
