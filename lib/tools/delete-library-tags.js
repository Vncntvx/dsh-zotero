import { assertWritePayload } from '../write-bounds.js';
import { planValue } from '../write-plan.js';
import { defineZoteroTool as defineTool } from '../define-tool.js';
import { invalidArgs, writeListEmptyMessage } from '../errors.js';
import { runPreview } from './degradable.js';
import { renderDeclined } from './present.js';
import { DECLINED_OUTPUT_SCHEMA, COMMITTED_UNVERIFIED_VARIANT, libraryVersionLine, presentDeleteResultView, renderCommittedUnverified, unverifiedPresentationMeta, } from '../write-present.js';
import { assertWriteList } from './validate.js';
import { WRITE_PLAN_OUTCOME_DESCRIPTION, WRITE_PLAN_LIBRARY_LINE } from '../write-approval.js';
const DELETE_LIBRARY_TAGS_PARAMETERS = {
    tags: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: 'Tag names to delete library-wide (1..writeListMaxItems). Names the listing proves absent are reported as no-ops; the delete is irreversible.',
    },
};
const DELETE_LIBRARY_TAGS_OUTPUT_SCHEMA = {
    oneOf: [
        DECLINED_OUTPUT_SCHEMA,
        COMMITTED_UNVERIFIED_VARIANT,
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                kind: { type: 'string', enum: ['deleted'], required: true },
                deletedTags: { type: 'array', items: { type: 'string' }, required: true },
                absentTags: { type: 'array', items: { type: 'string' } },
                libraryVersion: { type: 'integer', required: true },
                serverId: { type: 'string' },
            },
        },
    ],
};
/**
 * The deterministic plan markdown the approval card renders. A tag is shown
 * with its item count when the listing proved one, as `unknown items` when
 * the listing carried the tag without a count, and, only after the whole
 * listing has been scanned, as a proven no-op under "Unmatched names".
 */
export function deleteLibraryTagsPlan(args, preview = {}) {
    const tags = (args.tags ?? []).map((tag) => tag.trim());
    const lines = [
        '**Delete Zotero tags library-wide**',
        WRITE_PLAN_LIBRARY_LINE,
        '- Scope: every item carrying these tags (irreversible; every item carrying them loses them)',
    ];
    for (const tag of tags) {
        const count = preview.counts?.get(tag);
        const absent = preview.absent?.includes(tag) === true;
        lines.push(`- "${planValue(tag)}": ${absent ? 'proven absent (no-op)' : count === undefined ? 'unknown items' : `${count} items`}`);
    }
    if (preview.absent !== undefined && preview.absent.length > 0) {
        lines.push(`- Unmatched names (proven no-ops: the listing carries no such tag): ${preview.absent.map(planValue).join(', ')}`);
    }
    lines.push('This removes the tags from every item that carries them and cannot be undone; the delete carries a library-version precondition, so a concurrent change fails it.');
    return lines.join('\n');
}
function buildRequest(args, config) {
    if (args.tags.length === 0)
        invalidArgs(writeListEmptyMessage('tags'));
    const tags = assertWriteList('tags', args.tags, config.writeListMaxItems);
    return { tags };
}
/**
 * Query each exact name through Zotero's prefix listing, including child items.
 * Two pages bound each name's preview I/O. Exhausting that filtered listing
 * proves absence; hitting the page budget leaves the count unknown. Transport,
 * protocol and cancellation failures retain runPreview's explicit outcomes.
 */
export async function previewLibraryTags(service, tags, signal) {
    return await runPreview(signal, {}, async () => {
        const wanted = new Set(tags);
        const counts = new Map();
        const absent = [];
        for (const tag of tags) {
            let offset = 0;
            let pages = 0;
            for (;;) {
                const browsed = await service.browse({
                    kind: 'tags',
                    scope: { kind: 'library' },
                    itemLevel: 'all',
                    offset,
                    limit: service.config.maxBrowseResults,
                    q: tag,
                    match: 'startsWith',
                }, signal);
                for (const item of browsed.items) {
                    const row = item;
                    if (typeof row.tag === 'string' && wanted.has(row.tag) && !counts.has(row.tag)) {
                        counts.set(row.tag, typeof row.count === 'number' ? row.count : undefined);
                    }
                }
                const next = browsed.nextOffset;
                pages += 1;
                if (next === undefined && !counts.has(tag))
                    absent.push(tag);
                if (next === undefined || counts.has(tag) || pages >= 2)
                    break;
                offset = next;
            }
        }
        return {
            counts,
            ...(absent.length > 0 ? { absent } : {}),
        };
    });
}
export function renderDeleteLibraryTags(_args, value) {
    if (value.kind === 'declined') {
        return renderDeclined(value);
    }
    if (value.kind === 'committed-unverified')
        return renderCommittedUnverified(value, 'library tags', 'committed');
    return [
        {
            type: 'text',
            text: [
                `Deleted ${value.deletedTags.length} tags library-wide: ${value.deletedTags.join(', ')}.`,
                ...(value.absentTags === undefined || value.absentTags.length === 0
                    ? []
                    : [`Proven absent (no-op): ${value.absentTags.join(', ')}.`]),
                libraryVersionLine(value),
            ].join('\n'),
        },
    ];
}
function presentDeleteLibraryTagsResult(_args, result) {
    return presentDeleteResultView('tags delete', 'library tags', result);
}
export function registerDeleteLibraryTagsTool(ctx, service) {
    return ctx.tools.register(defineTool({
        name: 'zotero_delete_library_tags',
        description: 'Delete tags library-wide in the Zotero personal library (irreversible: every item carrying them loses them). Unknown names are silently ignored. The plan card states each tag\u2019s item count first. ' +
            WRITE_PLAN_OUTCOME_DESCRIPTION,
        parameters: DELETE_LIBRARY_TAGS_PARAMETERS,
        output: {
            schema: DELETE_LIBRARY_TAGS_OUTPUT_SCHEMA,
            render: renderDeleteLibraryTags,
            presentationMeta: (_args, value) => value.kind === 'deleted'
                ? { kind: 'deleted', deletedCount: value.deletedTags.length }
                : value.kind === 'committed-unverified'
                    ? unverifiedPresentationMeta(value)
                    : { ...value },
        },
        presentCall: (args) => ({
            card: 'generic',
            kind: 'delete',
            title: 'Delete Zotero library tags',
            rawInput: args.tags.join(', '),
        }),
        presentResult: presentDeleteLibraryTagsResult,
        async execute(args, exec) {
            assertWritePayload(args, service.config.writeFieldMaxChars);
            const request = buildRequest(args, service.config);
            const preview = await previewLibraryTags(service, request.tags, exec.signal);
            const outcome = await service.deleteLibraryTags(request, {
                exec,
                plan: deleteLibraryTagsPlan(args, preview),
                risk: 'irreversible-delete',
            });
            return outcome;
        },
    }));
}
//# sourceMappingURL=delete-library-tags.js.map