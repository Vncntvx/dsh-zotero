import { defineZoteroTool as defineTool } from '../define-tool.js';
import { renderDeclined } from './present.js';
import { APPLIED_ENVELOPE_PROPERTIES, DECLINED_OUTPUT_SCHEMA, COMMITTED_UNVERIFIED_VARIANT, createWritePresentationMeta, libraryVersionLine, presentUpdateResultView, renderCommittedUnverified, } from '../write-present.js';
import { NOTE_MARKDOWN_PARAMETER_DESCRIPTION } from './note-markdown.js';
import { parseWritableRef, assertNoteMarkdown, WRITE_REF_ARG_HINT } from './validate.js';
import { WRITE_PLAN_LIBRARY_LINE, WRITE_PLAN_OUTCOME_DESCRIPTION } from '../write-approval.js';
import { planValue, planBlock } from '../write-plan.js';
import { assertWritePayload } from '../write-bounds.js';
export const PARAMETERS = {
    ref: {
        type: 'string',
        required: true,
        description: `A ${WRITE_REF_ARG_HINT} ref for an existing note.`,
    },
    markdown: {
        type: 'string',
        required: true,
        description: NOTE_MARKDOWN_PARAMETER_DESCRIPTION,
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
                libraryVersion: { type: 'integer', required: true },
            },
        },
    ],
};
export function updateNotePlan(args) {
    return [
        '**Update a Zotero note**',
        WRITE_PLAN_LIBRARY_LINE,
        `- Note: ${planValue(args.ref)}`,
        '- Complete Markdown body:',
        planBlock(args.markdown),
        'The body is converted to Zotero note HTML before the versioned PATCH.',
    ].join('\n');
}
function renderUpdateNote(_args, value) {
    if (value.kind === 'declined')
        return renderDeclined(value);
    if (value.kind === 'committed-unverified')
        return renderCommittedUnverified(value, 'note', 'committed');
    return [
        {
            type: 'text',
            text: [
                `Updated note ${value.ref} (version ${value.version}).`,
                libraryVersionLine(value),
            ].join('\n'),
        },
    ];
}
/** Replayable projection: the applied note identity, or the declined fact. */
function presentUpdateNoteMeta(_args, value) {
    if (value.kind === 'declined')
        return { ...value };
    if (value.kind === 'committed-unverified')
        return createWritePresentationMeta(value);
    return {
        kind: 'applied',
        ref: value.ref,
        version: value.version,
        libraryVersion: value.libraryVersion,
    };
}
function presentUpdateNoteResult(_args, result) {
    return presentUpdateResultView('note', result);
}
export function registerUpdateNoteTool(ctx, service) {
    return ctx.tools.register(defineTool({
        name: 'zotero_update_note',
        description: `Replace an existing Zotero note body with markdown under a version precondition. The target must be a note item; a non-note ref fails with ZOTERO_INVALID_ARGUMENT. ${WRITE_PLAN_OUTCOME_DESCRIPTION}`,
        parameters: PARAMETERS,
        output: {
            schema: OUTPUT,
            render: renderUpdateNote,
            presentationMeta: presentUpdateNoteMeta,
        },
        presentCall: (args) => ({
            card: 'generic',
            kind: 'edit',
            title: 'Update Zotero note',
            rawInput: args.ref,
        }),
        presentResult: presentUpdateNoteResult,
        async execute(args, exec) {
            assertWritePayload(args, service.config.writeFieldMaxChars, service.config.writeNoteMaxChars);
            const request = {
                item: parseWritableRef(args.ref, ['item']),
                markdown: assertNoteMarkdown(args.markdown, service.config.writeNoteMaxChars),
            };
            return await service.updateNote(request, { exec, plan: updateNotePlan(args) });
        },
    }));
}
//# sourceMappingURL=update-note.js.map