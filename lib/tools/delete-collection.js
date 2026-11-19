import { assertWritePayload } from '../write-bounds.js';
import { planValue } from '../write-plan.js';
import { defineZoteroTool as defineTool } from '../define-tool.js';
import { isRefString } from '../refs.js';
import { ZoteroError, ZOTERO_UNEXPECTED } from '../errors.js';
import { runPreview } from './degradable.js';
import { renderDeclined } from './present.js';
import { DECLINED_OUTPUT_SCHEMA, COMMITTED_UNVERIFIED_VARIANT, libraryVersionLine, presentDeleteResultView, renderCommittedUnverified, unverifiedPresentationMeta, } from '../write-present.js';
import { assertNonBlank, parseWritableRef, WRITE_COLLECTION_REF_ARG_HINT } from './validate.js';
import { WRITE_PLAN_OUTCOME_DESCRIPTION, WRITE_PLAN_LIBRARY_LINE } from '../write-approval.js';
export const DELETE_COLLECTION_PARAMETERS = {
    collection: {
        type: 'string',
        required: true,
        description: `The collection to delete: a ${WRITE_COLLECTION_REF_ARG_HINT} ref or an exact name (zotero_browse lists them). Items keep their library membership; child collections are deleted with the parent.`,
    },
};
const DELETE_COLLECTION_OUTPUT_SCHEMA = {
    oneOf: [
        DECLINED_OUTPUT_SCHEMA,
        COMMITTED_UNVERIFIED_VARIANT,
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
        WRITE_PLAN_LIBRARY_LINE,
        `- Collection: ${planValue(args.collection.trim())}`,
        `- Items in this collection: ${formatCount(preview.itemTotal)} (they stay in the library, membership only)`,
        `- Descendant collections: ${formatCount(preview.childTotal)} (all levels; the whole subtree is deleted with the parent)`,
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
 * browse. Best-effort only where it is genuinely inconclusive: a target that
 * does not exist or a name that matches several collections leaves the count
 * unknown, and the domain reports the miss after approval. Every other failure
 * (a timeout, a transport fault, a protocol change) is rethrown, and a caller
 * cancellation reaches the harness as `TOOL_ABORTED` instead of being folded
 * into a plan (see {@link runPreview}).
 */
async function fetchItemPreview(service, refOrName, signal) {
    return await runPreview(signal, {}, async () => {
        const searched = await service.search({
            mode: 'metadata',
            scope: { kind: 'collection', refOrName },
            sort: 'dateModified',
            direction: 'desc',
            offset: 0,
            limit: 1,
        }, signal, 
        // The preview reads the count and the resolved ref only.
        { includeSupplemental: false });
        return {
            total: searched.total,
            ref: searched.scope.kind === 'collection' ? searched.scope.ref : undefined,
        };
    });
}
async function fetchChildPreview(service, parentRef, signal) {
    return await runPreview(signal, undefined, async () => {
        const pending = [parentRef];
        const seen = new Set([parentRef]);
        for (let index = 0; index < pending.length; index++) {
            let offset = 0;
            while (true) {
                signal?.throwIfAborted();
                const page = await service.browse({ kind: 'collections', parentRef: pending[index], offset, limit: 1 }, signal);
                if (page.items.length === 0) {
                    if (offset < page.total)
                        throw new ZoteroError('Cannot verify the collection subtree: an expected descendant page was empty. Refresh the library and retry the preview.', ZOTERO_UNEXPECTED);
                    break;
                }
                for (const row of page.items) {
                    if (!('ref' in row) || typeof row.ref !== 'string' || seen.has(row.ref))
                        throw new ZoteroError('Cannot verify the collection subtree: a descendant was duplicated or invalid. Check the collection hierarchy before deleting it.', ZOTERO_UNEXPECTED);
                    seen.add(row.ref);
                    pending.push(row.ref);
                }
                offset += page.items.length;
                if (offset >= page.total)
                    break;
            }
        }
        return seen.size - 1;
    });
}
async function previewDeleteCollection(service, collection, signal) {
    const target = collection.trim();
    const directRef = isRefString(target) ? target : undefined;
    let itemTotal;
    let childTotal;
    if (directRef !== undefined) {
        const [itemRes, childRes] = await Promise.all([
            fetchItemPreview(service, directRef, signal),
            fetchChildPreview(service, directRef, signal),
        ]);
        itemTotal = itemRes.total;
        childTotal = childRes;
    }
    else {
        const itemRes = await fetchItemPreview(service, target, signal);
        itemTotal = itemRes.total;
        if (itemRes.ref !== undefined) {
            childTotal = await fetchChildPreview(service, itemRes.ref, signal);
        }
    }
    return {
        ...(itemTotal !== undefined ? { itemTotal } : {}),
        ...(childTotal !== undefined ? { childTotal } : {}),
    };
}
export function renderDeleteCollection(_args, value) {
    if (value.kind === 'declined') {
        return renderDeclined(value);
    }
    if (value.kind === 'committed-unverified')
        return renderCommittedUnverified(value, 'collection', 'committed');
    return [
        {
            type: 'text',
            text: [`Deleted collection ${value.ref}.`, libraryVersionLine(value)].join('\n'),
        },
    ];
}
function presentDeleteCollectionResult(_args, result) {
    return presentDeleteResultView('collection delete', 'collection', result);
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
                : value.kind === 'committed-unverified'
                    ? unverifiedPresentationMeta(value)
                    : { ...value },
        },
        presentCall: (args) => ({
            card: 'generic',
            kind: 'delete',
            title: 'Delete Zotero collection',
            rawInput: args.collection,
        }),
        presentResult: presentDeleteCollectionResult,
        async execute(args, exec) {
            assertWritePayload(args, service.config.writeFieldMaxChars);
            const request = buildRequest(args);
            const preview = await previewDeleteCollection(service, request.collection, exec.signal);
            return await service.deleteCollection(request, {
                exec,
                plan: deleteCollectionPlan(args, preview),
                risk: 'irreversible-delete',
            });
        },
    }));
}
//# sourceMappingURL=delete-collection.js.map