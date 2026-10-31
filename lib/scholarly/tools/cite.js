/**
 * The `scholarly_cite` tool: extracts official citations directly from DOI registration agencies.
 * Supports BibTeX, RIS, CSL JSON, and formatted references (APA, IEEE, Nature, GB/T 7714).
 * @module dsh-zotero/scholarly/tools/cite
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { mapWithConcurrency } from '../../concurrency.js';
import { ZoteroError, ZOTERO_INVALID_ARGUMENT } from '../../errors.js';
import { parsePaperIdentifier } from '../fulltext/resolve.js';
import { httpStatusOf } from '../transport/http.js';
import { lookupEuropePmc } from '../sources/pmc.js';
import { failureTextOf } from './failure.js';
import { SCHOLARLY_TEXT_OUTPUT_DESCRIPTOR, } from './common.js';
/**
 * The content-negotiation `accept` value for each non-prose format.
 *
 * Typed as a total map over the formats that need one: a format added to the
 * tool without an entry here is a compile error, not an `undefined` header that
 * quietly negotiates the registry's default representation.
 */
const FORMAT_MIME_TYPES = {
    bibtex: 'application/x-bibtex',
    ris: 'application/x-research-info-systems',
    csljson: 'application/vnd.citationstyles.csl+json',
};
/** Per-call identifier cap; the description promises it and the executor enforces it. */
const SCHOLARLY_CITE_MAX_IDS = 30;
export function createScholarlyCiteTool(host) {
    return defineTool({
        name: 'scholarly_cite',
        description: 'Get exact official citations directly from DOI registration registries (doi.org): ' +
            'BibTeX, RIS, CSL JSON, or formatted references in any CSL citation style. ' +
            'Always use this tool instead of writing BibTeX entries or citations from memory.',
        parameters: {
            ids: {
                type: 'array',
                required: true,
                items: { type: 'string' },
                description: `DOIs, arXiv IDs, or PMIDs (up to ${SCHOLARLY_CITE_MAX_IDS} items).`,
            },
            format: {
                type: 'string',
                required: true,
                enum: ['bibtex', 'ris', 'csljson', 'text'],
                description: 'Citation format: bibtex, ris, csljson, or text (formatted reference).',
            },
            style: {
                type: 'string',
                default: 'apa',
                description: 'CSL style ID for format="text", e.g. apa, ieee, nature, china-national-standard-gb-t-7714-2015-numeric.',
            },
            locale: {
                type: 'string',
                description: 'Language locale for format="text" terms, e.g. zh-CN, en-US.',
            },
        },
        output: SCHOLARLY_TEXT_OUTPUT_DESCRIPTOR,
        isConcurrencySafe: () => true,
        timeoutMs: 120_000,
        async execute(args, exec) {
            const style = args.style?.trim() || 'apa';
            const acceptHeader = args.format === 'text'
                ? `text/x-bibliography; style=${style}${args.locale ? `; locale=${args.locale}` : ''}`
                : FORMAT_MIME_TYPES[args.format];
            if (!args.ids || args.ids.length === 0) {
                throw new ZoteroError('ids parameter cannot be empty.', ZOTERO_INVALID_ARGUMENT);
            }
            // The cap is part of the tool's contract, so exceeding it is a named
            // refusal: silently dropping ids would answer a different question
            // than the one asked.
            if (args.ids.length > SCHOLARLY_CITE_MAX_IDS) {
                throw new ZoteroError(`ids accepts at most ${SCHOLARLY_CITE_MAX_IDS} identifiers per call; got ${args.ids.length}. Split the list across calls.`, ZOTERO_INVALID_ARGUMENT);
            }
            const targets = args.ids;
            const outcomes = await mapWithConcurrency(targets, 5, async (raw) => {
                const id = parsePaperIdentifier(raw);
                let doi = id?.kind === 'doi'
                    ? id.id
                    : id?.kind === 'arxiv'
                        ? `10.48550/arXiv.${id.id}`
                        : undefined;
                try {
                    if (!doi && (id?.kind === 'pmid' || id?.kind === 'pmcid')) {
                        const pmc = await lookupEuropePmc(id.kind === 'pmid' ? { pmid: id.id } : { pmcid: id.id }, host.http, host.keys(), exec.signal);
                        doi = pmc?.doi;
                    }
                    if (!doi) {
                        return {
                            issue: `${raw}: No DOI found for this item, cannot query registry citation.`,
                        };
                    }
                    const safeDoi = doi.split('/').map(encodeURIComponent).join('/');
                    const citationText = (await host.http.text(`https://doi.org/${safeDoi}`, {
                        headers: { accept: acceptHeader },
                        signal: exec.signal,
                        retries: 1,
                    })).trim();
                    const formatted = args.format === 'bibtex' ? citationText.replace(/^\s+@/, '@') : citationText;
                    return { entry: formatted };
                }
                catch (error) {
                    if (exec.signal.aborted)
                        throw error;
                    const status = httpStatusOf(error);
                    return {
                        issue: `${raw}: ${status === 404 ? 'DOI does not exist on doi.org' : failureTextOf(error)}`,
                    };
                }
            }, { signal: exec.signal });
            const entries = [];
            const issues = [];
            for (const res of outcomes) {
                if (res.entry)
                    entries.push(res.entry);
                if (res.issue)
                    issues.push(res.issue);
            }
            const label = args.format === 'text' ? `style ${style}` : args.format;
            const separator = args.format === 'text' ? '\n' : '\n\n';
            const summary = `Citations from official DOI registries (${label}): ${entries.length} of ${targets.length} resolved.`;
            const problemsText = issues.length > 0 ? `\nUnresolved items:\n${issues.join('\n')}` : '';
            return {
                text: `${summary}\n\n${entries.join(separator)}${problemsText}`,
                citations: entries.map((entry, index) => ({ index, value: entry })),
                issues,
            };
        },
        presentCall: (args) => ({
            card: 'generic',
            title: 'Format scholarly citations',
            rawInput: String(args.format ?? 'bibtex'),
            kind: 'read',
        }),
    });
}
//# sourceMappingURL=cite.js.map