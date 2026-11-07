/**
 * @module dsh-zotero/local/search-query
 */
import { setPage } from './pagination.js';
export function encodeLiteralTag(tag) {
    return tag.startsWith('-') ? `\\-${tag.slice(1)}` : tag;
}
/**
 * Escape for NOT filter: `-` + escaped literal. For a tag that itself starts with `-`
 * (e.g. `-foo` literal), this intentionally yields `-\-foo` = NOT literal "-foo".
 * This is the Local API's documented escaping: `tag=\\-foo` means literal "-foo",
 * `tag=-\\-foo` means NOT literal "-foo". The backslash is part of the literal syntax,
 * not double-escaping.
 */
export function encodeExcludeTag(tag) {
    return `-${encodeLiteralTag(tag)}`;
}
/**
 * Serialize a search request into the Local API's documented query parameters,
 * without the paging window. Repeated `tag` values survive here, so the
 * concurrent page reader can clone the query per page. `buildSearchParams`
 * adds `start`/`limit` on top.
 */
function searchQueryOf(request) {
    const params = new URLSearchParams();
    if (request.query !== undefined && request.query !== '')
        params.set('q', request.query);
    if (request.mode === 'everything')
        params.set('qmode', 'everything');
    if (request.itemTypes?.length)
        params.set('itemType', request.itemTypes.join(' || '));
    // tagMatch ALL (default) -> repeated tag (AND); ANY -> single tag with || (OR)
    if (request.tags?.length) {
        if (request.tagMatch === 'any' && request.tags.length > 1) {
            params.set('tag', request.tags.map(encodeLiteralTag).join(' || '));
        }
        else {
            for (const tag of request.tags)
                params.append('tag', encodeLiteralTag(tag));
        }
    }
    for (const tag of request.excludeTags ?? [])
        params.append('tag', encodeExcludeTag(tag));
    if (request.includeTrashed)
        params.set('includeTrashed', '1');
    params.set('sort', request.sort);
    params.set('direction', request.direction);
    return params;
}
export function buildSearchParams(request) {
    return setPage(new URLSearchParams(searchQueryOf(request).toString()), request.offset, request.limit);
}
//# sourceMappingURL=search-query.js.map