/**
 * The `scholarly_read` tool: reads open-access full text of papers (arXiv, PMC, OA PDF).
 * Provides section outlines, section extraction, and natural-language passage matching.
 * @module dsh-zotero/scholarly/tools/read
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { extractOutline, findSection, rankPassages } from '../fulltext/evidence-bridge.js';
import { parsePaperIdentifier, resolveScholarlyFullText } from '../fulltext/resolve.js';
import { ZoteroError, ZOTERO_INVALID_ARGUMENT } from '../../errors.js';
import { ZOTERO_MAX_QUERY_VARIANTS } from '../../constants.js';
import { queryVariantsOf } from '../../tools/query-variants.js';
import { DEFAULT_SPILL_CHAR_THRESHOLD, trySpillToolOutput } from '../../spill.js';
import { presentJobArm, RUN_IN_BACKGROUND_PARAMETER } from '../../job-runner.js';
import { metaRecordOf } from '../../tools/present.js';
import { SCHOLARLY_JOB_OUTPUT_DESCRIPTOR, runScholarlyJob } from './jobs.js';
import { toCleanJsonRecord } from './common.js';
/**
 * The message an empty query match returns. It states what the call found and
 * refuses the stronger claim: a reader told "no relevant passage" reasonably
 * concludes the paper is silent on the subject, which this call cannot know.
 * The meaning clause appears only when the semantic route actually ran —
 * claiming a comparison the call never made would be its own falsehood.
 * @param query - the query that matched nothing.
 * @param routes - the routes that ran; `semantic` present means meaning was scored.
 * @returns the model-facing explanation.
 */
export function noPassageMessage(query, routes) {
    const compared = routes.includes('semantic') === true
        ? 'neither its terms nor its meaning'
        : 'its terms (semantic ranking was not part of this call)';
    return (`No passage in this text matched "${query}" — ${compared}. ` +
        'That describes this query against this text; it is not evidence that the paper says nothing on the subject. ' +
        'Rephrase the question, pass queryVariants with your own paraphrases (the field\u2019s terminology, synonyms), ' +
        'or read the section directly with section="...".');
}
export const PLAIN_TEXT_OUTLINE_MESSAGE = 'This copy contains plain text extracted from a PDF and has no section headings. Read in chunks or search with query.';
export const MARKDOWN_OUTLINE_MESSAGE = 'This Markdown copy has no section headings. Read in chunks or search with query.';
export const NO_SECTION_HEADINGS_MESSAGE = 'This copy has no section headings; read in chunks or use query.';
export function createScholarlyReadTool(host, options = {}) {
    const background = options.background ?? true;
    return defineTool({
        name: 'scholarly_read',
        description: 'Read the open-access full text of a paper (arXiv, PubMed Central, or an open-access PDF). ' +
            'Use outline=true to list sections, section="..." to read a specific section, ' +
            'or query="..." to find the passages answering a specific question.',
        parameters: {
            id: {
                type: 'string',
                required: true,
                description: 'arXiv ID, DOI, PMID, PMCID, or a direct PDF URL.',
            },
            outline: {
                type: 'boolean',
                description: 'Set to true to inspect the hierarchical table of contents.',
            },
            section: {
                type: 'string',
                description: 'Read a specific section by section number (e.g. "3" or "3.1") or title (e.g. "Methods").',
            },
            query: {
                type: 'string',
                description: 'Find passages matching a question or concept by passage ranking.',
            },
            queryVariants: {
                type: 'array',
                items: { type: 'string' },
                description: `With query: more phrasings of the same question, at most ${ZOTERO_MAX_QUERY_VARIANTS}; each is a separate scoring pass and the best score per passage wins.`,
            },
            passages: {
                type: 'integer',
                default: 5,
                description: 'With query: how many passages to return (default 5, max 12).',
            },
            start: {
                type: 'integer',
                default: 0,
                description: 'Character offset for continuation in chunked reading.',
            },
            max_chars: {
                type: 'integer',
                description: 'Maximum characters per chunk (defaults to the configured maxContentChars).',
            },
            ...(background ? RUN_IN_BACKGROUND_PARAMETER : {}),
        },
        output: SCHOLARLY_JOB_OUTPUT_DESCRIPTOR,
        isConcurrencySafe: () => true,
        timeoutMs: 180_000,
        async execute(args, exec) {
            const raw = args.id.trim();
            const parsedId = parsePaperIdentifier(raw);
            if (!parsedId) {
                throw new ZoteroError('Please provide a valid arXiv ID, DOI, PMID, PMCID, or public PDF URL.', ZOTERO_INVALID_ARGUMENT);
            }
            const queryVariants = queryVariantsOf(args.queryVariants);
            return await runScholarlyJob({
                host,
                exec,
                label: `scholarly_read (${raw})`,
                runInBackground: args.run_in_background === true,
                run: async (signal, onProgress) => {
                    // Admit the ranking scope before any source I/O: an accepted read
                    // keeps its committed model/config generation for its whole
                    // lifetime, even if the component unmounts mid-download. Outline and
                    // section reads without a query need no ranking scope.
                    const rankingRanker = args.query?.trim() ? host.evidenceRanker() : undefined;
                    const rankingScope = rankingRanker?.admit?.();
                    try {
                        onProgress({ phase: 'resolve', message: `Resolving full text for ${raw}` });
                        const fullText = await resolveScholarlyFullText(parsedId, {
                            http: host.http,
                            keys: await host.keys(),
                            store: host.cache,
                            signal,
                            enhancer: host.enrichmentEnhancer?.(),
                        });
                        onProgress({
                            phase: 'read',
                            message: `Read ${fullText.text.length} characters from ${fullText.source}`,
                        });
                        const sections = fullText.format === 'markdown' ? extractOutline(fullText.text) : [];
                        const documentSource = {
                            id: raw,
                            provider: fullText.provider,
                            format: fullText.format,
                            source: fullText.source,
                            url: fullText.url,
                            sourceIdentity: fullText.sourceIdentity,
                            ...(fullText.provider === 'mineru' ? { provenance: fullText.provenance } : {}),
                        };
                        const header = `${raw} — ${fullText.text.length} characters (source: ${fullText.source})${fullText.url ? `\nLink: ${fullText.url}` : ''}`;
                        // 1. Inspect Table of Contents
                        if (args.outline) {
                            if (sections.length === 0) {
                                return {
                                    text: `${header}\n\nNotice: ${fullText.format === 'text' ? PLAIN_TEXT_OUTLINE_MESSAGE : MARKDOWN_OUTLINE_MESSAGE}`,
                                    document: toCleanJsonRecord({
                                        ...documentSource,
                                        sections: [],
                                    }),
                                };
                            }
                            const outlineText = sections
                                .map((sec) => `${'  '.repeat(Math.min(3, sec.level - 1))}${sec.id}. ${sec.title} (${sec.end - sec.start} chars)`)
                                .join('\n');
                            return {
                                text: `${header}\n\nSections (use section="..." to read):\n${outlineText}`,
                                document: toCleanJsonRecord({
                                    ...documentSource,
                                    sections: sections.map((sec) => ({
                                        id: sec.id,
                                        title: sec.title,
                                        level: sec.level,
                                    })),
                                }),
                            };
                        }
                        let activeText = fullText.text;
                        let sourceStart = 0;
                        let scopeLabel = '';
                        // 2. Read specific Section
                        if (args.section?.trim()) {
                            const sec = findSection(sections, args.section);
                            if (!sec) {
                                const available = sections
                                    .filter((s) => s.level <= 2)
                                    .map((s) => `"${s.id}. ${s.title}"`)
                                    .join(', ');
                                throw new ZoteroError(sections.length === 0
                                    ? NO_SECTION_HEADINGS_MESSAGE
                                    : `Section "${args.section}" not found. Available main sections: ${available}`, ZOTERO_INVALID_ARGUMENT);
                            }
                            activeText = fullText.text.slice(sec.start, sec.end);
                            sourceStart = sec.start;
                            scopeLabel = ` [Section ${sec.id}: ${sec.title}]`;
                        }
                        // 3. Passage matching against a natural-language question
                        if (args.query?.trim() && rankingRanker !== undefined) {
                            const numPassages = Math.min(12, Math.max(1, args.passages ?? 5));
                            const limits = host.evidenceChunkLimits();
                            const { passages: ranked, routes } = await rankPassages({
                                ranker: rankingRanker,
                                text: activeText,
                                query: args.query.trim(),
                                limit: numPassages,
                                maxWords: limits.chunkWords,
                                maxCharsPerChunk: limits.chunkChars,
                                ...(queryVariants === undefined ? {} : { queryVariants }),
                                signal,
                                ...(rankingScope === undefined ? {} : { scope: rankingScope.handle }),
                            });
                            onProgress({
                                phase: 'rank',
                                message: `Ranked ${ranked.length} passages for "${args.query.trim()}"`,
                            });
                            if (ranked.length === 0) {
                                return {
                                    text: `${header}${scopeLabel}\n\n${noPassageMessage(args.query.trim(), routes)}`,
                                    document: toCleanJsonRecord({
                                        ...documentSource,
                                        query: args.query,
                                        passages: [],
                                    }),
                                };
                            }
                            const sourcePassages = ranked.map((passage) => ({
                                ...passage,
                                start: passage.start + sourceStart,
                                end: passage.end + sourceStart,
                            }));
                            const passagesText = sourcePassages
                                .map((p, idx) => `--- Passage ${idx + 1} (${p.matchKind} match, chars ${p.start}-${p.end}) ---\n${p.text.trim()}`)
                                .join('\n\n');
                            return {
                                text: `${header}${scopeLabel}\n\nTop passages matching "${args.query}":\n\n${passagesText}`,
                                document: toCleanJsonRecord({
                                    ...documentSource,
                                    query: args.query,
                                    passages: sourcePassages.map(toCleanJsonRecord),
                                }),
                            };
                        }
                        // 4. Default Chunked Reading
                        const maxChars = host.maxContentChars ? host.maxContentChars() : 12_000;
                        const start = Math.min(activeText.length, Math.max(0, args.start ?? 0));
                        const chunkSize = Math.min(maxChars, Math.max(500, args.max_chars ?? maxChars));
                        const end = Math.min(activeText.length, start + chunkSize);
                        const isTruncated = end < activeText.length;
                        let spillRef;
                        if (isTruncated && activeText.length > DEFAULT_SPILL_CHAR_THRESHOLD && host.ctx) {
                            spillRef = await trySpillToolOutput(host.ctx, exec, `${raw.replace(/[^a-zA-Z0-9._-]/g, '_')}-fulltext.txt`, activeText);
                        }
                        const spillNotice = spillRef !== undefined
                            ? `\nFull paper text saved to spill storage: ${spillRef.locator}. ${spillRef.retrievalHint}`
                            : '';
                        const statusTail = isTruncated
                            ? `is_truncated: true, next_start: ${end}${spillNotice}`
                            : 'is_truncated: false (end of section/text)';
                        const hint = start === 0 && isTruncated && sections.length > 0 && !scopeLabel
                            ? ' (Tip: This paper has section headings; use outline=true to inspect them).'
                            : '';
                        onProgress({
                            phase: 'chunk',
                            message: `Returning characters ${start}–${end} of ${activeText.length}`,
                        });
                        return {
                            text: `${header}${scopeLabel}\nCharacters ${start}–${end}; ${statusTail}.${hint}\n\n${activeText.slice(start, end)}`,
                            document: toCleanJsonRecord({
                                ...documentSource,
                                start,
                                end,
                                sourceStart: sourceStart + start,
                                sourceEnd: sourceStart + end,
                                isTruncated,
                                text: activeText.slice(start, end),
                            }),
                            ...(spillRef !== undefined ? { spill: spillRef } : {}),
                        };
                    }
                    finally {
                        rankingScope?.release();
                    }
                },
            });
        },
        presentCall: (args) => {
            const isOutline = Boolean(args.outline);
            const id = String(args.id ?? '');
            return {
                card: 'generic',
                title: isOutline ? 'Read paper outline' : 'Read paper full text',
                rawInput: id,
                kind: 'read',
            };
        },
        presentResult: (_args, result) => presentJobArm('Scholarly read', metaRecordOf(result) ?? {}),
    });
}
//# sourceMappingURL=read.js.map