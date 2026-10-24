/**
 * Lawful Open Access full-text resolver.
 *
 * Tries, in order: arXiv HTML, ar5iv HTML, the arXiv PDF, PMC JATS XML via
 * Europe PMC, then an open-access PDF located through OpenAlex, Unpaywall, or
 * Semantic Scholar. Every attempt records why it failed, so the terminal error
 * can name the causes instead of asserting "likely a paywall": a 429, an
 * oversized PDF, and an absent copy are three different facts.
 * @module dsh-zotero/scholarly/fulltext/resolve
 */
import { errorMessageOf } from '../../errors.js';
import { extractArxivId } from '../sources/arxiv.js';
import { cleanDoi } from '../sources/helpers.js';
import { lookupOpenAlex } from '../sources/openalex.js';
import { fetchPmcFullTextXml, lookupEuropePmc } from '../sources/pmc.js';
import { lookupSemanticScholar } from '../sources/semanticscholar.js';
import { arxivHtmlToMarkdown, extractPdfText, jatsToMarkdown } from './markup.js';
export function parsePaperIdentifier(raw) {
    const text = raw.trim();
    const arxiv = extractArxivId(text);
    if (arxiv)
        return { kind: 'arxiv', id: arxiv };
    const pmcMatch = /^(?:PMCID:\s*)?(PMC\d+)$/i.exec(text)?.[1] ??
        /(?:ncbi\.nlm\.nih\.gov|europepmc\.org)\/.*?(PMC\d+)/i.exec(text)?.[1];
    if (pmcMatch)
        return { kind: 'pmcid', id: pmcMatch.toUpperCase() };
    const pmidMatch = /^(?:PMID:\s*)?(\d{4,9})$/i.exec(text)?.[1] ??
        /pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i.exec(text)?.[1];
    if (pmidMatch)
        return { kind: 'pmid', id: pmidMatch };
    const doi = cleanDoi(text);
    if (doi)
        return { kind: 'doi', id: doi };
    if (/^https?:\/\/\S+$/i.test(text))
        return { kind: 'url', id: text };
    return undefined;
}
export function openAlexIdOf(id) {
    switch (id.kind) {
        case 'arxiv':
            return `doi:10.48550/arXiv.${id.id}`;
        case 'doi':
            return `doi:${id.id}`;
        case 'pmid':
            return `pmid:${id.id}`;
        default:
            return undefined;
    }
}
/**
 * Fetch and extract one PDF.
 *
 * Every failure is named. The caller composes the terminal message from these
 * reasons, so "the host rejected us" and "the PDF had no extractable text"
 * never collapse into one claim.
 * @param url - the PDF address.
 * @param http - the scholarly transport.
 * @param signal - caller cancellation.
 * @returns the extracted text or a classified reason.
 */
async function fetchPdfText(url, http, signal) {
    let bytes;
    try {
        bytes = await http.bytes(url, {
            signal,
            timeoutMs: 60_000,
            retries: 0,
            allowPublicPdf: true,
            headers: { accept: 'application/pdf,*/*' },
        });
    }
    catch (error) {
        if (signal?.aborted)
            throw signal.reason ?? error;
        return { kind: 'none', reason: 'fetch', detail: errorMessageOf(error) };
    }
    // PDF magic bytes: %PDF
    if (bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
        return { kind: 'none', reason: 'not-a-pdf', detail: 'response body is not a PDF' };
    }
    let extracted;
    try {
        extracted = await extractPdfText(bytes);
    }
    catch (error) {
        return { kind: 'none', reason: 'parse', detail: errorMessageOf(error) };
    }
    if (extracted.replace(/\[page \d+\]/g, '').trim().length < 500) {
        return { kind: 'none', reason: 'too-short', detail: 'no extractable text' };
    }
    return { kind: 'text', text: extracted };
}
/**
 * Try one HTML route and convert it to Markdown.
 * @param url - the HTML address.
 * @param http - the scholarly transport.
 * @param label - how this route is named in a failure reason.
 * @param signal - caller cancellation.
 * @returns a record, or the named reason it failed.
 */
async function tryHtmlRoute(url, http, label, signal) {
    let html;
    try {
        html = await http.text(url, { signal, timeoutMs: 35_000, retries: 0 });
    }
    catch (error) {
        if (signal?.aborted)
            throw signal.reason ?? error;
        return { kind: 'none', reason: `${label}: ${errorMessageOf(error)}` };
    }
    const markdown = arxivHtmlToMarkdown(html);
    if (markdown === undefined) {
        return { kind: 'none', reason: `${label}: no article body found` };
    }
    return {
        kind: 'record',
        record: { text: markdown, source: label, structured: true, url },
    };
}
/**
 * Resolve an arXiv identifier through HTML, ar5iv, then the PDF.
 * @param id - the arXiv identifier.
 * @param http - the scholarly transport.
 * @param signal - caller cancellation.
 * @returns a record, or the accumulated reasons every route failed.
 */
async function resolveArxivFullText(id, http, signal) {
    const reasons = [];
    const html = await tryHtmlRoute(`https://arxiv.org/html/${id}`, http, "arXiv's HTML version (LaTeXML)", signal);
    if (html.kind === 'record')
        return { record: html.record };
    reasons.push(html.reason);
    const ar5iv = await tryHtmlRoute(`https://ar5iv.labs.arxiv.org/html/${id}`, http, "ar5iv's HTML version", signal);
    if (ar5iv.kind === 'record')
        return { record: ar5iv.record };
    reasons.push(ar5iv.reason);
    const pdfUrl = `https://arxiv.org/pdf/${id}`;
    const pdf = await fetchPdfText(pdfUrl, http, signal);
    if (pdf.kind === 'text') {
        return {
            record: { text: pdf.text, source: 'the arXiv PDF', structured: false, url: pdfUrl },
        };
    }
    reasons.push(`arXiv PDF: ${pdf.reason}${pdf.detail === undefined ? '' : ` (${pdf.detail})`}`);
    return { reasons };
}
export async function resolveScholarlyFullText(target, context) {
    const { http, keys, store, signal } = context;
    const cacheKey = `${target.kind}-${target.id}`;
    const reasons = [];
    if (store !== undefined) {
        const cached = await store.get(cacheKey);
        if (cached.kind === 'hit')
            return cached.record;
        if (cached.kind === 'corrupt') {
            // The corrupt entry is evicted and re-fetched. It is a fact worth naming
            // in the terminal error, not a silent miss.
            reasons.push(`cache: evicted an unusable entry (${cached.reason})`);
        }
    }
    /**
     * Persist one record. The cache is an optimization: a store that refuses the
     * write must not fail the read it just served, so the failure only lands in
     * the reasons list.
     */
    const remember = async (record) => {
        if (store !== undefined) {
            try {
                await store.set(cacheKey, record);
            }
            catch (error) {
                reasons.push(`cache: write failed (${errorMessageOf(error)})`);
            }
        }
        return record;
    };
    // 1. arXiv directly
    if (target.kind === 'arxiv') {
        const resolved = await resolveArxivFullText(target.id, http, signal);
        if ('record' in resolved)
            return await remember(resolved.record);
        throw new Error(`arXiv has no readable copy of ${target.id} right now. Tried: ${resolved.reasons.join('; ')}.`);
    }
    // 2. Direct PDF URL
    if (target.kind === 'url') {
        const pdf = await fetchPdfText(target.id, http, signal);
        if (pdf.kind === 'text') {
            return await remember({
                text: pdf.text,
                source: 'the PDF at that URL',
                structured: false,
                url: target.id,
            });
        }
        throw new Error(`That URL did not yield readable PDF text (${pdf.reason}${pdf.detail === undefined ? '' : `: ${pdf.detail}`}).`);
    }
    // 3. DOI / PMID / PMCID resolution
    let pmcid = target.kind === 'pmcid' ? target.id : undefined;
    let doi = target.kind === 'doi' ? target.id : undefined;
    // Initiate Europe PMC lookup
    const epmcPromise = lookupEuropePmc(target.kind === 'doi'
        ? { doi: target.id }
        : target.kind === 'pmid'
            ? { pmid: target.id }
            : { pmcid: target.id }, http, keys, signal).catch((error) => {
        if (signal?.aborted)
            throw signal.reason ?? error;
        reasons.push(`Europe PMC lookup: ${errorMessageOf(error)}`);
        return undefined;
    });
    // When resolving a DOI, initiate OpenAlex and Unpaywall concurrently with Europe PMC
    const openAlexPromise = doi !== undefined
        ? lookupOpenAlex(`doi:${doi}`, http, keys, signal)
            .then((work) => ({ kind: 'openalex', work }))
            .catch((error) => {
            if (signal?.aborted)
                throw signal.reason ?? error;
            reasons.push(`OpenAlex lookup: ${errorMessageOf(error)}`);
            return undefined;
        })
        : Promise.resolve(undefined);
    const unpaywallPromise = doi !== undefined && keys?.email !== undefined
        ? http
            .json(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(keys.email)}`, { signal, timeoutMs: 25_000 })
            .then((oa) => ({ kind: 'unpaywall', oa }))
            .catch((error) => {
            if (signal?.aborted)
                throw signal.reason ?? error;
            reasons.push(`Unpaywall lookup: ${errorMessageOf(error)}`);
            return undefined;
        })
        : Promise.resolve(undefined);
    const epmc = await epmcPromise;
    if (epmc !== undefined) {
        if (pmcid === undefined && epmc.pmcid !== undefined)
            pmcid = epmc.pmcid;
        if (doi === undefined && epmc.doi !== undefined)
            doi = epmc.doi;
    }
    // If PMC JATS XML is available, this is the highest-priority structured source
    if (pmcid !== undefined) {
        let xml;
        try {
            xml = await fetchPmcFullTextXml(pmcid, http, signal);
        }
        catch (error) {
            if (signal?.aborted)
                throw signal.reason ?? error;
            reasons.push(`PMC full text (${pmcid}): ${errorMessageOf(error)}`);
        }
        if (xml !== undefined) {
            const markdown = jatsToMarkdown(xml);
            if (markdown !== undefined) {
                return await remember({
                    text: markdown,
                    source: `PubMed Central (${pmcid})`,
                    structured: true,
                    url: `https://europepmc.org/article/PMC/${pmcid}`,
                });
            }
            reasons.push(`PMC full text (${pmcid}): JATS XML carried no article body`);
        }
    }
    // Candidate open-access PDFs, in discovery order
    const candidatePdfUrls = [];
    if (epmc?.pdfUrl !== undefined)
        candidatePdfUrls.push({ url: epmc.pdfUrl, from: 'Europe PMC' });
    const attemptedArxivIds = new Set();
    if (doi !== undefined) {
        const [openAlexRes, unpaywallRes] = await Promise.all([openAlexPromise, unpaywallPromise]);
        if (openAlexRes?.work !== undefined) {
            const work = openAlexRes.work;
            const preprintId = work.arxiv ?? (work.pdfUrl ? extractArxivId(work.pdfUrl) : undefined);
            if (preprintId !== undefined) {
                attemptedArxivIds.add(preprintId);
                const preprint = await resolveArxivFullText(preprintId, http, signal);
                if ('record' in preprint) {
                    return await remember({
                        ...preprint.record,
                        source: `${preprint.record.source} (arXiv:${preprintId}, preprint of this paper)`,
                    });
                }
                reasons.push(`preprint arXiv:${preprintId}: ${preprint.reasons.join('; ')}`);
            }
            if (work.pdfUrl !== undefined && !candidatePdfUrls.some((c) => c.url === work.pdfUrl)) {
                candidatePdfUrls.push({ url: work.pdfUrl, from: 'OpenAlex' });
            }
        }
        if (unpaywallRes?.oa !== undefined) {
            const pdf = unpaywallRes.oa.best_oa_location?.url_for_pdf;
            if (pdf !== undefined && pdf !== null && !candidatePdfUrls.some((c) => c.url === pdf)) {
                candidatePdfUrls.push({ url: pdf, from: 'Unpaywall' });
            }
        }
        if (candidatePdfUrls.length === 0) {
            let s2;
            try {
                s2 = await lookupSemanticScholar(`DOI:${doi}`, http, keys, signal);
            }
            catch (error) {
                if (signal?.aborted)
                    throw signal.reason ?? error;
                s2 = undefined;
                reasons.push(`Semantic Scholar lookup: ${errorMessageOf(error)}`);
            }
            if (s2?.pdfUrl !== undefined && !candidatePdfUrls.some((c) => c.url === s2.pdfUrl)) {
                candidatePdfUrls.push({ url: s2.pdfUrl, from: 'Semantic Scholar' });
            }
        }
    }
    // Iterate the discovered PDF addresses
    for (const candidate of candidatePdfUrls.slice(0, 4)) {
        const arxivPreprint = extractArxivId(candidate.url);
        if (arxivPreprint !== undefined && !attemptedArxivIds.has(arxivPreprint)) {
            attemptedArxivIds.add(arxivPreprint);
            const preprint = await resolveArxivFullText(arxivPreprint, http, signal);
            if ('record' in preprint) {
                return await remember({
                    ...preprint.record,
                    source: `${preprint.record.source} (found via ${candidate.from})`,
                });
            }
            reasons.push(`arXiv:${arxivPreprint} via ${candidate.from}: ${preprint.reasons.join('; ')}`);
            continue;
        }
        const pdf = await fetchPdfText(candidate.url, http, signal);
        if (pdf.kind === 'text') {
            return await remember({
                text: pdf.text,
                source: `an open-access PDF (found via ${candidate.from})`,
                structured: false,
                url: candidate.url,
            });
        }
        reasons.push(`open-access PDF via ${candidate.from}: ${pdf.reason}${pdf.detail === undefined ? '' : ` (${pdf.detail})`}`);
    }
    const tried = reasons.length === 0 ? 'no route was available for this identifier' : reasons.join('; ');
    throw new Error(`No open-access full text found for ${target.id}. Tried: ${tried}. ` +
        `If a route above reports a transport failure, the copy may exist but be unreachable right now — ` +
        `retry before concluding it is paywalled. ` +
        `If the user has it in their local Zotero library, read it with zotero_retrieve; ` +
        `otherwise work from the abstract (scholarly_get) and say plainly that no open copy was reachable.`);
}
//# sourceMappingURL=resolve.js.map