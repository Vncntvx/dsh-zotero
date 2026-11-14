/**
 * Fixed semantic admission profiles, one per catalog tier.
 *
 * Each profile has two numbers, both measured on real model output and then
 * frozen here so a tier works the moment its bundle is installed:
 *
 * - `floor` is the absolute cosine a passage must reach to enter the semantic
 *   route. It sits just above the strongest cosine an **unrelated** corpus
 *   produced for that tier, so a corpus with nothing relevant returns no
 *   semantic passage at all. A false semantic hit would read as evidence, which
 *   is worse than a miss; the floors are therefore biased to safety.
 * - `margin` is how far below the corpus's own best admitted cosine a passage
 *   may sit. It keeps a same-topic answer set together without dragging in
 *   distant neighbours.
 *
 * The numbers come from a 12-family bilingual paraphrase set whose questions
 * share **no content word** with their answers, so BM25 scores those answers
 * zero and every admitted passage is a semantic hit. Floors differ per tier
 * because the cosine scale does (0.427 for Qwen3-0.6B, 0.797 for Granite-97M);
 * one absolute number cannot serve them all. With these floors no unrelated
 * query in that set produced a semantic hit, and the measured recall@4 of the
 * answering passage was: balanced 92%, lightweight 58%, bilingual 96%,
 * english 92% (English only), hybrid 92%, academic 92% — against 0% for BM25
 * on the same questions. Re-measure with the scripts under `scripts/semantic-calibration/` after a model
 * revision changes; a tier absent from this table fails closed rather than
 * admitting passages on a guess.
 * @module dsh-zotero/enrichment/semantic/model-profiles
 */
import { validateAdmissionRules } from './admission.js';
/** The tier table. Every catalog key must have one entry. */
export const ADMISSION_PROFILES = Object.freeze({
    balanced: Object.freeze({ floor: 0.427, margin: 0.12 }),
    lightweight: Object.freeze({ floor: 0.797, margin: 0.02 }),
    bilingual: Object.freeze({ floor: 0.515, margin: 0.12 }),
    english: Object.freeze({ floor: 0.593, margin: 0.12 }),
    hybrid: Object.freeze({ floor: 0.461, margin: 0.12 }),
    academic: Object.freeze({ floor: 0.584, margin: 0.12 }),
});
/**
 * The admission rules for one tier. A tier outside the table is a hard error:
 * semantic ranking may not admit passages without a measured floor.
 * @param key - the catalog tier key.
 */
export function admissionProfileOf(key) {
    return validateAdmissionRules(ADMISSION_PROFILES[key], `the semantic model profile for ${String(key)}`);
}
//# sourceMappingURL=model-profiles.js.map