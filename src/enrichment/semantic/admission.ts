/**
 * Semantic admission for the hybrid evidence ranker.
 *
 * A dense retriever always returns a nearest neighbour, so "within a small
 * delta of the best hit" alone admits at least one passage for every non-empty
 * corpus — including a corpus with nothing relevant in it. Admission therefore
 * combines two rules, both fixed in {@link ADMISSION_PROFILES}:
 *
 * - an **absolute floor**: a passage must reach a per-model cosine before the
 *   semantic route may return it at all. The floor sits above the strongest
 *   cosine an unrelated corpus produces for that model, so a wholly unrelated
 *   corpus is refused instead of answered with its least-bad neighbour.
 * - a **relative margin**: among passages that clear the floor, only those
 *   within `margin` of the corpus's own best cosine stay, which keeps a
 *   same-topic answer set together without dragging in distant neighbours.
 *
 * Both numbers are measured on real model output over a bilingual paraphrase
 * set whose questions share no content word with their answers, so BM25 scores
 * those answers zero and every admitted passage is a semantic hit. The floors
 * are model-specific because the cosine scale differs per tier (0.42 for
 * Qwen3-0.6B, 0.73 for Granite-97M): a single absolute number cannot serve
 * them all.
 *
 * Nothing here depends on a stored calibration artifact, so a tier works as
 * soon as its bundle is installed. A tier outside the catalog has no profile
 * and fails closed with `ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE` — never a
 * silent lexical fallback.
 * @module dsh-zotero/enrichment/semantic/admission
 */

import { ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE, ZoteroError } from '../../errors.js'

/** How one tier admits passages: an absolute floor plus a relative margin. */
export interface AdmissionRules {
  /** Minimum cosine for the semantic route to return a passage at all. */
  readonly floor: number
  /** How far below the corpus best an admitted passage may sit. */
  readonly margin: number
}

function fail(reason: string): never {
  throw new ZoteroError(
    `Semantic ranking is unavailable: ${reason}`,
    ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE,
  )
}

/**
 * Validate one profile. A non-finite, out-of-range, or inverted pair is a
 * programming error at module load, surfaced as the stable domain error so a
 * bad table can never silently admit everything.
 */
export function validateAdmissionRules(
  rules: AdmissionRules | undefined,
  label: string,
): AdmissionRules {
  if (typeof rules !== 'object' || rules === null) fail(`${label} is missing`)
  const { floor, margin } = rules as AdmissionRules
  if (!Number.isFinite(floor) || floor < 0 || floor > 1) fail(`${label} has an invalid floor`)
  if (!Number.isFinite(margin) || margin < 0 || margin > 1) fail(`${label} has an invalid margin`)
  return rules as AdmissionRules
}

/**
 * The admitted passage indexes for one phrasing, best first.
 *
 * Ties keep caller order so a deterministic corpus produces a deterministic
 * answer; `floor` and `margin` are applied per phrasing, never across them, so
 * a second phrasing can add members but never remove another phrasing's hit.
 * @param cosines - one cosine per passage, in caller order.
 * @param rules - the tier's floor and margin.
 * @returns the admitted indexes, highest cosine first.
 */
export function admittedIndexes(cosines: readonly number[], rules: AdmissionRules): number[] {
  // A non-finite cosine is a runtime defect, not a hit: ignore it rather than
  // letting Math.max turn the whole row into NaN and blank the route.
  const finite: { readonly index: number; readonly cosine: number }[] = []
  for (const [index, cosine] of cosines.entries()) {
    if (Number.isFinite(cosine)) finite.push({ index, cosine })
  }
  if (finite.length === 0) return []
  const best = finite.reduce(
    (high, entry) => (entry.cosine > high ? entry.cosine : high),
    -Infinity,
  )
  if (best < rules.floor) return []
  const threshold = Math.max(rules.floor, best - rules.margin)
  return finite
    .filter((entry) => entry.cosine >= threshold)
    .sort((a, b) => (b.cosine !== a.cosine ? b.cosine - a.cosine : a.index - b.index))
    .map((entry) => entry.index)
}
