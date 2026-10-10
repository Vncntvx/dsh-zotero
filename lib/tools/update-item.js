/**
 * The `zotero_update_item` tool: update one item's scalar metadata fields.
 * Every field must belong to the closed set and be valid for the item's own
 * type (checked against `itemTypeFields`); the PATCH carries wire names under
 * a version precondition. `creators`, `itemType`, `tags`, and `collections`
 * have their own tools and never enter here.
 * @module dsh-zotero/tools/update-item
 */
import { defineTool, } from '@deepseek-ai/dsh-tools';
import { renderDeclined } from './present.js';
import { DECLINED_OUTPUT_SCHEMA, libraryVersionLine, presentUpdateResultView, } from './write-present.js';
import { parseWritableRef, WRITE_REF_ARG_HINT } from './validate.js';
import { validateItemUpdateFields } from '../write-item-rules.js';
import { WRITE_PLAN_OUTCOME_DESCRIPTION, WRITE_PLAN_LIBRARY_LINE } from '../write-approval.js';
const UPDATE_ITEM_PARAMETERS = {
    ref: {
        type: 'string',
        required: true,
        description: `A ${WRITE_REF_ARG_HINT} ref whose metadata changes.`,
    },
    set: {
        type: 'object',
        required: true,
        additionalProperties: false,
        properties: {
            title: { type: 'string' },
            date: { type: 'string' },
            url: { type: 'string' },
            doi: { type: 'string' },
            abstractNote: { type: 'string' },
            publicationTitle: { type: 'string' },
            extra: { type: 'string' },
        },
        description: 'Field updates (at least one): title, date, url, doi, abstractNote, publicationTitle, extra. Each value must be non-blank text and valid for the item type.',
    },
};
const UPDATE_ITEM_OUTPUT_SCHEMA = {
    oneOf: [
        DECLINED_OUTPUT_SCHEMA,
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                kind: { type: 'string', enum: ['applied'], required: true },
                ref: { type: 'string', required: true },
                version: { type: 'integer', required: true },
                changed: { type: 'array', items: { type: 'string' }, required: true },
                libraryVersion: { type: 'integer', required: true },
                serverId: { type: 'string' },
            },
        },
    ],
};
/** The deterministic plan markdown the approval card renders. */
export function updateItemPlan(args) {
    const entries = Object.entries((args.set ?? {}));
    return [
        '**Update a Zotero item**',
        WRITE_PLAN_LIBRARY_LINE,
        `- Item: ${args.ref}`,
        ...entries.map(([field, value]) => `- ${field}: ${String(value).trim().slice(0, 200)}`),
        'Each field must be valid for the item type; an invalid field refuses the write before any PATCH.',
    ].join('\n');
}
function buildRequest(args) {
    const updates = validateItemUpdateFields(args.set);
    return {
        item: parseWritableRef(args.ref, ['item']),
        set: Object.fromEntries(updates),
    };
}
export function renderUpdateItem(_args, value) {
    if (value.kind === 'declined') {
        return renderDeclined();
    }
    return [
        {
            type: 'text',
            text: [
                `Updated ${value.ref} (version ${value.version}); changed ${value.changed.join(', ')}.`,
                libraryVersionLine(value),
            ].join('\n'),
        },
    ];
}
function presentUpdateItemResult(_args, result) {
    return presentUpdateResultView('item', result);
}
export function registerUpdateItemTool(ctx, service) {
    return ctx.tools.register(defineTool({
        name: 'zotero_update_item',
        description: "Update one item's scalar metadata (title, date, url, doi, abstractNote, publicationTitle, extra) under a version precondition. Each field must be valid for the item's type; check zotero_browse kind itemFields first; an invalid field fails as ZOTERO_INVALID_ARGUMENT before any write. Creators, itemType, tags, and collections have their own tools. " +
            WRITE_PLAN_OUTCOME_DESCRIPTION,
        parameters: UPDATE_ITEM_PARAMETERS,
        output: {
            schema: UPDATE_ITEM_OUTPUT_SCHEMA,
            render: renderUpdateItem,
            presentationMeta: (_args, value) => value.kind === 'applied'
                ? {
                    kind: 'applied',
                    ref: value.ref,
                    version: value.version,
                    changedCount: value.changed.length,
                }
                : { kind: 'declined' },
        },
        presentCall: (args) => ({
            card: 'generic',
            kind: 'edit',
            title: 'Update Zotero item',
            rawInput: args.ref,
        }),
        presentResult: presentUpdateItemResult,
        async execute(args, exec) {
            const request = buildRequest(args);
            return await service.updateItem(request, { exec, plan: updateItemPlan(args) });
        },
    }));
}
//# sourceMappingURL=update-item.js.map