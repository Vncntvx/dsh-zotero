/**
 * Fixed cosine admission policies, measured against archived real model vectors.
 *
 * The 2026-11-17 report and raw vectors live in
 * tests/fixtures/semantic-admission/. It covers 24 authored regression cases
 * (20 paraphrases, two lexical and two duplicate controls), each with one
 * labeled answer and seven controls; the English tier uses 12 English cases.
 * The unchanged margins are policy limits, not independently fitted values.
 * Every current floor exceeds the strongest measured answer-removed cosine.
 * Hybrid was raised from 0.461 to 0.509118 after its old floor admitted two
 * controls; the report preserves both outcomes and the exact input hashes.
 *
 * These are in-sample regression measurements, not a production false-hit
 * guarantee. Recompute with prepare-admission, encode-admission and
 * measure-admission after changing a pinned model. Unknown tiers fail closed.
 * @module dsh-zotero/enrichment/semantic/model-profiles
 */
import type { SemanticModelKey } from '../../enrichment-model-catalog.js';
import { type AdmissionRules } from './admission.js';
/** The tier table. Every catalog key must have one entry. */
export declare const ADMISSION_PROFILES: Readonly<Record<SemanticModelKey, AdmissionRules>>;
/**
 * The admission rules for one tier. A tier outside the table is a hard error:
 * semantic ranking may not admit passages without a measured floor.
 * @param key - the catalog tier key.
 */
export declare function admissionProfileOf(key: SemanticModelKey): AdmissionRules;
//# sourceMappingURL=model-profiles.d.ts.map