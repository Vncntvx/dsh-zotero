/**
 * The `zotero_update_item_tags` tool: update one item's tags with add and
 * remove settling in a single read-merge-write. Existing tag types are
 * preserved; an unchanged merge writes nothing and reports `unchanged`.
 * The plan-review approval runs before Zotero is contacted.
 * @module dsh-zotero/tools/update-item-tags
 */
import { defineTool, } from '@deepseek-ai/dsh-tools';
import { listUpdatePresentationMeta, presentUpdateResultView, renderUpdateList, UPDATE_ITEM_TAGS_OUTPUT_SCHEMA, } from './write-present.js';
import { assertAddRemoveSelection, parseWritableRef, WRITE_REF_ARG_HINT } from './validate.js';
import { WRITE_PLAN_OUTCOME_DESCRIPTION, WRITE_PLAN_LIBRARY_LINE } from '../write-approval.js';
const UPDATE_ITEM_TAGS_PARAMETERS = {
    ref: {
        type: 'string',
        required: true,
        description: `A ${WRITE_REF_ARG_HINT} ref whose tags change.`,
    },
    add: {
        type: 'array',
        items: { type: 'string' },
        description: "Tags to add. They merge with the item's existing tags: what is already there stays, including its colored/automatic types; duplicates collapse.",
    },
    remove: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags to remove, matched exactly. Unknown names are ignored.',
    },
};
/** The deterministic plan markdown the approval card renders. */
export function updateItemTagsPlan(args) {
    const add = args.add ?? [];
    const remove = args.remove ?? [];
    return [
        '**Update tags on a Zotero item**',
        WRITE_PLAN_LIBRARY_LINE,
        `- Item: ${args.ref}`,
        `- Tags to add: ${add.length === 0 ? '(none)' : add.map((tag) => tag.trim()).join(', ')}`,
        `- Tags to remove: ${remove.length === 0 ? '(none)' : remove.map((tag) => tag.trim()).join(', ')}`,
        'Other tags on the item are preserved; the merged list is written under a version precondition.',
    ].join('\n');
}
function buildRequest(args, config) {
    const { add, remove } = assertAddRemoveSelection(args, config.writeListMaxItems);
    return {
        item: parseWritableRef(args.ref, ['item']),
        ...(add.length > 0 ? { add } : {}),
        ...(remove.length > 0 ? { remove } : {}),
    };
}
export function renderUpdateItemTags(_args, value) {
    return renderUpdateList(value.kind === 'declined' ? value : { ...value, items: value.tags }, {
        noun: 'tags',
        unchangedTarget: 'the requested tag set',
        currentLabel: 'Tags now',
    });
}
function presentUpdateItemTagsResult(_args, result) {
    return presentUpdateResultView('tags', result);
}
export function registerUpdateItemTagsTool(ctx, service) {
    return ctx.tools.register(defineTool({
        name: 'zotero_update_item_tags',
        description: "Update one item's tags: add and remove settle in a single read-merge-write under a version precondition, so a concurrent edit fails as ZOTERO_WRITE_CONFLICT and a re-run reapplies. Existing tags and their types are preserved except for removals. When the merged set equals the saved set nothing is written and unchanged is true. " +
            WRITE_PLAN_OUTCOME_DESCRIPTION,
        parameters: UPDATE_ITEM_TAGS_PARAMETERS,
        output: {
            schema: UPDATE_ITEM_TAGS_OUTPUT_SCHEMA,
            render: renderUpdateItemTags,
            presentationMeta: (_args, value) => listUpdatePresentationMeta(value),
        },
        presentCall: (args) => ({
            card: 'generic',
            kind: 'edit',
            title: 'Update Zotero item tags',
            rawInput: [...(args.add ?? []), ...(args.remove ?? [])].join(', '),
        }),
        presentResult: presentUpdateItemTagsResult,
        // timeoutMs is deliberately omitted: the plan-review card waits on user
        // think time, which is not a stuck request.
        async execute(args, exec) {
            // No connectivity ask wraps the write: that helper retries, and only
            // idempotent reads may be retried. The plan review is the seam's
            // (service.updateItemTags), so no caller can skip it.
            const request = buildRequest(args, service.config);
            return await service.updateItemTags(request, { exec, plan: updateItemTagsPlan(args) });
        },
    }));
}
//# sourceMappingURL=update-item-tags.js.map