/**
 * The `zotero_update_item_collections` tool: update one item's collection
 * membership with add and remove settling in a single read-merge-write.
 * Collections are named by ref or exact name; unknown or ambiguous names fail
 * before any write. The plan-review approval runs before Zotero is contacted.
 * @module dsh-zotero/tools/update-item-collections
 */
import { defineTool, } from '@deepseek-ai/dsh-tools';
import { isRefString } from '../refs.js';
import { listUpdatePresentationMeta, presentUpdateResultView, renderUpdateList, UPDATE_ITEM_COLLECTIONS_OUTPUT_SCHEMA, } from './write-present.js';
import { assertAddRemoveSelection, parseWritableRef, WRITE_COLLECTION_REF_ARG_HINT, WRITE_REF_ARG_HINT, } from './validate.js';
import { WRITE_PLAN_OUTCOME_DESCRIPTION, WRITE_PLAN_LIBRARY_LINE } from '../write-approval.js';
const UPDATE_ITEM_COLLECTIONS_PARAMETERS = {
    ref: {
        type: 'string',
        required: true,
        description: `A ${WRITE_REF_ARG_HINT} ref whose membership changes.`,
    },
    add: {
        type: 'array',
        items: { type: 'string' },
        description: `Collections to join: ${WRITE_COLLECTION_REF_ARG_HINT} refs or exact names (zotero_browse lists them).`,
    },
    remove: {
        type: 'array',
        items: { type: 'string' },
        description: `Collections to leave: ${WRITE_COLLECTION_REF_ARG_HINT} refs or exact names.`,
    },
};
/** The deterministic plan markdown the approval card renders. */
export function updateItemCollectionsPlan(args) {
    const add = args.add ?? [];
    const remove = args.remove ?? [];
    return [
        '**Update a Zotero item\u2019s collections**',
        WRITE_PLAN_LIBRARY_LINE,
        `- Item: ${args.ref}`,
        `- Collections to add: ${add.length === 0 ? '(none)' : add.map((c) => c.trim()).join(', ')}`,
        `- Collections to remove: ${remove.length === 0 ? '(none)' : remove.map((c) => c.trim()).join(', ')}`,
        "The item's other collections are preserved; the merged list is written under a version precondition. Names resolve before any write.",
    ].join('\n');
}
function buildRequest(args, config) {
    const { add, remove } = assertAddRemoveSelection(args, config.writeListMaxItems);
    for (const collection of [...add, ...remove]) {
        if (isRefString(collection))
            parseWritableRef(collection, ['collection']);
    }
    return {
        item: parseWritableRef(args.ref, ['item']),
        ...(add.length > 0 ? { add } : {}),
        ...(remove.length > 0 ? { remove } : {}),
    };
}
export function renderUpdateItemCollections(_args, value) {
    return renderUpdateList(value.kind === 'declined' ? value : { ...value, items: value.collections }, {
        noun: 'collections',
        unchangedTarget: 'the requested membership',
        currentLabel: 'Collections now',
    });
}
function presentUpdateItemCollectionsResult(_args, result) {
    return presentUpdateResultView('membership', result);
}
export function registerUpdateItemCollectionsTool(ctx, service) {
    return ctx.tools.register(defineTool({
        name: 'zotero_update_item_collections',
        description: "Update one item's collection membership: add and remove settle in a single read-merge-write under a version precondition, so a concurrent edit fails as ZOTERO_WRITE_CONFLICT and a re-run reapplies. Collections are refs or exact names; an unknown name fails before any write. When the merged membership equals the saved one nothing is written and unchanged is true. " +
            WRITE_PLAN_OUTCOME_DESCRIPTION,
        parameters: UPDATE_ITEM_COLLECTIONS_PARAMETERS,
        output: {
            schema: UPDATE_ITEM_COLLECTIONS_OUTPUT_SCHEMA,
            render: renderUpdateItemCollections,
            presentationMeta: (_args, value) => listUpdatePresentationMeta(value),
        },
        presentCall: (args) => ({
            card: 'generic',
            kind: 'edit',
            title: 'Update Zotero item collections',
            rawInput: [...(args.add ?? []), ...(args.remove ?? [])].join(', '),
        }),
        presentResult: presentUpdateItemCollectionsResult,
        async execute(args, exec) {
            const request = buildRequest(args, service.config);
            return await service.updateItemCollections(request, {
                exec,
                plan: updateItemCollectionsPlan(args),
            });
        },
    }));
}
//# sourceMappingURL=update-item-collections.js.map