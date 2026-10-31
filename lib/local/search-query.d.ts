/**
 * @module dsh-zotero/local/search-query
 */
import type { ZoteroSearchRequest } from '../types.js';
export declare function encodeLiteralTag(tag: string): string;
/**
 * Escape for NOT filter: `-` + escaped literal. For a tag that itself starts with `-`
 * (e.g. `-foo` literal), this intentionally yields `-\-foo` = NOT literal "-foo".
 * This is the Local API's documented escaping: `tag=\\-foo` means literal "-foo",
 * `tag=-\\-foo` means NOT literal "-foo". The backslash is part of the literal syntax,
 * not double-escaping.
 */
export declare function encodeExcludeTag(tag: string): string;
export declare function buildSearchParams(request: ZoteroSearchRequest): URLSearchParams;
//# sourceMappingURL=search-query.d.ts.map