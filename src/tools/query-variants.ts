/**
 * The `queryVariants` argument both ranking tools accept: one owner for the
 * bound and normalization. Duplicates fold rather than reject; entries beyond
 * the cap are refused because each phrasing scores the same passages again, so
 * splitting the call would only add work.
 * @module dsh-zotero/tools/query-variants
 */

import { ZOTERO_MAX_QUERY_VARIANTS } from '../constants.js'
import { invalidArgs } from '../errors.js'
import { assertNonBlank } from './validate.js'

/**
 * The message for more paraphrases than one call may carry.
 * @param cap - the per-call bound.
 * @returns the model-facing message.
 */
export function queryVariantsOverCapMessage(cap: number): string {
  return `queryVariants carries more than ${cap} phrasings, and each one is a separate scoring pass over the same passages; keep only the paraphrases closest to the question`
}

/**
 * Normalize the paraphrase list: trimmed, blank entries refused, duplicates
 * dropped.
 * @param variants - the raw argument list, when supplied.
 * @returns the distinct phrasings, or `undefined` when none were supplied.
 */
export function queryVariantsOf(variants: readonly string[] | undefined): string[] | undefined {
  if (variants === undefined) return undefined
  if (variants.length > ZOTERO_MAX_QUERY_VARIANTS) {
    invalidArgs(queryVariantsOverCapMessage(ZOTERO_MAX_QUERY_VARIANTS))
  }
  const distinct: string[] = []
  const seen = new Set<string>()
  for (const value of variants) {
    const trimmed = assertNonBlank('queryVariants entry', value)
    if (seen.has(trimmed)) continue
    seen.add(trimmed)
    distinct.push(trimmed)
  }
  return distinct.length === 0 ? undefined : distinct
}
