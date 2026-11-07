/**
 * Normalization and Match Lattice entity deduplication for scholarly papers.
 * @module dsh-zotero/scholarly/normalize
 */
import { extractArxivId } from './sources/arxiv.js';
import { parseYear } from './sources/helpers.js';
export function titleKey(title) {
    return title
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}
export const SCHOLARLY_STOPWORDS = new Set([
    'a',
    'an',
    'the',
    'of',
    'for',
    'in',
    'on',
    'and',
    'or',
    'to',
    'with',
    'is',
    'are',
    'via',
    'using',
    'by',
    'from',
    'at',
    'as',
]);
export function titleTokens(title) {
    const words = titleKey(title)
        .split(/\s+/)
        .filter((w) => w.length > 1 && !SCHOLARLY_STOPWORDS.has(w));
    return new Set(words);
}
/**
 * Derives canonical identifier keys for exact index mapping.
 */
export function canonicalKeysOf(paper) {
    const keys = [];
    if (paper.arxiv)
        keys.push(`arxiv:${paper.arxiv.toLowerCase()}`);
    if (paper.doi)
        keys.push(`doi:${paper.doi.toLowerCase()}`);
    if (paper.pmid)
        keys.push(`pmid:${paper.pmid}`);
    const tk = titleKey(paper.title);
    if (tk.length >= 20)
        keys.push(`title:${tk}`);
    return keys;
}
/**
 * Fills in default URLs and aligns DOI/arXiv identities.
 */
export function normalizePaper(paper) {
    const out = {
        ...paper,
        authors: [...(paper.authors ?? [])],
        sources: [...(paper.sources ?? [])],
    };
    // Align arXiv DOI and arXiv ID
    if (!out.arxiv && out.doi) {
        const arxiv = extractArxivId(out.doi);
        if (arxiv) {
            out.arxiv = arxiv;
        }
    }
    if (!out.doi && out.arxiv) {
        out.doi = `10.48550/arXiv.${out.arxiv}`;
    }
    if (!out.pdfUrl && out.arxiv) {
        out.pdfUrl = `https://arxiv.org/pdf/${out.arxiv}`;
    }
    if (!out.url) {
        if (out.arxiv && /^10\.48550\//i.test(out.doi ?? '')) {
            out.url = `https://arxiv.org/abs/${out.arxiv}`;
        }
        else if (out.doi) {
            out.url = `https://doi.org/${out.doi}`;
        }
        else if (out.pmid) {
            out.url = `https://pubmed.ncbi.nlm.nih.gov/${out.pmid}/`;
        }
    }
    if (out.year === undefined && out.date) {
        out.year = parseYear(out.date);
    }
    return out;
}
/**
 * Merges metadata from `source` into `target` using field inheritance rules.
 */
export function mergePaperInto(target, source) {
    const fillIfMissing = (key) => {
        if (target[key] === undefined && source[key] !== undefined) {
            target[key] = source[key];
        }
    };
    // Basic fields
    for (const k of [
        'year',
        'date',
        'venue',
        'tldr',
        'type',
        'arxiv',
        'pmid',
        'pmcid',
        'openalex',
        's2',
        'url',
        'pdfUrl',
    ]) {
        fillIfMissing(k);
    }
    // Published DOI takes precedence over preprint arXiv DOI
    if (source.doi !== undefined &&
        (target.doi === undefined ||
            (/^10\.48550\//i.test(target.doi) && !/^10\.48550\//i.test(source.doi)))) {
        target.doi = source.doi;
    }
    // Abstract: take the longer and richer text
    if (source.abstract && (!target.abstract || source.abstract.length > target.abstract.length)) {
        target.abstract = source.abstract;
    }
    // Authors: take the more complete list
    if (source.authors.length > target.authors.length) {
        target.authors = source.authors;
    }
    // Citations: maximum of all sources
    if (source.citations !== undefined) {
        target.citations = Math.max(target.citations ?? 0, source.citations);
    }
    // Open Access: truthy wins
    if (source.openAccess === true ||
        (target.openAccess === undefined && source.openAccess !== undefined)) {
        target.openAccess = source.openAccess;
    }
    // Retraction: infectious (any retracted source marks paper as retracted)
    if (source.retracted === true) {
        target.retracted = true;
    }
    // Sources union
    for (const src of source.sources) {
        if (!target.sources.includes(src)) {
            target.sources.push(src);
        }
    }
    // In-library link if provided
    if (!target.inLibrary && source.inLibrary) {
        target.inLibrary = source.inLibrary;
    }
}
//# sourceMappingURL=normalize.js.map