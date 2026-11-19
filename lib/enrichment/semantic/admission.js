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
 *   cosine of the measured answer-removed controls for that model.
 *   A corpus whose best cosine falls below it returns no semantic passage.
 * - a **relative margin**: among passages that clear the floor, only those
 *   within `margin` of the corpus's own best cosine stay, which keeps a
 *   same-topic answer set together without dragging in distant neighbours.
 *
 * The fixed policies are checked against archived actual model output; the
 * report distinguishes 20 paraphrases from four lexical/duplicate controls,
 * and measures BM25 separately. The margin is a policy limit. Passing these
 * authored regression cases does not establish a production false-hit bound.
 *
 * Nothing here depends on a stored calibration artifact, so a tier works as
 * soon as its bundle is installed. A tier outside the catalog has no profile
 * and fails closed with `ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE` — never a
 * silent lexical fallback.
 * @module dsh-zotero/enrichment/semantic/admission
 */
import { ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE, ZoteroError } from '../../errors.js';
function fail(reason) {
    throw new ZoteroError(`Semantic ranking is unavailable: ${reason}`, ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE);
}
/**
 * Validate one profile. A non-finite, out-of-range, or inverted pair is a
 * programming error at module load, surfaced as the stable domain error so a
 * bad table can never silently admit everything.
 */
export function validateAdmissionRules(rules, label) {
    if (typeof rules !== 'object' || rules === null)
        fail(`${label} is missing`);
    const { floor, margin } = rules;
    if (!Number.isFinite(floor) || floor < 0 || floor > 1)
        fail(`${label} has an invalid floor`);
    if (!Number.isFinite(margin) || margin < 0 || margin > 1)
        fail(`${label} has an invalid margin`);
    return rules;
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
export function admittedIndexes(cosines, rules) {
    // A non-finite cosine is a runtime defect, not a hit: ignore it rather than
    // letting Math.max turn the whole row into NaN and blank the route.
    const finite = [];
    for (const [index, cosine] of cosines.entries()) {
        if (Number.isFinite(cosine))
            finite.push({ index, cosine });
    }
    if (finite.length === 0)
        return [];
    const best = finite.reduce((high, entry) => (entry.cosine > high ? entry.cosine : high), -Infinity);
    if (best < rules.floor)
        return [];
    const threshold = Math.max(rules.floor, best - rules.margin);
    return finite
        .filter((entry) => entry.cosine >= threshold)
        .sort((a, b) => (b.cosine !== a.cosine ? b.cosine - a.cosine : a.index - b.index))
        .map((entry) => entry.index);
}
//# sourceMappingURL=admission.js.map