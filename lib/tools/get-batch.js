/** The `zotero_get_batch` tool: bounded metadata reads with isolated failures. */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { identityToolWrapper } from '../result-delivery.js';
import { asJsonValue } from '../json.js';
import { formatRef, parseSupportedRef } from '../refs.js';
import { invalidArgs } from '../errors.js';
import { GET_BATCH_MAX } from '../local/get-batch-domain.js';
import { projectGetBatchMeta } from '../presentation-meta.js';
const PARAMETERS = {
    refs: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: `Zotero item or attachment refs to read in order; 1–${GET_BATCH_MAX}, unique. Use this for multiple refs instead of repeated zotero_get calls.`,
    },
    fields: {
        type: 'string',
        enum: ['standard', 'all'],
        default: 'standard',
        description: 'Metadata projection; all preserves unconsumed Zotero data fields.',
    },
    include: {
        type: 'object',
        additionalProperties: false,
        properties: {
            children: { type: 'boolean', description: 'Include notes, annotations, and attachments.' },
            attachments: { type: 'boolean', description: 'Include attachments.' },
            relations: { type: 'boolean', description: 'Include item relations when available.' },
            bestAttachment: { type: 'boolean', description: 'Resolve the best attachment location.' },
        },
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
                oneOf: [
                    {
                        type: 'object',
                        additionalProperties: true,
                        properties: {
                            ref: { type: 'string', required: true },
                            status: { type: 'string', const: 'ok', required: true },
                            item: { type: 'object', additionalProperties: true, required: true },
                        },
                    },
                    {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            ref: { type: 'string', required: true },
                            status: { type: 'string', const: 'error', required: true },
                            code: { type: 'string', required: true },
                            message: { type: 'string', required: true },
                            next: { type: 'string' },
                        },
                    },
                ],
            },
        },
        counts: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
                requested: { type: 'integer', required: true },
                succeeded: { type: 'integer', required: true },
                failed: { type: 'integer', required: true },
            },
        },
    },
};
function buildRequest(args) {
    if (args.refs.length === 0)
        invalidArgs('refs must list at least one Zotero ref');
    if (args.refs.length > GET_BATCH_MAX)
        invalidArgs(`refs accepts at most ${GET_BATCH_MAX} refs per call`);
    const seen = new Set();
    const refs = args.refs.map((value) => {
        const ref = parseSupportedRef(value, ['item', 'attachment']);
        const canonical = formatRef(ref);
        if (seen.has(canonical))
            invalidArgs(`refs must be unique; duplicate ref: ${value}`);
        seen.add(canonical);
        return ref;
    });
    return {
        refs,
        ...(args.fields !== undefined ? { fields: args.fields } : {}),
        ...(args.include !== undefined ? { include: args.include } : {}),
    };
}
export function renderGetBatch(_args, value) {
    const lines = [
        `Read ${value.counts.succeeded} of ${value.counts.requested} refs (${value.counts.failed} failed):`,
    ];
    for (const entry of value.items) {
        if (entry.status === 'ok')
            lines.push(`- ${entry.ref}: ${entry.item.title || entry.item.itemType}`);
        else
            lines.push(`- ${entry.ref}: ${entry.code} — ${entry.message}${entry.next === undefined ? '' : ` (${entry.next})`}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
}
export function registerGetBatchTool(ctx, service, wrap = identityToolWrapper) {
    ctx.tools.register(wrap(defineTool({
        name: 'zotero_get_batch',
        description: 'Read multiple Zotero item or attachment refs in one bounded call. Results preserve input order and report each ref independently; use zotero_get for one ref or extra child detail.',
        parameters: PARAMETERS,
        output: {
            schema: OUTPUT,
            render: renderGetBatch,
            presentationMeta: (_args, value) => projectGetBatchMeta(value),
        },
        presentCall: (args) => ({
            card: 'generic',
            kind: 'read',
            title: 'Read Zotero items',
            rawInput: `${args.refs.length} refs`,
        }),
        isConcurrencySafe: () => true,
        async execute(args, exec) {
            const result = await service.getBatch(buildRequest(args), exec.signal);
            return {
                counts: result.counts,
                items: result.items.map((entry) => {
                    if (entry.status === 'error')
                        return entry;
                    const itemRecord = {};
                    for (const [k, v] of Object.entries(entry.item)) {
                        const json = asJsonValue(v);
                        if (json !== undefined)
                            itemRecord[k] = json;
                    }
                    return {
                        ref: entry.ref,
                        status: entry.status,
                        item: itemRecord,
                    };
                }),
            };
        },
    })));
}
//# sourceMappingURL=get-batch.js.map