import { PARSED_SEARCH_TOOL, ZOTERO_MAX_QUERY_CHARS } from '../constants.js';
import { ZOTERO_ARTIFACT_ID_PATTERN } from '../contract.js';
import { defineZoteroTool } from '../define-tool.js';
import { assertIntInRange, assertNonBlank, LIBRARY_SCHEMA, requireLibrary, } from '../tools/validate.js';
import { invalidArgs } from '../errors.js';
import { parseSupportedRef } from '../refs.js';
import { boundedPresentationMeta } from '../presentation-meta.js';
const text = { type: 'string' };
const integer = { type: 'integer' };
const scope = {
    required: true,
    oneOf: [
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                kind: { const: 'library', type: 'string', required: true },
                library: { ...LIBRARY_SCHEMA, required: true },
            },
        },
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                kind: { const: 'collection', type: 'string', required: true },
                ref: { ...text, required: true },
            },
        },
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                kind: { const: 'artifacts', type: 'string', required: true },
                artifactIds: {
                    type: 'array',
                    required: true,
                    items: text,
                },
            },
        },
    ],
};
function queryOf(name, value) {
    const normalized = assertNonBlank(name, value);
    if (value.length > ZOTERO_MAX_QUERY_CHARS)
        invalidArgs(`${name} must be at most ${ZOTERO_MAX_QUERY_CHARS} characters.`);
    return normalized;
}
export function registerParsedSearchTool(ctx, search, wrap) {
    ctx.tools.register(wrap(defineZoteroTool({
        name: PARSED_SEARCH_TOOL,
        description: 'Find lexical evidence in stored MinerU Markdown in an explicit Zotero library, collection, or set of artifact ids. Give up to three alternate phrasings for the same question. Results provide up to three verbatim passages per source with UTF-16 offsets and coverage of stored artifacts. Use zotero_retrieve with the artifactId to read surrounding text.',
        parameters: {
            query: { ...text, required: true },
            queryVariants: { type: 'array', items: text },
            scope,
            limit: { ...integer, default: 20 },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    query: { ...text, required: true },
                    queryTerms: { type: 'array', items: text, required: true },
                    coverage: {
                        type: 'object',
                        required: true,
                        additionalProperties: false,
                        properties: {
                            status: {
                                type: 'string',
                                enum: ['complete', 'partial', 'unavailable'],
                                required: true,
                            },
                            discovered: { ...integer, required: true },
                            searchable: { ...integer, required: true },
                            stale: { ...integer, required: true },
                            missing: { ...integer, required: true },
                        },
                    },
                    passages: {
                        type: 'array',
                        required: true,
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                artifactId: { ...text, required: true },
                                sourceId: { ...text, required: true },
                                generation: { ...text, required: true },
                                mode: { type: 'string', enum: ['free', 'pro'], required: true },
                                fingerprint: { ...text, required: true },
                                attachmentRef: text,
                                itemRef: text,
                                start: { ...integer, required: true },
                                end: { ...integer, required: true },
                                heading: { ...text, required: true },
                                text: { ...text, required: true },
                            },
                        },
                    },
                },
            },
            presentationMeta(_args, { coverage, passages }) {
                const evidenceRefs = [
                    ...new Set(passages.map((p) => p.itemRef ?? p.attachmentRef ?? p.artifactId)),
                ].slice(0, 12);
                return boundedPresentationMeta({
                    mode: 'parsedSearch',
                    coverage,
                    total: passages.length,
                    evidenceRefs,
                    items: passages.slice(0, 12).map((p) => ({
                        source: 'fulltext',
                        sourceRef: p.itemRef ?? p.attachmentRef ?? `artifact:${p.artifactId}`,
                        ...(p.attachmentRef === undefined ? {} : { attachmentRef: p.attachmentRef }),
                        preview: p.text.slice(0, 160),
                        previewTruncated: p.text.length > 160,
                        matchKind: 'lexical',
                        textFormat: 'markdown',
                        start: p.start,
                        end: p.end,
                        artifact: {
                            parser: 'mineru',
                            mode: p.mode,
                            artifactId: p.artifactId,
                            fingerprint: p.fingerprint,
                            sourceId: p.sourceId,
                            generation: p.generation,
                        },
                    })),
                    ...(passages.length > 12 ? { detailOmitted: true } : {}),
                }, ['items']);
            },
            render(_args, result) {
                const { coverage, passages } = result;
                return [
                    {
                        type: 'text',
                        text: [
                            `Stored Markdown coverage ${coverage.status}: ${coverage.searchable}/${coverage.discovered} searchable, ${coverage.stale} stale, ${coverage.missing} missing.`,
                            ...passages.map((p) => [
                                `Artifact ${p.artifactId} generation ${p.generation} [${p.start}, ${p.end})`,
                                p.itemRef,
                                p.attachmentRef,
                                p.heading,
                                p.text,
                            ]
                                .filter(Boolean)
                                .join('\n')),
                        ].join('\n\n'),
                    },
                ];
            },
        },
        isConcurrencySafe: () => false,
        async execute(args, exec) {
            const limit = args.limit ?? 20;
            assertIntInRange('limit', limit, 1, 60);
            const query = queryOf('query', args.query);
            if ((args.queryVariants?.length ?? 0) > 3)
                invalidArgs('queryVariants accepts at most three alternate phrasings.');
            const variants = args.queryVariants?.map((value) => queryOf('queryVariants', value));
            if (args.scope.kind === 'artifacts' &&
                (args.scope.artifactIds.length < 1 ||
                    args.scope.artifactIds.length > 60 ||
                    !args.scope.artifactIds.every((id) => ZOTERO_ARTIFACT_ID_PATTERN.test(id))))
                invalidArgs('scope.artifactIds must contain 1–60 valid parsed artifact IDs.');
            if (args.scope.kind === 'collection')
                parseSupportedRef(args.scope.ref, ['collection']);
            const selected = args.scope.kind === 'library'
                ? { kind: 'library', library: requireLibrary(args.scope.library) }
                : args.scope;
            return await search({ query, variants, scope: selected, limit }, exec.signal);
        },
    })));
}
//# sourceMappingURL=search-parsed-tool.js.map