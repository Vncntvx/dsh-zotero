import { defineTool, } from '@deepseek-ai/dsh-tools';
import { metaRecordOf, renderDeclined } from './present.js';
import { COMMITTED_UNVERIFIED_VARIANT, DECLINED_OUTPUT_SCHEMA, WRITE_FAILURE_ITEM, libraryVersionLine, } from './write-present.js';
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
        restored: { type: 'boolean', required: true },
        alreadyPresent: { type: 'boolean' },
        version: { type: 'integer', required: true },
        libraryVersion: { type: 'integer' },
        serverId: { type: 'string' },
        children: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                properties: { ref: { type: 'string', required: true } },
            },
        },
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
                unverified: { type: 'array', required: true, items: COMMITTED_UNVERIFIED_VARIANT },
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
        "Each item's whole child graph (attachments, notes, annotations) is restored children-first, every node under its own version precondition, and the graph is read back to prove the restore; failures and unverified receipts are reported per ref with the refs already acknowledged. Never retry an unverified receipt.",
    ].join('\n');
}
export function renderRestoreItems(_args, value) {
    if (value.kind === 'declined')
        return renderDeclined();
    const written = value.restored.filter((item) => item.restored);
    const alreadyLive = value.restored.filter((item) => item.alreadyPresent === true);
    return [
        {
            type: 'text',
            text: [
                `Restored ${written.length} item(s) from Trash; ${alreadyLive.length} already live; ${value.unverified.length} unverified; ${value.failed.length} failed.`,
                ...value.restored.map((item) => {
                    if (item.alreadyPresent === true) {
                        return `- Already live in the library (nothing written): ${item.ref} (version ${item.version}).`;
                    }
                    const children = item.children === undefined
                        ? ''
                        : ` Restored ${item.children.length} child object(s) beside it.`;
                    const version = libraryVersionLine({
                        libraryVersion: item.libraryVersion ?? item.version,
                        serverId: item.serverId,
                    });
                    return `- Restored ${item.ref} (version ${item.version}).${children} ${version}`;
                }),
                ...value.failed.map((item) => `- Failed ${item.ref ?? `index ${item.index}`}: ${item.code}: ${item.message}${item.completedRefs === undefined ? '' : `\n  Completed refs: ${item.completedRefs.join(', ')}`}`),
                ...value.unverified.map((item) => `- Unverified restore outcome for ${item.ref ?? `key ${item.key ?? 'unknown'}`} on server ${item.serverId}: Zotero may have committed it. Do not retry; reconcile the item before further action.`),
            ].join('\n'),
        },
    ];
}
/** Replayable projection: the per-arm counts, so the card can state them without the rows. */
function presentRestoreItemsMeta(_args, value) {
    if (value.kind === 'declined')
        return { kind: 'declined' };
    const alreadyPresentCount = value.restored.filter((item) => item.alreadyPresent === true).length;
    return {
        kind: 'restored',
        restoredCount: value.restored.filter((item) => item.restored).length,
        failedCount: value.failed.length,
        ...(value.unverified.length > 0 ? { unverifiedCount: value.unverified.length } : {}),
        ...(alreadyPresentCount > 0 ? { alreadyPresentCount } : {}),
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
    if (typeof record.restoredCount !== 'number' ||
        typeof record.failedCount !== 'number' ||
        (record.unverifiedCount !== undefined && typeof record.unverifiedCount !== 'number'))
        return undefined;
    const already = typeof record.alreadyPresentCount === 'number' ? record.alreadyPresentCount : 0;
    const unverified = typeof record.unverifiedCount === 'number' ? record.unverifiedCount : 0;
    return {
        card: 'generic',
        title: `Zotero restore: ${record.restoredCount} restored, ${already} already live, ${unverified} unverified, ${record.failedCount} failed`,
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