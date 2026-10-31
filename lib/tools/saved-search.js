import { defineTool, } from '@deepseek-ai/dsh-tools';
import { renderDeclined } from './present.js';
import { COMMITTED_UNVERIFIED_VARIANT, DECLINED_OUTPUT_SCHEMA, createWritePresentationMeta, libraryVersionLine, presentCreateResultView, presentDeleteResultView, presentUpdateResultView, renderCommittedUnverified, } from './write-present.js';
import { assertNonBlank, parseWritableRef, WRITE_SEARCH_REF_ARG_HINT } from './validate.js';
import { WRITE_PLAN_LIBRARY_LINE, WRITE_PLAN_OUTCOME_DESCRIPTION, WRITE_COMMITTED_UNVERIFIED_DESCRIPTION, } from '../write-approval.js';
const CONDITION = {
    type: 'object',
    additionalProperties: false,
    properties: {
        condition: { type: 'string', required: true },
        operator: { type: 'string', required: true },
        value: { type: 'string', required: true },
    },
};
const CREATE = {
    name: { type: 'string', required: true },
    conditions: { type: 'array', required: true, items: CONDITION },
};
const UPDATE = {
    search: {
        type: 'string',
        required: true,
        description: `A ${WRITE_SEARCH_REF_ARG_HINT} ref.`,
    },
    name: { type: 'string' },
    conditions: { type: 'array', items: CONDITION },
};
const DELETE = {
    search: { type: 'string', required: true, description: `A ${WRITE_SEARCH_REF_ARG_HINT} ref.` },
};
/** The applied shape the create and update outcomes share. */
const APPLIED = {
    type: 'object',
    additionalProperties: false,
    properties: {
        kind: { type: 'string', enum: ['applied'], required: true },
        ref: { type: 'string', required: true },
        key: { type: 'string', required: true },
        version: { type: 'integer', required: true },
        name: { type: 'string' },
        conditions: { type: 'array', items: CONDITION },
        libraryVersion: { type: 'integer', required: true },
        serverId: { type: 'string' },
    },
};
/** The deleted shape the delete outcome carries. */
const DELETED = {
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
};
const CREATED = { oneOf: [DECLINED_OUTPUT_SCHEMA, COMMITTED_UNVERIFIED_VARIANT, APPLIED] };
const UPDATE_OUTPUT = { oneOf: [DECLINED_OUTPUT_SCHEMA, APPLIED] };
const DELETE_OUTPUT = { oneOf: [DECLINED_OUTPUT_SCHEMA, DELETED] };
const render = (_args, value) => {
    if (value.kind === 'declined')
        return renderDeclined();
    if (value.kind === 'committed-unverified')
        return renderCommittedUnverified(value, 'saved search', 'created');
    return [
        {
            type: 'text',
            text: [
                `Zotero saved-search operation ${value.kind === 'deleted' ? 'completed' : 'applied'} for ${value.ref ?? value.key ?? 'the requested search'}.`,
                ...(value.libraryVersion === undefined ? [] : [libraryVersionLine(value)]),
            ].join('\n'),
        },
    ];
};
/** Replayable projection for the update arm: the applied identity. */
function presentUpdateMeta(_args, value) {
    if (value.kind === 'declined')
        return { kind: 'declined' };
    return {
        kind: 'applied',
        ref: value.ref,
        key: value.key,
        version: value.version,
        ...(value.libraryVersion === undefined ? {} : { libraryVersion: value.libraryVersion }),
    };
}
/** Replayable projection for the delete arm: the deleted identity. */
function presentDeleteMeta(_args, value) {
    if (value.kind === 'declined')
        return { kind: 'declined' };
    return {
        kind: 'deleted',
        ref: value.ref,
        key: value.key,
        ...(value.libraryVersion === undefined ? {} : { libraryVersion: value.libraryVersion }),
    };
}
function presentUpdateResult(_args, result) {
    return presentUpdateResultView('saved search', result);
}
function presentDeleteResult(_args, result) {
    return presentDeleteResultView('saved search delete', 'saved search', result);
}
function presentCreateResult(_args, result) {
    return presentCreateResultView('saved search', 'created', result);
}
export function registerSavedSearchTools(ctx, service) {
    const create = ctx.tools.register(defineTool({
        name: 'zotero_create_saved_search',
        description: `Create a Zotero saved search with explicit conditions. ${WRITE_PLAN_OUTCOME_DESCRIPTION} ${WRITE_COMMITTED_UNVERIFIED_DESCRIPTION}`,
        parameters: CREATE,
        output: {
            schema: CREATED,
            render,
            presentationMeta: (_args, value) => createWritePresentationMeta(value),
        },
        presentCall: (args) => ({
            card: 'generic',
            kind: 'edit',
            title: 'Create Zotero saved search',
            rawInput: args.name,
        }),
        presentResult: presentCreateResult,
        async execute(args, exec) {
            // Validate before the plan: a blank name is a refusal, not something
            // the user approves a plan for. The domain keeps its own guard; this
            // is the tool-layer fail-fast every other write tool keeps.
            const name = assertNonBlank('name', args.name);
            const request = { name, conditions: args.conditions };
            return await service.createSavedSearch(request, {
                exec,
                plan: [
                    '**Create a Zotero saved search**',
                    WRITE_PLAN_LIBRARY_LINE,
                    `- Name: ${name}`,
                    `- Conditions: ${args.conditions.length}`,
                ].join('\n'),
            });
        },
    }));
    const update = ctx.tools.register(defineTool({
        name: 'zotero_update_saved_search',
        description: `Update a Zotero saved search name or conditions. ${WRITE_PLAN_OUTCOME_DESCRIPTION}`,
        parameters: UPDATE,
        output: {
            schema: UPDATE_OUTPUT,
            render,
            presentationMeta: presentUpdateMeta,
        },
        presentCall: (args) => ({
            card: 'generic',
            kind: 'edit',
            title: 'Update Zotero saved search',
            rawInput: args.search,
        }),
        presentResult: presentUpdateResult,
        async execute(args, exec) {
            const request = {
                search: parseWritableRef(args.search, ['search']),
                ...(args.name === undefined ? {} : { name: assertNonBlank('name', args.name) }),
                ...(args.conditions === undefined ? {} : { conditions: args.conditions }),
            };
            return await service.updateSavedSearch(request, {
                exec,
                plan: [
                    '**Update a Zotero saved search**',
                    WRITE_PLAN_LIBRARY_LINE,
                    `- Search: ${args.search}`,
                    ...(args.name === undefined ? [] : [`- Name: ${args.name.trim()}`]),
                    ...(args.conditions === undefined ? [] : [`- Conditions: ${args.conditions.length}`]),
                ].join('\n'),
            });
        },
    }));
    const remove = ctx.tools.register(defineTool({
        name: 'zotero_delete_saved_search',
        description: `Delete a Zotero saved search. ${WRITE_PLAN_OUTCOME_DESCRIPTION}`,
        parameters: DELETE,
        output: {
            schema: DELETE_OUTPUT,
            render,
            presentationMeta: presentDeleteMeta,
        },
        presentCall: (args) => ({
            card: 'generic',
            kind: 'edit',
            title: 'Delete Zotero saved search',
            rawInput: args.search,
        }),
        presentResult: presentDeleteResult,
        async execute(args, exec) {
            const request = {
                search: parseWritableRef(args.search, ['search']),
            };
            return await service.deleteSavedSearch(request, {
                exec,
                plan: [
                    '**Delete a Zotero saved search**',
                    WRITE_PLAN_LIBRARY_LINE,
                    `- Search: ${args.search}`,
                    'This removes the saved-search definition; library items are unchanged.',
                ].join('\n'),
            });
        },
    }));
    return [create, update, remove];
}
//# sourceMappingURL=saved-search.js.map