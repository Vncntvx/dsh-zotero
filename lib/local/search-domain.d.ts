/**
 * The `zotero_search` domain: query serialization into the Local API's
 * documented parameters, scope resolution through the {@link ScopeDirectory},
 * server-side paging under an honest Total-Results total, and the first-page
 * client-side note-body scan listed beside the paged results.
 * @module dsh-zotero/local/search-domain
 */
import type { ZoteroHttpClient } from '../http-client.js';
import { ScopeDirectory } from './scope-directory.js';
import { type SearchIndexCaches } from './search-index.js';
import type { LocalApiLimits } from './limits.js';
import type { ZoteroSearchOptions, ZoteroSearchRequest, ZoteroSearchResult } from '../types.js';
/**
 * The model-facing message for `includeTrashed` outside a library scope.
 *
 * The tool layer has its own sentence for the same rule: it tells the model to
 * drop the argument, while this one states the scope condition the domain
 * enforces. They are separate constants because they are separate statements,
 * not one sentence with different punctuation.
 */
export declare const INCLUDE_TRASHED_SCOPE_MESSAGE = "includeTrashed is only allowed with library scope.";
export declare function runSearch(deps: {
    client: ZoteroHttpClient;
    limits: LocalApiLimits;
    searchCaches: SearchIndexCaches;
}, directory: ScopeDirectory, request: ZoteroSearchRequest, signal: AbortSignal | undefined, options: ZoteroSearchOptions): Promise<ZoteroSearchResult>;
/**
 * The message for a filtered search that also asks for the note-body
 * supplement. The exact path serves paged primary hits only and cannot scan
 * note bodies.
 */
export declare const FILTERED_SEARCH_SUPPLEMENT_MESSAGE = "Year and attachment filters are panel-only and do not support the note-body supplement.";
//# sourceMappingURL=search-domain.d.ts.map