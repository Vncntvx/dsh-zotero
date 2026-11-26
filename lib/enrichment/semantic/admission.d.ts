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
/** How one tier admits passages: an absolute floor plus a relative margin. */
export interface AdmissionRules {
    /** Minimum cosine for the semantic route to return a passage at all. */
    readonly floor: number;
    /** How far below the corpus best an admitted passage may sit. */
    readonly margin: number;
}
/**
 * Validate one profile. A non-finite, out-of-range, or inverted pair is a
 * programming error at module load, surfaced as the stable domain error so a
 * bad table can never silently admit everything.
 */
export declare function validateAdmissionRules(rules: AdmissionRules | undefined, label: string): AdmissionRules;
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
export declare function admittedIndexes(cosines: readonly number[], rules: AdmissionRules): number[];
//# sourceMappingURL=admission.d.ts.map