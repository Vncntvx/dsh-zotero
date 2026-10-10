/**
 * The `zotero_browse` domain: the six bounded discovery kinds (libraries,
 * server-side collection navigation with breadcrumb walks, saved searches,
 * scoped tag facets, item types, and per-type metadata fields). Argument
 * cross-constraints fail closed at the entry before any request.
 * @module dsh-zotero/local/browse-domain
 */
import { type ScopeDirectory } from './scope-directory.js';
import type { ZoteroHttpClient } from '../http-client.js';
import type { LocalApiLimits } from './limits.js';
import type { ZoteroBrowseRequest, ZoteroBrowseResult } from '../types.js';
export declare function runBrowse(deps: {
    client: ZoteroHttpClient;
    limits: LocalApiLimits;
}, directory: ScopeDirectory, request: ZoteroBrowseRequest, signal?: AbortSignal): Promise<ZoteroBrowseResult>;
//# sourceMappingURL=browse-domain.d.ts.map