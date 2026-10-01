/**
 * The `zotero_attachment` tool: resolve an attachment ref to a location the
 * Agent can act on — an on-disk file path (verified to exist) or the linked
 * URL. This is the escalation path for PDFs Zotero has not full-text-indexed.
 * @module dsh-zotero/tools/attachment
 */
import { defineTool, } from '@deepseek-ai/dsh-tools';
import { withConnectivityAsk } from '../ask.js';
import { boundedPresentationMeta, projectAttachmentMeta } from '../presentation-meta.js';
import { metaRecordOf } from './present.js';
import { parseSupportedRef } from './validate.js';
const ATTACHMENT_PARAMETERS = {
    ref: {
        type: 'string',
        required: true,
        description: 'An item ref (Zotero resolves its best attachment) or a zotero://user/0/attachment/<KEY> or zotero://group/<id>/attachment/<KEY> ref for one specific attachment.',
    },
};
const ATTACHMENT_OUTPUT_SCHEMA = {
    oneOf: [
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                ref: { type: 'string', required: true },
                title: { type: 'string', required: true },
                contentType: { type: 'string', required: true },
                kind: { type: 'string', const: 'file', required: true },
                path: { type: 'string', required: true },
            },
        },
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                ref: { type: 'string', required: true },
                title: { type: 'string', required: true },
                contentType: { type: 'string', required: true },
                kind: { type: 'string', const: 'url', required: true },
                url: { type: 'string', required: true },
            },
        },
    ],
};
function buildRequest(args) {
    return { ref: parseSupportedRef(args.ref, ['item', 'attachment']) };
}
/**
 * The file arm states which filesystem its path belongs to. The plugin's
 * loopback pin means it and Zotero run on the same machine, so the path is
 * valid *there* — but the reader is a tool call, and a host may run file
 * access in another environment (a sandbox, a container, a remote worker).
 * Saying so costs one line and saves a turn spent on a path that was never
 * visible to that reader.
 */
export const FILE_ENVIRONMENT_MESSAGE = 'File environment: the machine running Zotero (this plugin only reaches a loopback API, so that is this machine). A reader elsewhere — a sandbox, a container, a remote host — may not see this path.';
function renderAttachment(_args, value) {
    const label = value.title === '' ? value.ref : `${value.title} (${value.ref})`;
    const type = value.contentType || 'unknown type';
    if (value.kind === 'url') {
        return [{ type: 'text', text: `${label} ${type} → ${value.url}` }];
    }
    return [
        {
            type: 'text',
            text: `${label} ${type} → ${value.path}\n${FILE_ENVIRONMENT_MESSAGE}`,
        },
    ];
}
/**
 * The completed attachment card: the resolved title plus whether it is a
 * local file or a linked URL. `meta` is absent on nested code dispatch or
 * malformed replay records, and a failed call keeps the raw error content —
 * both fall back to the generic card.
 */
function presentAttachmentResult(_args, result) {
    const record = metaRecordOf(result);
    if (record === undefined)
        return undefined;
    if (typeof record.title !== 'string' || record.title === '')
        return undefined;
    if (record.kind !== 'file' && record.kind !== 'url')
        return undefined;
    return { card: 'generic', title: `Zotero attachment: ${record.title} (${record.kind})` };
}
export function registerAttachmentTool(ctx, service) {
    ctx.tools.register(defineTool({
        name: 'zotero_attachment',
        description: [
            'Resolve a Zotero ref to a usable attachment location: an item ref yields the best attachment Zotero itself picks,',
            'an attachment ref pinpoints one attachment. Returns the verified on-disk file path, or the linked URL for web-linked attachments.',
            'A file path is valid on the machine running Zotero (the loopback pin keeps the plugin there too); a reader in another environment — sandbox, container, remote host — may not see it, and the call says which environment the path belongs to.',
        ].join(' '),
        parameters: ATTACHMENT_PARAMETERS,
        output: {
            schema: ATTACHMENT_OUTPUT_SCHEMA,
            render: renderAttachment,
            presentationMeta: (_args, value) => boundedPresentationMeta(projectAttachmentMeta(value), ['path', 'url']),
        },
        presentCall: (args) => ({
            card: 'generic',
            kind: 'read',
            title: 'Resolve Zotero attachment',
            rawInput: args.ref,
        }),
        presentResult: presentAttachmentResult,
        isConcurrencySafe: () => true,
        async execute(args, exec) {
            const { ref } = buildRequest(args);
            return await withConnectivityAsk(ctx, service.recovery, exec, () => service.attachment(ref, exec.signal));
        },
    }));
}
//# sourceMappingURL=attachment.js.map