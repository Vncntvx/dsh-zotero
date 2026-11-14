/**
 * arXiv adapter querying the Atom API at export.arxiv.org/api/query.
 * @module dsh-zotero/scholarly/sources/arxiv
 */
import { XMLParser } from 'fast-xml-parser';
import { SCHOLARLY_SOURCE_NAMES } from '../types.js';
import { cleanDoi, encodeQueryParams, parseYear, stripEmptyFields, xmlTextVal } from './helpers.js';
import { SCHOLARLY_STOPWORDS } from '../normalize.js';
const NEW_ARXIV_ID = /(\d{4}\.\d{4,5})(v\d+)?/;
const OLD_ARXIV_ID = /([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/;
const NEW_ARXIV_ID_EXACT = new RegExp(`^${NEW_ARXIV_ID.source}(?:\\.pdf)?$`);
const OLD_ARXIV_ID_EXACT = new RegExp(`^${OLD_ARXIV_ID.source}(?:\\.pdf)?$`);
export function extractArxivId(input) {
    const text = input.trim();
    const scoped = /arxiv\.org\/(?:abs|pdf|html)\/([^\s?#]+)/i.exec(text)?.[1] ??
        /^(?:arxiv:|10\.48550\/arxiv\.)(.+)$/i.exec(text)?.[1] ??
        text;
    const match = NEW_ARXIV_ID_EXACT.exec(scoped) ?? OLD_ARXIV_ID_EXACT.exec(scoped);
    return match?.[1];
}
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    isArray: (name) => name === 'entry' || name === 'author' || name === 'category' || name === 'link',
});
export function parseArxivAtom(xml) {
    const feed = parser.parse(xml).feed;
    const entries = [];
    for (const entry of feed?.entry ?? []) {
        const rawId = /abs\/(.+)$/.exec(xmlTextVal(entry.id))?.[1] ?? '';
        const id = rawId.replace(/v\d+$/, '');
        const title = xmlTextVal(entry.title);
        if (!id || !title || title === 'Error')
            continue;
        const doi = cleanDoi(xmlTextVal(entry['arxiv:doi']));
        const journalRef = xmlTextVal(entry['arxiv:journal_ref']);
        const published = xmlTextVal(entry.published);
        entries.push({
            id,
            title,
            authors: (entry.author ?? [])
                .map((a) => xmlTextVal(a.name))
                .filter(Boolean),
            abstract: xmlTextVal(entry.summary),
            published,
            ...(doi ? { doi } : {}),
            ...(journalRef ? { journalRef } : {}),
            categories: (entry.category ?? [])
                .map((c) => c['@term'] ?? '')
                .filter(Boolean),
        });
    }
    return entries;
}
export function paperFromArxiv(entry) {
    return stripEmptyFields({
        title: entry.title,
        authors: entry.authors,
        year: parseYear(entry.published),
        date: entry.published.slice(0, 10),
        venue: entry.journalRef || 'arXiv',
        type: 'preprint',
        abstract: entry.abstract,
        arxiv: entry.id,
        doi: entry.doi ?? `10.48550/arXiv.${entry.id}`,
        url: `https://arxiv.org/abs/${entry.id}`,
        pdfUrl: `https://arxiv.org/pdf/${entry.id}`,
        openAccess: true,
        sources: [SCHOLARLY_SOURCE_NAMES.arxiv],
    });
}
export function buildArxivSearchQuery(query, anyWord = false) {
    const text = query.query.trim();
    const isFielded = /\b(ti|au|abs|cat|co|jr|rn|all|id):/.test(text);
    const terms = (text.match(/"[^"]+"|[^\s"]+/g) ?? []).filter((term) => !SCHOLARLY_STOPWORDS.has(term.toLowerCase()));
    const words = (anyWord ? [] : terms).map((term) => `(ti:${term} OR abs:${term})`).join(' AND ');
    const parts = [
        isFielded ? `(${text})` : words !== '' ? `(${words})` : `(ti:(${text}) OR abs:(${text}))`,
    ];
    if (query.categories && query.categories.length > 0) {
        parts.push(`(${query.categories.map((c) => `cat:${c}`).join(' OR ')})`);
    }
    if (query.yearFrom !== undefined || query.yearTo !== undefined) {
        const from = String(query.yearFrom ?? 1991).padStart(4, '0');
        const to = String(query.yearTo ?? 2100).padStart(4, '0');
        parts.push(`submittedDate:[${from}01010000 TO ${to}12312359]`);
    }
    return parts.join(' AND ');
}
export async function searchArxiv(query, http, signal) {
    const execute = async (anyWord) => {
        const searchQuery = buildArxivSearchQuery(query, anyWord);
        const url = `https://export.arxiv.org/api/query?${encodeQueryParams({
            search_query: searchQuery,
            start: 0,
            max_results: query.limit,
            sortBy: query.sort === 'date' ? 'submittedDate' : 'relevance',
            sortOrder: 'descending',
        })}`;
        const xml = await http.text(url, { signal, timeoutMs: 30_000, retries: 1 });
        return parseArxivAtom(xml).map(paperFromArxiv);
    };
    const strictHits = await execute(false);
    if (strictHits.length > 0 || query.sort === 'date')
        return strictHits;
    return execute(true);
}
export async function lookupArxiv(arxivId, http, signal) {
    const cleanId = extractArxivId(arxivId) ?? arxivId.trim();
    const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(cleanId)}&max_results=1`;
    const xml = await http.text(url, { signal, timeoutMs: 30_000, retries: 1 });
    const entries = parseArxivAtom(xml);
    return entries[0] ? paperFromArxiv(entries[0]) : undefined;
}
//# sourceMappingURL=arxiv.js.map