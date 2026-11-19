/**
 * Semantic Scholar adapter querying api.semanticscholar.org Graph API.
 * Provides TLDRs, citation counts, and open-access PDF links.
 * @module dsh-zotero/scholarly/sources/semanticscholar
 */
import { SCHOLARLY_SOURCE_NAMES, } from '../types.js';
import { cleanDoi, encodeQueryParams, ignoreNotFound, parseYear, plain, stripEmptyFields, titled, } from './helpers.js';
const S2_FIELDS = 'title,year,venue,abstract,publicationDate,authors,citationCount,externalIds,openAccessPdf,tldr';
export function paperFromS2(paper) {
    const doi = cleanDoi(paper.externalIds?.DOI);
    const arxiv = paper.externalIds?.ArXiv;
    const pmid = paper.externalIds?.PubMed;
    const rawPmc = paper.externalIds?.PubMedCentral;
    const pmcid = rawPmc
        ? rawPmc.toUpperCase().startsWith('PMC')
            ? rawPmc
            : `PMC${rawPmc}`
        : undefined;
    return stripEmptyFields({
        title: plain(paper.title),
        authors: (paper.authors ?? []).map((a) => plain(a.name)).filter(Boolean),
        year: paper.year ? parseYear(paper.year) : undefined,
        date: paper.publicationDate ?? undefined,
        venue: paper.venue || undefined,
        abstract: paper.abstract ?? undefined,
        tldr: paper.tldr?.text ?? undefined,
        doi,
        arxiv,
        pmid,
        pmcid,
        s2: paper.paperId,
        url: doi
            ? `https://doi.org/${doi}`
            : arxiv
                ? `https://arxiv.org/abs/${arxiv}`
                : paper.paperId
                    ? `https://www.semanticscholar.org/paper/${paper.paperId}`
                    : undefined,
        pdfUrl: paper.openAccessPdf?.url || undefined,
        citations: paper.citationCount,
        sources: [SCHOLARLY_SOURCE_NAMES.semanticscholar],
    });
}
function s2Headers(keys) {
    return keys?.s2Key ? { 'x-api-key': keys.s2Key } : {};
}
export async function searchSemanticScholar(query, http, keys, signal) {
    const yearParam = query.yearFrom !== undefined || query.yearTo !== undefined
        ? `${query.yearFrom ?? ''}-${query.yearTo ?? ''}`
        : undefined;
    const params = {
        query: query.query,
        limit: query.limit,
        fields: S2_FIELDS,
        year: yearParam,
    };
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?${encodeQueryParams(params)}${query.openAccess ? '&openAccessPdf' : ''}`;
    // Every non-2xx reaches the caller: the search endpoint answers an empty
    // result set with 200 and an empty `data`, so a 404 is a path/protocol fault
    // and a 429 is a rate limit the failedSources mechanism must report as an
    // unanswered source (`docs/tools.md` failure semantics) — never as "no
    // results". Only the single-paper lookup normalizes 404 to "no such record",
    // the same contract `crossref.ts` keeps.
    const body = await http.json(url, {
        signal,
        headers: s2Headers(keys),
        timeoutMs: 25_000,
        retries: keys?.s2Key ? 2 : 0,
    });
    return titled((body.data ?? []).map(paperFromS2));
}
export async function lookupSemanticScholar(id, http, keys, signal) {
    const url = `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(id)}?fields=${S2_FIELDS}`;
    const body = await ignoreNotFound(http.json(url, {
        signal,
        headers: s2Headers(keys),
        timeoutMs: 25_000,
        retries: keys?.s2Key ? 2 : 0,
    }));
    return body ? paperFromS2(body) : undefined;
}
//# sourceMappingURL=semanticscholar.js.map