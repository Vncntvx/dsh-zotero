/**
 * The hybrid evidence ranker: the core's lexical BM25 route plus a semantic
 * route over a locally embedded corpus, fused with the same reciprocal-rank
 * rule the scholarly subsystem uses.
 *
 * Admission is the tier's measured absolute floor plus a margin over the
 * corpus's own best cosine (`admittedIndexes`). A new phrasing adds hits
 * without removing another phrasing's admitted members. Every distinct retained
 * chunk is embedded on its first read: lexical prefiltering would lose hits
 * without shared words. The model generation owns a bounded vector cache.
 * Offline measurement lives in scripts/semantic-calibration/.
 *
 * The semantic route orders by best admitted confidence; raw cosine stays in
 * `semanticScore`. RRF orders results and does not express confidence.
 * @module dsh-zotero/enrichment/semantic/ranker
 */
import { type EvidenceRanker } from '../../local/evidence-ranker.js';
import { type AdmissionRules } from './admission.js';
import type { VectorCache } from './vector-cache.js';
import type { Embedder } from './session.js';
interface SemanticRankerDeps {
    /**
     * Resolve the embedder for the selected model. Implementations load lazily
     * and throw `ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE` when the model cannot
     * serve; the rejection propagates to the tool caller without a lexical-only
     * fallback.
     */
    readonly embedder: (signal?: AbortSignal) => Promise<Embedder>;
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
export {};
//# sourceMappingURL=ranker.d.ts.map