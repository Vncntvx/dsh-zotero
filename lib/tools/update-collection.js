import { planValue } from '../write-plan.js';
import { requireUpdateField } from '../write-item-rules.js';
import { assertWritePayload } from '../write-bounds.js';
import { defineZoteroTool as defineTool } from '../define-tool.js';
import { renderDeclined } from './present.js';
import { APPLIED_ENVELOPE_PROPERTIES, DECLINED_OUTPUT_SCHEMA, COMMITTED_UNVERIFIED_VARIANT, createWritePresentationMeta, libraryVersionLine, presentUpdateResultView, renderCommittedUnverified, } from '../write-present.js';
import { parseWritableRef, assertNonBlank, WRITE_COLLECTION_REF_ARG_HINT } from './validate.js';
import { WRITE_PLAN_LIBRARY_LINE, WRITE_PLAN_OUTCOME_DESCRIPTION } from '../write-approval.js';
export const PARAMETERS = {
    collection: {
        type: 'string',
        required: true,
        description: `A ${WRITE_COLLECTION_REF_ARG_HINT} ref.`,
    },
    name: { type: 'string', description: 'The new non-blank collection name.' },
    parent: {
        type: 'string',
        description: 'A collection ref; omit to preserve the current parent.',
    },
};
const OUTPUT = {
    oneOf: [
        DECLINED_OUTPUT_SCHEMA,
        COMMITTED_UNVERIFIED_VARIANT,
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                ...APPLIED_ENVELOPE_PROPERTIES,
                name: { type: 'string' },
                parentRef: { type: 'string' },
                libraryVersion: { type: 'integer', required: true },
                serverId: { type: 'string' },
            },
        },
    ],
};
function updateCollectionPlan(args) {
    return [
        '**Update a Zotero collection**',
        WRITE_PLAN_LIBRARY_LINE,
        `- Collection: ${planValue(args.collection)}`,
        ...(args.name === undefined ? [] : [`- Name: ${planValue(args.name)}`]),
        ...(args.parent === undefined ? [] : [`- Parent: ${planValue(args.parent)}`]),
        'The collection is patched under its current object version.',
    ].join('\n');
}
function renderUpdateCollection(_args, value) {
    if (value.kind === 'declined')
        return renderDeclined(value);
    if (value.kind === 'committed-unverified')
        return renderCommittedUnverified(value, 'collection', 'committed');
    return [
        {
            type: 'text',
            text: [
                `Updated collection ${value.ref} (version ${value.version}).`,
                libraryVersionLine(value),
            ].join('\n'),
        },
    ];
}
/** Replayable projection: the applied collection identity, or the declined fact. */
function presentUpdateCollectionMeta(_args, value) {
    if (value.kind === 'declined')
        return { ...value };
    if (value.kind === 'committed-unverified')
        return createWritePresentationMeta(value);
    return {
        kind: 'applied',
        ref: value.ref,
        version: value.version,
        ...(value.parentRef === undefined ? {} : { parentRef: value.parentRef }),
    };
}
function presentUpdateCollectionResult(_args, result) {
    return presentUpdateResultView('collection', result);
}
export function registerUpdateCollectionTool(ctx, service) {
    return ctx.tools.register(defineTool({
        name: 'zotero_update_collection',
        description: `Rename or reparent a Zotero collection under its object version. ${WRITE_PLAN_OUTCOME_DESCRIPTION}`,
        parameters: PARAMETERS,
        output: {
            schema: OUTPUT,
            render: renderUpdateCollection,
            presentationMeta: presentUpdateCollectionMeta,
        },
        presentCall: (args) => ({
            card: 'generic',
            kind: 'edit',
            title: 'Update Zotero collection',
            rawInput: args.collection,
        }),
        presentResult: presentUpdateCollectionResult,
        async execute(args, exec) {
            assertWritePayload(args, service.config.writeFieldMaxChars);
            requireUpdateField({ name: args.name, parent: args.parent });
            const request = {
                collection: parseWritableRef(args.collection, ['collection']),
                ...(args.name === undefined ? {} : { name: assertNonBlank('name', args.name) }),
                ...(args.parent === undefined
                    ? {}
                    : { parent: parseWritableRef(args.parent, ['collection']) }),
            };
            return await service.updateCollection(request, { exec, plan: updateCollectionPlan(args) });
        },
    }));
}
//# sourceMappingURL=update-collection.js.map