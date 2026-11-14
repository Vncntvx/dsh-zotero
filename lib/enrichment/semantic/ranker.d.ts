/**
 * The hybrid evidence ranker: the core's lexical BM25 route plus a semantic
 * route over a locally embedded corpus, fused with the same reciprocal-rank
 * rule the scholarly subsystem uses.
 *
 * Admission is the tier's measured absolute floor plus a margin over the
 * corpus's own best cosine (`admittedIndexes`). A new phrasing adds hits
 * without removing another phrasing's admitted members. The offline
 * ridge-logistic probes in this module are calibration evidence for the
 * measured floors and are never part of the runtime decision.
 *
 * The semantic route orders by best admitted confidence; raw cosine stays in
 * `semanticScore`. RRF orders results and does not express confidence.
 * @module dsh-zotero/enrichment/semantic/ranker
 */
import { type EvidenceRanker } from '../../local/evidence-ranker.js';
import { type AdmissionRules } from './admission.js';
import type { VectorCache } from './vector-cache.js';
import type { Embedder } from './session.js';
/** One calibration topic: a query, statements that answer it, and ones that do not. */
export interface CalibrationProbe {
    readonly query: string;
    readonly related: readonly string[];
}
/**
 * Diagnostic sample probes retained from the baseline; production admission
 * does not use them. The offline calibration chain in
 * `scripts/semantic-calibration/` owns the dataset, split, fit, and held-out
 * evaluation.
 */
export declare const RANKER_CALIBRATION_PROBES: readonly CalibrationProbe[];
export interface ProbeSeparation {
    readonly weakestSame: number;
    readonly strongestCross: number;
    readonly midpoint: number;
}
/**
 * Measure one embedder's probe separation for diagnostics; `rank()` does not
 * call it.
 */
export declare const probeSeparationOf: (embedder: Embedder) => Promise<ProbeSeparation>;
export interface SemanticRankerDeps {
    /**
     * Resolve the embedder for the selected model. Implementations load lazily
     * and throw `ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE` when the model cannot
     * serve; the rejection propagates to the tool caller without a lexical-only
     * fallback.
     */
    readonly embedder: () => Promise<Embedder>;
    /**
     * The selected tier's admission rules (absolute floor plus relative margin),
     * fixed in code per model. An unknown tier fails with the semantic-unavailable
     * code rather than admitting passages on a guess.
     */
    readonly profile: () => AdmissionRules;
    /**
     * Optional bounded cross-request vector cache. The service owns one per
     * model generation; omitting it (unit tests) still ranks correctly, just
     * without reuse. A model switch constructs a new cache rather than reusing
     * an old generation's entries.
     */
    readonly vectorCache?: VectorCache;
}
/**
 * The hybrid ranker over one embedder. Lexical scoring stays in the core;
 * this ranker adds the calibrated semantic route and fuses both.
 * @param deps - the embedder source, the tier profile, and the vector cache.
 */
export declare function semanticEvidenceRanker(deps: SemanticRankerDeps): EvidenceRanker;
//# sourceMappingURL=ranker.d.ts.map