/**
 * Europe PMC adapter querying www.ebi.ac.uk for biomedical literature and PMC JATS XML.
 * @module dsh-zotero/scholarly/sources/pmc
 */
import { SCHOLARLY_SOURCE_NAMES, } from '../types.js';
import { cleanDoi, combineSearchClauses, encodeQueryParams, ignoreNotFound, parseYear, plain, stripEmptyFields, titled, } from './helpers.js';
export function paperFromEpmc(result) {
    const pdf = result.fullTextUrlList?.fullTextUrl?.find((entry) => entry.documentStyle === 'pdf' &&
        (entry.availabilityCode === 'OA' || entry.availabilityCode === 'F'))?.url;
    const venue = result.journalInfo?.journal?.title ??
        (result.source === 'PPR' ? result.bookOrReportDetails?.publisher : undefined);
    return stripEmptyFields({
        title: plain(result.title).replace(/\.$/, ''),
        authors: plain(result.authorString)
            .replace(/\.$/, '')
            .split(', ')
            .map((a) => a.trim())
            .filter(Boolean),
        year: parseYear(result.pubYear),
        date: result.firstPublicationDate,
        venue,
        abstract: plain(result.abstractText) || undefined,
        type: result.source === 'PPR' ? 'preprint' : undefined,
        doi: cleanDoi(result.doi),
        pmid: result.pmid,
        pmcid: result.pmcid,
        pdfUrl: pdf,
        openAccess: result.isOpenAccess === 'Y' ? true : undefined,
        citations: result.citedByCount,
        sources: [SCHOLARLY_SOURCE_NAMES.europepmc],
    });
}
export async function searchEuropePmc(query, http, keys, signal) {
    const additional = [];
    if (query.yearFrom !== undefined || query.yearTo !== undefined) {
        const from = query.yearFrom ?? 1800;
        const to = query.yearTo ?? 2100;
        additional.push(`PUB_YEAR:[${from} TO ${to}]`);
    }
    if (query.openAccess) {
        additional.push('OPEN_ACCESS:y');
    }
    const expression = combineSearchClauses(query.query, additional);
    const params = {
        query: expression,
        format: 'json',
        resultType: 'core',
        pageSize: query.limit,
        email: keys?.email,
    };
    if (query.sort === 'date')
        params.sort = 'P_PDATE_D desc';
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?${encodeQueryParams(params)}`;
    const body = await http.json(url, {
        signal,
        timeoutMs: 30_000,
    });
    return titled((body.resultList?.result ?? []).map(paperFromEpmc));
}
export async function lookupEuropePmc(id, http, keys, signal) {
    const expr = id.pmcid !== undefined
        ? `PMCID:${id.pmcid}`
        : id.pmid !== undefined
            ? `EXT_ID:${id.pmid} AND SRC:MED`
            : id.doi !== undefined
                ? `DOI:"${id.doi}"`
                : undefined;
    if (!expr)
        return undefined;
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?${encodeQueryParams({
        query: expr,
        format: 'json',
        resultType: 'core',
        pageSize: 1,
        email: keys?.email,
    })}`;
    const body = await http.json(url, {
        signal,
        timeoutMs: 25_000,
    });
    const first = body.resultList?.result?.[0];
    return first ? paperFromEpmc(first) : undefined;
}
export async function fetchPmcFullTextXml(pmcid, http, signal) {
    const cleanPmcid = pmcid.toUpperCase().startsWith('PMC') ? pmcid : `PMC${pmcid}`;
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/${encodeURIComponent(cleanPmcid)}/fullTextXML`;
    return await ignoreNotFound(http.text(url, { signal, timeoutMs: 35_000 }));
}
//# sourceMappingURL=pmc.js.map