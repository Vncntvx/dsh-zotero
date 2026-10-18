/**
 * Cross-component integration between the scholarly search engine and the local
 * Zotero library: annotates search hits the user already holds.
 *
 * Two rules shape this module:
 *
 * 1. **The ref grammar has one owner.** `src/refs.ts` decides what a
 *    `zotero://` ref is; this module never recovers an identity from a string
 *    that `parseRef` rejected. A hit whose `ref` is outside the grammar is not
 *    a match — it is skipped, because inventing a key (and defaulting its
 *    library to personal `0`) would assert group-library membership the record
 *    never stated, and the detail seam only accepts the parsed object.
 * 2. **Absence is not evidence.** A lookup that could not run is counted in
 *    {@link LibraryStatusReport}, so the caller reports "library status
 *    unavailable" instead of leaving every hit unmarked — which a reader would
 *    take for "not in the library".
 *
 * @module dsh-zotero/scholarly/zotero-link
 */

import { parseRef } from '../refs.js'
import type {
  ZoteroGetRequest,
  ZoteroItemDetail,
  ZoteroObjectRef,
  ZoteroSearchRequest,
  ZoteroSearchResult,
} from '../types.js'
import { titleKey } from './normalize.js'
import type { ScholarlyPaper } from './types.js'

export interface ZoteroServiceLike {
  search(request: ZoteroSearchRequest, signal?: AbortSignal): Promise<ZoteroSearchResult>
  get?(request: ZoteroGetRequest, signal?: AbortSignal): Promise<ZoteroItemDetail>
}

/** What one library-status pass managed to determine. */
export interface LibraryStatusReport {
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
  item: { title: string; extra?: string },
  paperDoi: string | undefined,
): boolean {
  const itemDoi = extraDoiOf(item.extra)
  if (itemDoi !== undefined && paperDoi !== undefined && itemDoi === paperDoi) return true
  return (
    paper.title.length >= MIN_TITLE_MATCH_LENGTH && titleKey(item.title) === titleKey(paper.title)
  )
}

/**
 * Checks a list of search hits against the local Zotero library, annotating
 * matches in place. A per-hit failure never throws: the report says how many
 * lookups could not run.
 * @param papers - hits to annotate.
 * @param zoteroService - the library service, when the host provides one.
 * @returns what the pass determined.
 */
export async function attachLibraryStatus(
  papers: ScholarlyPaper[],
  zoteroService?: ZoteroServiceLike,
): Promise<LibraryStatusReport> {
  const report = { matched: 0, failed: 0, unparseable: 0 }
  if (zoteroService === undefined || typeof zoteroService.search !== 'function') {
    return report
  }

  await Promise.all(
    papers.map(async (paper) => {
      const queryTerm = paper.doi ?? paper.title
      let res: ZoteroSearchResult
      try {
        res = await zoteroService.search({
          query: queryTerm,
          mode: 'metadata',
          scope: { kind: 'library' },
          sort: 'dateModified',
          direction: 'desc',
          offset: 0,
          limit: 3,
        })
      } catch {
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

        if (typeof zoteroService.get === 'function') {
          try {
            const detail = await zoteroService.get({ ref, include: new Set() })
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
          } catch {
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
    }),
  )

  return report
}
