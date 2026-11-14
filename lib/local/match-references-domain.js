/** Local-only reference reconciliation for BibTeX-like inputs. */
import { deepEqualJson } from '@deepseek-ai/dsh-util-values';
import { mapWithConcurrency } from '../concurrency.js';
import { ZOTERO_LIST_PAGE_ROWS } from '../constants.js';
import { normalizeAuthorForAlignment, normalizeDoiForAlignment, normalizeTitleForAlignment, normalizeYearForAlignment, } from '../export-mapping.js';
import { ZoteroError, ZOTERO_INVALID_ARGUMENT } from '../errors.js';
import { normalizeSearchItem } from '../normalize-search.js';
import { libraryPrefix, PERSONAL_LIBRARY } from '../refs.js';
import { readPagesConcurrentlyFolded } from './pagination.js';
import { buildSearchParams } from './search-query.js';
import { itemsSegmentFor } from './scope-paths.js';
export const MATCH_REFERENCES_MAX = 50;
function clean(value) {
    const trimmed = value?.trim();
    return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}
function titleOf(input) {
    return normalizeTitleForAlignment(clean(input.title));
}
function authorsOf(input) {
    return (input.authors ?? []).map((author) => author.trim()).filter(Boolean);
}
function candidateOf(detail, method, confidence) {
    return {
        ref: detail.ref,
        ...(detail.citationKey === undefined ? {} : { citationKey: detail.citationKey }),
        ...(detail.citationKeySource === undefined
            ? {}
            : { citationKeySource: detail.citationKeySource }),
        title: detail.title,
        ...(detail.authors === undefined ? {} : { authors: detail.authors }),
        ...(detail.year === undefined ? {} : { year: detail.year }),
        ...(detail.doi === undefined ? {} : { doi: detail.doi }),
        ...(detail.venue === undefined ? {} : { venue: detail.venue }),
        ...(detail.citationKeyConflict === undefined
            ? {}
            : { citationKeyConflict: detail.citationKeyConflict }),
        matchMethod: method,
        confidence,
    };
}
function fieldDiffOf(input, candidate) {
    const diff = {};
    const add = (field, expected, actual) => {
        if (expected === undefined || actual === undefined)
            return;
        if (!deepEqualJson(expected, actual)) {
            diff[field] = { input: expected, zotero: actual };
        }
    };
    add('title', clean(input.title), candidate.title);
    add('doi', normalizeDoiForAlignment(clean(input.doi)), normalizeDoiForAlignment(candidate.doi));
    add('year', input.year, candidate.year);
    add('authors', input.authors ? authorsOf(input) : undefined, candidate.authors);
    add('venue', clean(input.venue), candidate.venue);
    return Object.keys(diff).length === 0 ? undefined : diff;
}
/**
 * Zotero's quick-search modes do not index DOI fields. List every top-level
 * metadata page once for this reconciliation call through the shared
 * concurrent page walker, then retain only exact DOI hits. The walker's
 * per-page fences (window honesty, Total-Results, per-page library version)
 * make an incomplete or shifting scan fail closed instead of turning an
 * unseen DOI into `notFound` or a false unique match.
 */
async function candidatesByDoi(deps, dois, signal) {
    const matches = new Map([...dois].map((doi) => [doi, []]));
    if (matches.size === 0)
        return matches;
    // The sweep's scope is fixed: the whole top-level personal library, the
    // same listing the search layer spells for a `{kind:'library'}` scope and
    // the search request's own parameter serialization.
    const path = `${libraryPrefix(PERSONAL_LIBRARY)}/${itemsSegmentFor('top')}`;
    const walked = await readPagesConcurrentlyFolded(deps.client, path, buildSearchParams({
        query: '',
        mode: 'metadata',
        scope: { kind: 'library' },
        sort: 'dateModified',
        direction: 'desc',
        offset: 0,
        limit: ZOTERO_LIST_PAGE_ROWS,
        itemLevel: 'top',
    }), undefined, signal, { body: 'DOI lookup listing', page: 'DOI lookup' }, deps.limits.searchConcurrency, (rows) => rows);
    // Rows normalize after the walk, once the listing's own server id is known,
    // exactly as the search domain qualifies a listing's refs.
    const ctx = {
        library: PERSONAL_LIBRARY,
        ...(walked.serverId === undefined ? {} : { serverId: walked.serverId }),
    };
    for (const page of walked.pages) {
        for (const row of page.value) {
            const item = normalizeSearchItem(row, ctx);
            const doi = normalizeDoiForAlignment(item.doi);
            if (doi === undefined)
                continue;
            const bucket = matches.get(doi);
            if (bucket !== undefined)
                bucket.push(item);
        }
    }
    return matches;
}
export async function matchReferences(deps, request, signal) {
    if (request.references.length === 0 || request.references.length > MATCH_REFERENCES_MAX) {
        throw new ZoteroError(`references must contain 1-${MATCH_REFERENCES_MAX} entries`, ZOTERO_INVALID_ARGUMENT);
    }
    const ids = new Set();
    for (const input of request.references) {
        if (input.inputId.trim() === '' || ids.has(input.inputId.trim())) {
            throw new ZoteroError('references.inputId values must be non-empty and unique', ZOTERO_INVALID_ARGUMENT);
        }
        ids.add(input.inputId.trim());
        if (clean(input.doi) === undefined && titleOf(input) === undefined) {
            throw new ZoteroError('each reference must provide a DOI or title', ZOTERO_INVALID_ARGUMENT);
        }
    }
    const doiValues = new Set(request.references
        .map((input) => normalizeDoiForAlignment(clean(input.doi)))
        .filter((doi) => doi !== undefined));
    const doiMatches = await candidatesByDoi(deps, doiValues, signal);
    const values = await mapWithConcurrency(request.references, 8, async (input) => {
        const searchBy = async (query) => await deps.search({
            query,
            mode: 'metadata',
            scope: { kind: 'library' },
            sort: 'dateModified',
            direction: 'desc',
            offset: 0,
            limit: 20,
            itemLevel: 'top',
        }, signal);
        let incompleteSearch = false;
        const searchCandidates = async (query) => {
            const page = await searchBy(query);
            if (page.nextOffset !== undefined || page.total > page.returned)
                incompleteSearch = true;
            return page;
        };
        const doi = normalizeDoiForAlignment(clean(input.doi));
        const firstQuery = clean(input.doi) ?? clean(input.bibKey) ?? clean(input.title);
        let candidates = doi === undefined
            ? (await searchCandidates(firstQuery)).items
            : [...(doiMatches.get(doi) ?? [])];
        const hasExactDoi = doi !== undefined && candidates.some((item) => normalizeDoiForAlignment(item.doi) === doi);
        if (!hasExactDoi && clean(input.title) !== undefined && clean(input.title) !== firstQuery) {
            const titleResults = await searchCandidates(clean(input.title));
            const byRef = new Map(candidates.map((item) => [item.ref, item]));
            for (const item of titleResults.items)
                byRef.set(item.ref, item);
            candidates = [...byRef.values()];
        }
        const title = titleOf(input);
        const inputAuthors = authorsOf(input)
            .map(normalizeAuthorForAlignment)
            .filter((value) => value !== undefined);
        const scored = candidates
            .map((detail) => {
            const detailDoi = normalizeDoiForAlignment(detail.doi);
            const detailTitleClean = normalizeTitleForAlignment(detail.title);
            const doiMatch = doi !== undefined && detailDoi === doi;
            const keyMatch = clean(input.bibKey) !== undefined &&
                clean(input.bibKey) === detail.citationKey &&
                (doi === undefined || detailDoi === undefined || doiMatch);
            const titleMatch = title !== undefined && detailTitleClean === title;
            const yearMatch = input.year === undefined ||
                normalizeYearForAlignment(String(detail.year)) ===
                    normalizeYearForAlignment(String(input.year));
            const detailAuthors = (detail.authors ?? [])
                .map(normalizeAuthorForAlignment)
                .filter((value) => value !== undefined);
            const authorMatch = inputAuthors.length === 0 ||
                inputAuthors.every((author) => detailAuthors.includes(author));
            const venueMatch = clean(input.venue) === undefined ||
                normalizeTitleForAlignment(input.venue) === normalizeTitleForAlignment(detail.venue);
            const titleCanMatch = titleMatch && (doi === undefined || detailDoi === undefined || doiMatch);
            const score = doiMatch
                ? 1000
                : keyMatch
                    ? 900
                    : titleCanMatch
                        ? 600 +
                            (yearMatch ? 60 : 0) +
                            (authorMatch && inputAuthors.length > 0 ? 40 : 0) +
                            (venueMatch && clean(input.venue) !== undefined ? 10 : 0)
                        : 0;
            const confidence = doiMatch || keyMatch
                ? 'high'
                : titleCanMatch && yearMatch && authorMatch && inputAuthors.length > 0
                    ? 'high'
                    : titleCanMatch && (yearMatch || (authorMatch && inputAuthors.length > 0))
                        ? 'medium'
                        : 'low';
            return {
                detail,
                score,
                method: doiMatch
                    ? 'doi'
                    : keyMatch
                        ? 'citationKey'
                        : titleCanMatch
                            ? 'titleFingerprint'
                            : 'none',
                confidence,
            };
        })
            .filter((entry) => entry.score > 0)
            .sort((a, b) => b.score - a.score);
        const first = scored[0];
        const base = {
            inputId: input.inputId.trim(),
            ...(input.bibKey ? { bibKey: input.bibKey } : {}),
        };
        const incompleteReason = 'The candidate search was truncated; no unique match was selected.';
        if (first === undefined) {
            return incompleteSearch
                ? { ...base, status: 'ambiguous', reason: incompleteReason }
                : { ...base, status: 'notFound' };
        }
        const tied = scored.filter((entry) => entry.score === first.score);
        const candidatesOut = scored
            .slice(0, 5)
            .map((entry) => candidateOf(entry.detail, entry.method, entry.confidence));
        if (tied.length > 1) {
            return {
                ...base,
                status: 'ambiguous',
                ...(incompleteSearch ? { reason: incompleteReason } : {}),
                candidates: candidatesOut,
            };
        }
        if (first.detail.citationKeyConflict !== undefined) {
            return {
                ...base,
                status: 'conflict',
                ...(incompleteSearch ? { reason: incompleteReason } : {}),
                candidates: [candidateOf(first.detail, first.method, first.confidence)],
            };
        }
        if (incompleteSearch) {
            return {
                ...base,
                status: 'ambiguous',
                reason: incompleteReason,
                candidates: candidatesOut,
            };
        }
        if (first.confidence === 'low' || first.confidence === 'medium') {
            return { ...base, status: 'ambiguous', candidates: candidatesOut };
        }
        const selected = candidateOf(first.detail, first.method, first.confidence);
        const result = { ...base, status: 'matched', selected };
        if (request.includeFieldDiff === true) {
            const fieldDiff = fieldDiffOf(input, selected);
            if (fieldDiff !== undefined)
                result.fieldDiff = fieldDiff;
        }
        return result;
    }, { signal });
    return { items: values };
}
//# sourceMappingURL=match-references-domain.js.map