/**
 * The `zotero_retrieve` domain: one item's annotations, notes, abstract, and
 * full-text chunks ranked as a single BM25 passage corpus, with per-passage
 * attachment provenance under the multi-attachment policies. An annotation
 * ranks on its highlight and the reader's comment together, and reports which
 * of the two matched; notes, the abstract, and full-text chunks rank on their
 * own text.
 * @module dsh-zotero/local/retrieve
 */
import type { ZoteroHttpClient } from '../http-client.js';
import type { LocalApiLimits } from './limits.js';
import type { ZoteroRetrieveRequest, ZoteroRetrieveResult } from '../types.js';
export declare function retrieve(deps: {
    client: ZoteroHttpClient;
    limits: LocalApiLimits;
}, request: ZoteroRetrieveRequest, signal?: AbortSignal): Promise<ZoteroRetrieveResult>;
//# sourceMappingURL=retrieve.d.ts.map