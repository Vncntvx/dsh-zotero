/**
 * The `zotero_delete_collection` tool: delete a collection by ref or exact
 * name. The plan card carries the blast radius first (item and subcollection
 * counts read before approval); the delete itself carries the library version
 * of its preceding read, so a concurrent write fails it. Entries keep their
 * items; child collections go with the parent.
 * @module dsh-zotero/tools/delete-collection
 */
import { defineTool, } from '@deepseek-ai/dsh-tools';
import { isRefString } from '../refs.js';
import { metaRecordOf, renderDeclined } from './present.js';
import { libraryVersionLine } from './write-present.js';
import { assertNonBlank, parseWritableRef, WRITE_COLLECTION_REF_ARG_HINT } from './validate.js';
import { WRITE_PLAN_OUTCOME_DESCRIPTION } from '../write-approval.js';
const DELETE_COLLECTION_PARAMETERS = {
    collection: {
        type: 'string',
        required: true,
        description: `The collection to delete: a ${WRITE_COLLECTION_REF_ARG_HINT} ref or an exact name (zotero_browse lists them). Items keep their library membership; child collections are deleted with the parent.`,
    },
};
const DELETE_COLLECTION_OUTPUT_SCHEMA = {
    oneOf: [
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                kind: { type: 'string', enum: ['declined'], required: true },
            },
        },
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                kind: { type: 'string', enum: ['deleted'], required: true },
                ref: { type: 'string', required: true },
                key: { type: 'string', required: true },
                deleted: { type: 'boolean', enum: [true], required: true },
                libraryVersion: { type: 'integer', required: true },
                serverId: { type: 'string' },
            },
        },
    ],
};
function formatCount(value) {
    return value === undefined ? 'unknown' : String(value);
}
/** The deterministic plan markdown the approval card renders, with the previewed radius. */
export function deleteCollectionPlan(args, preview = {}) {
    return [
        '**Delete a Zotero collection**',
        '- Library: zotero://user/0 (the local personal library)',
        `- Collection: ${args.collection.trim()}`,
        `- Items in this collection: ${formatCount(preview.itemTotal)} (they stay in the library, membership only)`,
        `- Child collections: ${formatCount(preview.childTotal)} (they are deleted with the parent)`,
        'This deletes the collection structure and cannot be undone; the delete carries a version precondition, so a concurrent change fails it.',
    ].join('\n');
}
function buildRequest(args) {
    const collection = assertNonBlank('collection', args.collection);
    if (isRefString(collection))
        parseWritableRef(collection, ['collection']);
    return { collection };
}
/**
 * Read the blast radius before the plan card: the item count via the
 * collection search scope and the child-collection count via the collections
 * browse. Best-effort — an unresolvable name leaves its count unknown and the
 * domain reports the miss after approval.
 */
async function previewDeleteCollection(service, collection) {
    let itemTotal;
    let childTotal;
    try {
        const searched = await service.search({
            mode: 'metadata',
            scope: { kind: 'collection', refOrName: collection },
            sort: 'dateModified',
            direction: 'desc',
            offset: 0,
            limit: 1,
        }, undefined);
        itemTotal = searched.total;
    }
    catch {
        itemTotal = undefined;
    }
    if (isRefString(collection.trim())) {
        try {
            const browsed = await service.browse({ kind: 'collections', parentRef: collection.trim(), offset: 0, limit: 1 }, undefined);
            childTotal = browsed.total;
        }
        catch {
            childTotal = undefined;
        }
    }
    return {
        ...(itemTotal !== undefined ? { itemTotal } : {}),
        ...(childTotal !== undefined ? { childTotal } : {}),
    };
}
export function renderDeleteCollection(_args, value) {
    if (value.kind === 'declined') {
        return renderDeclined();
    }
    return [
        {
            type: 'text',
            text: [`Deleted collection ${value.ref}.`, libraryVersionLine(value)].join('\n'),
        },
    ];
}
function presentDeleteCollectionResult(_args, result) {
    const record = metaRecordOf(result);
    if (record === undefined)
        return undefined;
    if (record.kind === 'declined') {
        return { card: 'generic', title: 'Zotero collection delete: declined, nothing written' };
    }
    const ref = typeof record.ref === 'string' ? record.ref : '';
    return { card: 'generic', title: `Zotero collection deleted${ref === '' ? '' : `: ${ref}`}` };
}
export function registerDeleteCollectionTool(ctx, service) {
    return ctx.tools.register(defineTool({
        name: 'zotero_delete_collection',
        description: 'Delete a collection in the Zotero personal library, by ref or exact name. Items in the collection stay in the library (membership only); child collections are deleted with the parent and the structure cannot be restored. The plan card states the item and child-collection counts first. ' +
            WRITE_PLAN_OUTCOME_DESCRIPTION,
        parameters: DELETE_COLLECTION_PARAMETERS,
        output: {
            schema: DELETE_COLLECTION_OUTPUT_SCHEMA,
            render: renderDeleteCollection,
            presentationMeta: (_args, value) => value.kind === 'deleted'
                ? { kind: 'deleted', ref: value.ref, key: value.key }
                : { kind: 'declined' },
        },
        presentCall: (args) => ({
            card: 'generic',
            kind: 'edit',
            title: 'Delete Zotero collection',
            rawInput: args.collection,
        }),
        presentResult: presentDeleteCollectionResult,
        async execute(args, exec) {
            const request = buildRequest(args);
            const preview = await previewDeleteCollection(service, request.collection);
            return await service.deleteCollection(request, {
                exec,
                plan: deleteCollectionPlan(args, preview),
            });
        },
    }));
}
//# sourceMappingURL=delete-collection.js.map