/**
 * PubMed adapter querying NCBI E-Utilities (esearch.fcgi and efetch.fcgi).
 * @module dsh-zotero/scholarly/sources/pubmed
 */
import { XMLParser } from 'fast-xml-parser';
import { SCHOLARLY_SOURCE_NAMES, } from '../types.js';
import { cleanDoi, combineSearchClauses, encodeQueryParams, parseYear, stripEmptyFields, titled, xmlTextVal, } from './helpers.js';
const pubmedParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    stopNodes: ['*.ArticleTitle', '*.AbstractText'],
    isArray: (name) => ['PubmedArticle', 'Author', 'AbstractText', 'ArticleId'].includes(name),
});
export function parsePubmedXml(xml) {
    const parsed = pubmedParser.parse(xml);
    const articles = parsed.PubmedArticleSet?.PubmedArticle ?? [];
    return titled(articles.map((entry) => {
        const citation = entry.MedlineCitation ?? {};
        const article = citation.Article ?? {};
        const idList = (entry.PubmedData?.ArticleIdList?.ArticleId ?? []);
        const getId = (type) => {
            const found = idList.find((id) => id['@IdType'] === type)?.['#text'];
            return found !== undefined ? String(found) : undefined;
        };
        const abstractParts = (article.Abstract?.AbstractText ?? []).map((part) => {
            const label = typeof part === 'object' && part !== null
                ? part['@Label']
                : undefined;
            return `${label ? `${label}: ` : ''}${xmlTextVal(part)}`;
        });
        const abstract = abstractParts.filter(Boolean).join(' ');
        const pubDate = article.Journal?.JournalIssue?.PubDate ?? {};
        const rawYear = pubDate.Year ?? pubDate.MedlineDate;
        const authors = (article.AuthorList?.Author ?? [])
            .map((a) => a.CollectiveName ? a.CollectiveName : [a.ForeName, a.LastName].filter(Boolean).join(' '))
            .filter(Boolean);
        return stripEmptyFields({
            title: xmlTextVal(article.ArticleTitle).replace(/\.$/, ''),
            authors,
            year: parseYear(rawYear),
            venue: typeof article.Journal?.Title === 'string' ? article.Journal.Title : undefined,
            abstract: abstract || undefined,
            doi: cleanDoi(getId('doi')),
            pmid: xmlTextVal(citation.PMID) || getId('pubmed'),
            pmcid: getId('pmc'),
            sources: [SCHOLARLY_SOURCE_NAMES.pubmed],
        });
    }));
}
export async function searchPubMed(query, http, keys, signal) {
    const base = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
    const common = {
        tool: 'dsh-zotero-scholarly',
        email: keys?.email,
        api_key: keys?.ncbiKey,
    };
    const additional = [];
    if (query.yearFrom !== undefined || query.yearTo !== undefined) {
        const from = query.yearFrom ?? 1800;
        const to = query.yearTo ?? 3000;
        additional.push(`${from}:${to}[dp]`);
    }
    if (query.openAccess) {
        additional.push('free full text[sb]');
    }
    const term = combineSearchClauses(query.query, additional);
    const searchUrl = `${base}/esearch.fcgi?${encodeQueryParams({
        db: 'pubmed',
        term,
        retmax: query.limit,
        retmode: 'json',
        sort: query.sort === 'date' ? 'pub_date' : 'relevance',
        ...common,
    })}`;
    const found = await http.json(searchUrl, {
        signal,
        timeoutMs: 25_000,
    });
    const ids = found.esearchresult?.idlist ?? [];
    if (ids.length === 0)
        return [];
    const fetchUrl = `${base}/efetch.fcgi?${encodeQueryParams({
        db: 'pubmed',
        id: ids.join(','),
        retmode: 'xml',
        ...common,
    })}`;
    const xml = await http.text(fetchUrl, { signal, timeoutMs: 30_000 });
    const papers = parsePubmedXml(xml);
    // Reorder according to the esearch ranking order
    const paperByPmid = new Map();
    for (const p of papers) {
        if (p.pmid)
            paperByPmid.set(p.pmid, p);
    }
    return ids.map((id) => paperByPmid.get(id)).filter((p) => p !== undefined);
}
//# sourceMappingURL=pubmed.js.map