/** Local-only reference reconciliation for BibTeX-like inputs. */
import type { ZoteroHttpClient } from '../http-client.js';
import type { LocalApiLimits } from './limits.js';
import type { ZoteroMatchReferencesRequest, ZoteroMatchReferencesResult, ZoteroSearchRequest, ZoteroSearchResult } from '../types.js';
export declare const MATCH_REFERENCES_MAX = 50;
export declare function matchReferences(deps: {
    search: (request: ZoteroSearchRequest, signal?: AbortSignal) => Promise<ZoteroSearchResult>;
    client: ZoteroHttpClient;
    limits: LocalApiLimits;
}, request: ZoteroMatchReferencesRequest, signal?: AbortSignal): Promise<ZoteroMatchReferencesResult>;
//# sourceMappingURL=match-references-domain.d.ts.map