/**
 * The `zotero_retrieve` domain: one item's annotations, notes, abstract, and
 * full-text chunks ranked as a single passage corpus by the ranking strategy
 * `src/local/evidence-ranker.ts` defines, with per-passage attachment
 * provenance under the multi-attachment policies. An annotation ranks on its
 * highlight and the reader's comment together, and reports which of the two
 * matched; notes, the abstract, and full-text chunks rank on their own text.
 * Each passage reports why it was returned (`matchKind`), so a meaning-level
 * hit is never presented as wording the source contains.
 * @module dsh-zotero/local/retrieve
 */
import { type FulltextDeps } from './retrieve-fulltext.js';
import type { ZoteroRetrieveRequest, ZoteroRetrieveResult } from '../types.js';
export declare function retrieve(deps: FulltextDeps, request: ZoteroRetrieveRequest, signal?: AbortSignal): Promise<ZoteroRetrieveResult>;
//# sourceMappingURL=retrieve.d.ts.map