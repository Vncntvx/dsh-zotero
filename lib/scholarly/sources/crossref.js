/**
 * Crossref adapter querying api.crossref.org for official publisher metadata and retractions.
 * @module dsh-zotero/scholarly/sources/crossref
 */
import { SCHOLARLY_SOURCE_NAMES, } from '../types.js';
import { cleanDoi, encodeQueryParams, ignoreNotFound, parseYear, plain, stripEmptyFields, titled, } from './helpers.js';
export function paperFromCrossref(work) {
    const datePartsObj = work.issued?.['date-parts']?.[0] ??
        work['published-print']?.['date-parts']?.[0] ??
        work['published-online']?.['date-parts']?.[0];
    const parts = datePartsObj?.filter((p) => typeof p === 'number') ?? [];
    const doi = cleanDoi(work.DOI);
    const isRetracted = (work['update-to'] ?? []).some((update) => /retract|withdraw/i.test(update.type ?? ''));
    const authors = (work.author ?? [])
        .map((author) => author.name ?? [author.given, author.family].filter(Boolean).join(' '))
        .filter(Boolean);
    const dateStr = parts.length > 1
        ? parts.map((part, idx) => String(part).padStart(idx === 0 ? 4 : 2, '0')).join('-')
        : undefined;
    return stripEmptyFields({
        title: plain(work.title?.[0] ?? ''),
        authors,
        year: parts[0] ? parseYear(parts[0]) : undefined,
        date: dateStr,
        venue: plain(work['container-title']?.[0] ?? '') || undefined,
        abstract: plain(work.abstract ?? '') || undefined,
        type: work.type,
        doi,
        url: doi ? `https://doi.org/${doi}` : work.URL,
        citations: work['is-referenced-by-count'],
        retracted: isRetracted ? true : undefined,
        sources: [SCHOLARLY_SOURCE_NAMES.crossref],
    });
}
function crossrefHeaders(keys) {
    return keys?.email ? { 'user-agent': `dsh-zotero/scholarly (mailto:${keys.email})` } : {};
}
export async function searchCrossref(query, http, keys, signal) {
    const filters = [];
    if (query.yearFrom !== undefined)
        filters.push(`from-pub-date:${query.yearFrom}`);
    if (query.yearTo !== undefined)
        filters.push(`until-pub-date:${query.yearTo}`);
    const params = {
        'query.bibliographic': query.query,
        rows: query.limit,
        filter: filters.length > 0 ? filters.join(',') : undefined,
        select: 'DOI,title,author,issued,container-title,abstract,type,is-referenced-by-count,update-to',
        mailto: keys?.email,
    };
    if (query.sort === 'date')
        params.sort = 'published';
    else if (query.sort === 'citations')
        params.sort = 'is-referenced-by-count';
    const url = `https://api.crossref.org/works?${encodeQueryParams(params)}`;
    const body = await http.json(url, {
        signal,
        headers: crossrefHeaders(keys),
        timeoutMs: 30_000,
    });
    return titled((body.message?.items ?? []).map(paperFromCrossref));
}
export async function lookupCrossref(doi, http, keys, signal) {
    const clean = cleanDoi(doi) ?? doi.trim();
    const url = `https://api.crossref.org/works/${encodeURIComponent(clean)}${keys?.email ? `?mailto=${encodeURIComponent(keys.email)}` : ''}`;
    const body = await ignoreNotFound(http.json(url, {
        signal,
        headers: crossrefHeaders(keys),
        timeoutMs: 25_000,
    }));
    return body?.message ? paperFromCrossref(body.message) : undefined;
}
export async function crossrefMatchReference(referenceText, rows, http, keys, signal) {
    const url = `https://api.crossref.org/works?${encodeQueryParams({
        'query.bibliographic': referenceText.slice(0, 600),
        rows,
        select: 'DOI,title,author,issued,container-title,type,update-to',
        mailto: keys?.email,
    })}`;
    const body = await http.json(url, {
        signal,
        headers: crossrefHeaders(keys),
        timeoutMs: 30_000,
    });
    return body.message?.items ?? [];
}
//# sourceMappingURL=crossref.js.map