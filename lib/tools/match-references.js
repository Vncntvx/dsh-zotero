/** Match BibTeX-like reference metadata against the local Zotero library. */
import { defineZoteroTool as defineTool } from '../define-tool.js';
import { invalidArgs } from '../errors.js';
import { MATCH_REFERENCES_MAX } from '../local/match-references-domain.js';
import { projectMatchReferencesMeta } from '../presentation-meta.js';
import { identityToolWrapper } from '../result-delivery.js';
const PARAMETERS = {
    references: {
        type: 'array',
        required: true,
        description: `Reference fingerprints; provide a unique inputId and DOI or title. Maximum ${MATCH_REFERENCES_MAX}.`,
        items: {
            type: 'object',
            additionalProperties: false,
            properties: {
                inputId: { type: 'string', required: true },
                bibKey: { type: 'string' },
                doi: { type: 'string' },
                title: { type: 'string' },
                authors: { type: 'array', items: { type: 'string' } },
                year: { type: 'integer' },
                venue: { type: 'string' },
            },
        },
    },
    includeFieldDiff: {
        type: 'boolean',
        default: false,
        description: 'Include input/Zotero field differences where available.',
    },
};
const CANDIDATE = {
    type: 'object',
    additionalProperties: false,
    properties: {
        ref: { type: 'string', required: true },
        title: { type: 'string', required: true },
        citationKey: { type: 'string' },
        citationKeySource: { type: 'string', enum: ['native', 'extra'] },
        citationKeyConflict: {
            type: 'object',
            additionalProperties: false,
            properties: {
                native: { type: 'string', required: true },
                extra: { type: 'string', required: true },
            },
        },
        authors: { type: 'array', items: { type: 'string' } },
        year: { type: 'integer' },
        doi: { type: 'string' },
        venue: { type: 'string' },
        matchMethod: {
            type: 'string',
            enum: ['doi', 'citationKey', 'titleFingerprint'],
            required: true,
        },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'], required: true },
    },
};
const FIELD_DIFF_ENTRY = {
    type: 'object',
    additionalProperties: false,
    properties: {
        input: { type: 'string', required: true },
        zotero: { type: 'string', required: true },
    },
};
const FIELD_DIFF_YEAR = {
    type: 'object',
    additionalProperties: false,
    properties: {
        input: { type: 'integer', required: true },
        zotero: { type: 'integer', required: true },
    },
};
const FIELD_DIFF_AUTHORS = {
    type: 'object',
    additionalProperties: false,
    properties: {
        input: { type: 'array', required: true, items: { type: 'string' } },
        zotero: { type: 'array', required: true, items: { type: 'string' } },
    },
};
const OUTPUT = {
    type: 'object',
    additionalProperties: false,
    properties: {
        items: {
            type: 'array',
            required: true,
            items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    inputId: { type: 'string', required: true },
                    status: {
                        type: 'string',
                        enum: ['matched', 'ambiguous', 'notFound', 'conflict'],
                        required: true,
                    },
                    bibKey: { type: 'string' },
                    reason: { type: 'string' },
                    selected: CANDIDATE,
                    candidates: { type: 'array', items: CANDIDATE },
                    fieldDiff: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            title: FIELD_DIFF_ENTRY,
                            doi: FIELD_DIFF_ENTRY,
                            year: FIELD_DIFF_YEAR,
                            authors: FIELD_DIFF_AUTHORS,
                            venue: FIELD_DIFF_ENTRY,
                        },
                    },
                },
            },
        },
    },
};
function buildRequest(args) {
    if (args.references.length === 0 || args.references.length > MATCH_REFERENCES_MAX)
        invalidArgs(`references must contain 1-${MATCH_REFERENCES_MAX} entries`);
    return {
        references: args.references,
        ...(args.includeFieldDiff === undefined ? {} : { includeFieldDiff: args.includeFieldDiff }),
    };
}
export function renderMatchReferences(_args, value) {
    return [
        {
            type: 'text',
            text: value.items
                .map((item) => {
                const selected = item.selected;
                const candidates = item.candidates ?? [];
                const mapped = selected ?? (candidates.length === 1 ? candidates[0] : undefined);
                if (mapped === undefined)
                    return `${item.inputId}: ${item.status}${item.reason ? ` — ${item.reason}` : ''}`;
                const identity = [
                    mapped.ref,
                    mapped.citationKey && `citationKey=${mapped.citationKey}`,
                    mapped.title,
                ]
                    .filter(Boolean)
                    .join(' · ');
                return `${item.inputId}: ${item.status} -> ${identity} (${mapped.matchMethod}, ${mapped.confidence})${item.reason ? ` — ${item.reason}` : ''}`;
            })
                .join('\n'),
        },
    ];
}
export function registerMatchReferencesTool(ctx, service, wrap = identityToolWrapper) {
    ctx.tools.register(wrap(defineTool({
        name: 'zotero_match_references',
        description: `Match up to ${MATCH_REFERENCES_MAX} external reference fingerprints to local Zotero refs. Exact DOI matching scans paged top-level local metadata once per call because Zotero quick search does not index DOI fields; ambiguous or conflicting matches are reported for review. Use zotero_get_batch for details after matching.`,
        parameters: PARAMETERS,
        output: {
            schema: OUTPUT,
            render: renderMatchReferences,
            presentationMeta: (_args, value) => projectMatchReferencesMeta(value),
        },
        presentCall: (args) => ({
            card: 'generic',
            kind: 'read',
            title: 'Match Zotero references',
            rawInput: `${args.references.length} references`,
        }),
        isConcurrencySafe: () => true,
        async execute(args, exec) {
            return await service.matchReferences(buildRequest(args), exec.signal);
        },
    })));
}
//# sourceMappingURL=match-references.js.map