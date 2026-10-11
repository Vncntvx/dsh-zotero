/**
 * The `zotero_search` domain: query serialization into the Local API's
 * documented parameters, scope resolution through the {@link ScopeDirectory},
 * server-side paging under an honest Total-Results total, and the first-page
 * client-side note-body scan listed beside the paged results.
 * @module dsh-zotero/local/search-domain
 */
import type { ZoteroHttpClient } from '../http-client.js';
import { ScopeDirectory } from './scope-directory.js';
import type { LocalApiLimits } from './limits.js';
import type { ZoteroSearchRequest, ZoteroSearchResult } from '../types.js';
/** Escape a literal tag so a leading `-` never becomes Zotero's NOT syntax. */
export declare function encodeLiteralTag(tag: string): string;
/**
 * Escape for NOT filter: `-` + escaped literal. For a tag that itself starts with `-`
 * (e.g. `-foo` literal), this intentionally yields `-\-foo` = NOT literal "-foo".
 * This is the Local API's documented escaping: `tag=\\-foo` means literal "-foo",
 * `tag=-\\-foo` means NOT literal "-foo". The backslash is part of the literal syntax,
 * not double-escaping.
 */
export declare function encodeExcludeTag(tag: string): string;
/**
 * The model-facing message for `includeTrashed` outside a library scope. The
 * tool layer states the same rule for its own argument, but renders it without
 * the full stop, so the two are separate constants rather than one shared one.
 */
export declare const INCLUDE_TRASHED_SCOPE_MESSAGE = "includeTrashed is only allowed with library scope.";
/** Serialize a search request into the Local API's documented query parameters. */
export declare function buildSearchParams(request: ZoteroSearchRequest): URLSearchParams;
export declare function runSearch(deps: {
    client: ZoteroHttpClient;
    limits: LocalApiLimits;
}, directory: ScopeDirectory, request: ZoteroSearchRequest, signal?: AbortSignal): Promise<ZoteroSearchResult>;
//# sourceMappingURL=search-domain.d.ts.map