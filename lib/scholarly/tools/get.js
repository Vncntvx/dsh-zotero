/**
 * The `scholarly_get` tool: looks up a single paper by identifier or title across all indexes.
 * @module dsh-zotero/scholarly/tools/get
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { bestIdentifierOf, formatPaperDetail, fuseRankedLists } from '../fusion.js';
import { openAlexIdOf, parsePaperIdentifier } from '../fulltext/resolve.js';
import { lookupArxiv } from '../sources/arxiv.js';
import { lookupCrossref } from '../sources/crossref.js';
import { lookupOpenAlex, searchOpenAlex } from '../sources/openalex.js';
import { lookupEuropePmc } from '../sources/pmc.js';
import { lookupSemanticScholar } from '../sources/semanticscholar.js';
import { titleKey } from '../normalize.js';
import { SCHOLARLY_SOURCE_NAMES } from '../types.js';
import { annotateWithLibraryStatus } from '../zotero-link.js';
import { failureTextOf } from './failure.js';
import { ZoteroError, ZOTERO_INVALID_ARGUMENT } from '../../errors.js';
import { SCHOLARLY_TEXT_OUTPUT_DESCRIPTOR, toCleanJsonRecords, } from './common.js';
const GET_PARAMETERS = {
    id: {
        type: 'string',
        required: true,
        description: 'DOI (e.g. 10.1038/nature1234), arXiv ID (e.g. 2301.00001), PMID, PMCID, URL, or exact title.',
    },
};
export function createScholarlyGetTool(host) {
    return defineTool({
        name: 'scholarly_get',
        description: 'Look up one scholarly paper by DOI, arXiv ID, PMID, PMCID, URL, or exact title. ' +
            'Merges metadata across OpenAlex, Crossref, arXiv, Semantic Scholar, and Europe PMC ' +
            'into full abstract, authors, venue, citations, open-access status, and retraction checks.',
        parameters: GET_PARAMETERS,
        output: SCHOLARLY_TEXT_OUTPUT_DESCRIPTOR,
        isConcurrencySafe: () => true,
        timeoutMs: 60_000,
        async execute(args, exec) {
            const raw = args.id.trim();
            if (!raw)
                throw new ZoteroError('id parameter cannot be empty.', ZOTERO_INVALID_ARGUMENT);
            const id = parsePaperIdentifier(raw);
            const keys = host.keys();
            const foundLists = [];
            /**
             * Sources that could not answer, in `${display name} (${reason})` form,
             * the same wording `scholarly_search` reports, so a reader learns one
             * failure vocabulary for the whole subsystem. A source that answered and
             * simply holds no record is not a failure and stays out of this list.
             */
            const failedSources = [];
            /**
             * Await one index read, folding its rejection into `failedSources`.
             *
             * `undefined` means the index answered without holding the work, the
             * legitimate absence a fusion race relies on. Anything else that throws
             * is a transport or registry failure: swallowing it would let a rate
             * limit or a timeout read as "no such paper exists", the exact reading
             * `scholarly_verify` refuses to report. A caller abort is neither and
             * propagates.
             */
            const attempt = async (sourceId, read) => {
                try {
                    return await read();
                }
                catch (error) {
                    if (exec.signal.aborted)
                        throw error;
                    failedSources.push(`${SCHOLARLY_SOURCE_NAMES[sourceId]} (${failureTextOf(error)})`);
                    return undefined;
                }
            };
            const addHit = (sourceId, paper) => {
                if (paper && paper.title) {
                    foundLists.push({ sourceId, papers: [paper] });
                }
            };
            if (id !== undefined && id.kind === 'url') {
                // A bare URL names a resource, not a work. Searching an index for the
                // URL string as a title returns whatever happens to match, and the
                // result then reads like an exact hit, so point at the tool that reads
                // a URL instead of guessing.
                throw new ZoteroError('A URL has no scholarly record to look up. Use scholarly_read with that URL to read its text, ' +
                    'or pass a DOI, arXiv ID, PMID, or PMCID instead.', ZOTERO_INVALID_ARGUMENT);
            }
            if (id === undefined) {
                // Not a structured ID, so search OpenAlex for the closest match by
                // title. This branch queries one source only, so its failure cannot
                // hide behind a race: an empty hit list with a failed source is
                // reported as unanswered, never as "no such paper".
                const hits = (await attempt('openalex', () => searchOpenAlex({ query: raw, limit: 3, sort: 'relevance' }, host.http, keys, exec.signal))) ?? [];
                const wanted = titleKey(raw);
                const exact = hits.find((h) => titleKey(h.title) === wanted);
                addHit('openalex', exact ?? hits[0]);
            }
            else if (id.kind === 'arxiv') {
                const [arx, s2, oa] = await Promise.all([
                    attempt('arxiv', () => lookupArxiv(id.id, host.http, exec.signal)),
                    attempt('semanticscholar', () => lookupSemanticScholar(`ARXIV:${id.id}`, host.http, keys, exec.signal)),
                    attempt('openalex', () => lookupOpenAlex(openAlexIdOf(id), host.http, keys, exec.signal)),
                ]);
                addHit('arxiv', arx);
                addHit('semanticscholar', s2);
                addHit('openalex', oa);
            }
            else if (id.kind === 'doi') {
                const [cr, oa, s2, pmc] = await Promise.all([
                    attempt('crossref', () => lookupCrossref(id.id, host.http, keys, exec.signal)),
                    attempt('openalex', () => lookupOpenAlex(openAlexIdOf(id), host.http, keys, exec.signal)),
                    attempt('semanticscholar', () => lookupSemanticScholar(`DOI:${id.id}`, host.http, keys, exec.signal)),
                    attempt('europepmc', () => lookupEuropePmc({ doi: id.id }, host.http, keys, exec.signal)),
                ]);
                addHit('crossref', cr);
                addHit('openalex', oa);
                addHit('semanticscholar', s2);
                addHit('europepmc', pmc);
            }
            else if (id.kind === 'pmid') {
                const [pmc, oa] = await Promise.all([
                    attempt('europepmc', () => lookupEuropePmc({ pmid: id.id }, host.http, keys, exec.signal)),
                    attempt('openalex', () => lookupOpenAlex(openAlexIdOf(id), host.http, keys, exec.signal)),
                ]);
                addHit('europepmc', pmc);
                addHit('openalex', oa);
            }
            else if (id.kind === 'pmcid') {
                const pmc = await attempt('europepmc', () => lookupEuropePmc({ pmcid: id.id }, host.http, keys, exec.signal));
                addHit('europepmc', pmc);
                if (pmc?.doi) {
                    const oa = await attempt('openalex', () => lookupOpenAlex(`doi:${pmc.doi}`, host.http, keys, exec.signal));
                    addHit('openalex', oa);
                }
            }
            const fused = fuseRankedLists(foundLists);
            const paper = fused[0];
            if (!paper) {
                // Three distinct facts stay distinct. Every index was reached and none
                // holds the work; every index failed, so nothing is known; or a mix.
                // Only the first may say "verify the identifier".
                const unanswered = failedSources.length > 0 ? ` Unanswered sources: ${failedSources.join('; ')}.` : '';
                const remedy = failedSources.length > 0 ? '' : ' Please verify the identifier.';
                return {
                    text: `No scholarly index found a paper matching "${raw}".${unanswered}${remedy}`,
                    papers: [],
                    issues: failedSources,
                };
            }
            // Check collision with Zotero
            const { notice: libraryNotice } = await annotateWithLibraryStatus([paper], host.zoteroService?.(), exec.signal, 'item');
            const idHint = bestIdentifierOf(paper);
            const titlePrefix = id === undefined ? 'Closest match found by title:\n\n' : '';
            // A hit that arrived while other indexes were silent carries their
            // failure forward: the reader must not take silence for "not held".
            const failureNote = failedSources.length > 0 ? `\nNotice: ${failedSources.join('; ')}.` : '';
            return {
                text: `${titlePrefix}${formatPaperDetail(paper)}\n\nCanonical ID for other scholarly tools: ${idHint}${failureNote}${libraryNotice}`,
                papers: toCleanJsonRecords([paper]),
                issues: failedSources,
            };
        },
        presentCall: (args) => ({
            card: 'generic',
            title: 'Get scholarly paper detail',
            rawInput: String(args.id ?? ''),
            kind: 'read',
        }),
    });
}
//# sourceMappingURL=get.js.map