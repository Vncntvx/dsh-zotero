import { defineTool, } from '@deepseek-ai/dsh-tools';
import { metaRecordOf, renderDeclined } from './present.js';
import { DECLINED_OUTPUT_SCHEMA, WRITE_FAILURE_ITEM, libraryVersionLine } from './write-present.js';
import { parseWritableRef, assertWriteList, WRITE_REF_ARG_HINT } from './validate.js';
import { WRITE_PLAN_LIBRARY_LINE, WRITE_PLAN_OUTCOME_DESCRIPTION } from '../write-approval.js';
import { ZOTERO_WRITE_OBJECT_BATCH } from '../constants.js';
const PARAMETERS = {
    refs: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: `Trashed ${WRITE_REF_ARG_HINT} refs to restore.`,
    },
};
/** One restored item: the closed shape `ZoteroRestoreItemResult` carries. */
const RESTORED_ITEM = {
    type: 'object',
    additionalProperties: false,
    properties: {
        ref: { type: 'string', required: true },
        restored: { type: 'boolean', enum: [true], required: true },
        version: { type: 'integer', required: true },
        libraryVersion: { type: 'integer', required: true },
        serverId: { type: 'string' },
    },
};
const OUTPUT = {
    oneOf: [
        DECLINED_OUTPUT_SCHEMA,
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                kind: { type: 'string', enum: ['restored'], required: true },
                restored: { type: 'array', required: true, items: RESTORED_ITEM },
                failed: { type: 'array', required: true, items: WRITE_FAILURE_ITEM },
                serverId: { type: 'string' },
            },
        },
    ],
};
function restoreItemsPlan(args) {
    return [
        '**Restore Zotero Trash items**',
        WRITE_PLAN_LIBRARY_LINE,
        `- Items: ${args.refs.join(', ')}`,
        'Each item is restored with deleted=0 under its own version precondition; failures are reported per ref.',
    ].join('\n');
}
export function renderRestoreItems(_args, value) {
    if (value.kind === 'declined')
        return renderDeclined();
    return [
        {
            type: 'text',
            text: [
                `Restored ${value.restored.length} item(s); ${value.failed.length} failed.`,
                ...value.restored.map((item) => `- Restored ${item.ref} (version ${item.version}). ${libraryVersionLine(item)}`),
                ...value.failed.map((item) => `- Failed ${item.ref ?? `index ${item.index}`}: ${item.code}: ${item.message}${item.completedRefs === undefined ? '' : `\n  Completed refs: ${item.completedRefs.join(', ')}`}`),
            ].join('\n'),
        },
    ];
}
/** Replayable projection: the per-arm counts, so the card can state them without the rows. */
function presentRestoreItemsMeta(_args, value) {
    if (value.kind === 'declined')
        return { kind: 'declined' };
    return {
        kind: 'restored',
        restoredCount: value.restored.length,
        failedCount: value.failed.length,
        ...(value.serverId === undefined ? {} : { serverId: value.serverId }),
    };
}
function presentRestoreItemsResult(_args, result) {
    const record = metaRecordOf(result);
    if (record === undefined)
        return undefined;
    if (record.kind === 'declined') {
        return { card: 'generic', title: 'Zotero restore: declined, nothing written' };
    }
    if (typeof record.restoredCount !== 'number' || typeof record.failedCount !== 'number')
        return undefined;
    return {
        card: 'generic',
        title: `Zotero restore: ${record.restoredCount} restored, ${record.failedCount} failed`,
    };
}
export function registerRestoreItemsTool(ctx, service) {
    return ctx.tools.register(defineTool({
        name: 'zotero_restore_items',
        description: `Restore items from Zotero Trash. ${WRITE_PLAN_OUTCOME_DESCRIPTION}`,
        parameters: PARAMETERS,
        output: {
            schema: OUTPUT,
            render: renderRestoreItems,
            presentationMeta: presentRestoreItemsMeta,
        },
        presentCall: (args) => ({
            card: 'generic',
            kind: 'edit',
            title: 'Restore Zotero Trash items',
            rawInput: `${args.refs.length} items`,
        }),
        presentResult: presentRestoreItemsResult,
        async execute(args, exec) {
            const refs = assertWriteList('refs', args.refs, ZOTERO_WRITE_OBJECT_BATCH).map((ref) => parseWritableRef(ref, ['item']));
            const request = { items: refs };
            return await service.restoreItems(request, {
                exec,
                plan: restoreItemsPlan(args),
            });
        },
    }));
}
//# sourceMappingURL=restore-items.js.map