import { assertWritePayload } from '../write-bounds.js';
import { planValue } from '../write-plan.js';
import { defineZoteroTool as defineTool } from '../define-tool.js';
import { isRefString } from '../refs.js';
import { renderDeclined } from './present.js';
import { APPLIED_ENVELOPE_PROPERTIES, COMMITTED_UNVERIFIED_VARIANT, createWritePresentationMeta, DECLINED_OUTPUT_SCHEMA, libraryVersionLine, presentCreateResultView, renderCommittedUnverified, } from '../write-present.js';
import { assertNonBlank, parseWritableRef, WRITE_COLLECTION_REF_ARG_HINT } from './validate.js';
import { WRITE_PLAN_OUTCOME_DESCRIPTION, WRITE_PLAN_LIBRARY_LINE } from '../write-approval.js';
export const CREATE_COLLECTION_PARAMETERS = {
    name: {
        type: 'string',
        required: true,
        description: 'The new collection name (non-blank). A sibling with the same name refuses the write.',
    },
    parent: {
        type: 'string',
        description: `The parent collection: a ${WRITE_COLLECTION_REF_ARG_HINT} ref or an exact name. Omit for a top-level collection.`,
    },
};
const CREATE_COLLECTION_OUTPUT_SCHEMA = {
    oneOf: [
        DECLINED_OUTPUT_SCHEMA,
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                ...APPLIED_ENVELOPE_PROPERTIES,
                key: { type: 'string', required: true },
                name: { type: 'string', required: true },
                parentRef: { type: 'string' },
                libraryVersion: { type: 'integer', required: true },
                serverId: { type: 'string' },
            },
        },
        COMMITTED_UNVERIFIED_VARIANT,
    ],
};
/** The deterministic plan markdown the approval card renders. */
export function createCollectionPlan(args) {
    return [
        '**Create a Zotero collection**',
        WRITE_PLAN_LIBRARY_LINE,
        `- Name: ${planValue(args.name.trim())}`,
        `- Parent: ${args.parent === undefined ? '(top level)' : planValue(args.parent.trim())}`,
        'A sibling collection with the same name refuses the write; the created collection carries the returned ref.',
    ].join('\n');
}
function buildRequest(args) {
    const name = assertNonBlank('name', args.name);
    let parent;
    if (args.parent !== undefined) {
        parent = assertNonBlank('parent', args.parent);
        if (isRefString(parent))
            parseWritableRef(parent, ['collection']);
    }
    return {
        name,
        ...(parent !== undefined ? { parent } : {}),
    };
}
export function renderCreateCollection(_args, value) {
    if (value.kind === 'declined') {
        return renderDeclined(value);
    }
    if (value.kind === 'committed-unverified') {
        return renderCommittedUnverified(value, 'collection', 'created');
    }
    const lines = [`Created collection ${value.ref} (version ${value.version}): ${value.name}.`];
    if (value.parentRef !== undefined)
        lines.push(`Parent: ${value.parentRef}`);
    lines.push(libraryVersionLine(value));
    return [{ type: 'text', text: lines.join('\n') }];
}
function presentCreateCollectionResult(_args, result) {
    return presentCreateResultView('collection', 'created', result);
}
export function registerCreateCollectionTool(ctx, service) {
    return ctx.tools.register(defineTool({
        name: 'zotero_create_collection',
        description: 'Create a collection in the Zotero personal library, optionally under a parent (ref or exact name). A sibling collection that already carries the name refuses the write before any POST, so work with the existing ref instead. Zotero itself may show its authorization dialog on first use. ' +
            WRITE_PLAN_OUTCOME_DESCRIPTION,
        parameters: CREATE_COLLECTION_PARAMETERS,
        output: {
            schema: CREATE_COLLECTION_OUTPUT_SCHEMA,
            render: renderCreateCollection,
            presentationMeta: (_args, value) => createWritePresentationMeta(value),
        },
        presentCall: (args) => ({
            card: 'generic',
            kind: 'edit',
            title: 'Create Zotero collection',
            rawInput: args.name,
        }),
        presentResult: presentCreateCollectionResult,
        async execute(args, exec) {
            assertWritePayload(args, service.config.writeFieldMaxChars);
            const request = buildRequest(args);
            return await service.createCollection(request, { exec, plan: createCollectionPlan(args) });
        },
    }));
}
//# sourceMappingURL=create-collection.js.map