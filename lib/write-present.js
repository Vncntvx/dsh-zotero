/**
 * Shared presentation for write tools and write presentation schemas.
 * @module dsh-zotero/write-present
 */
import { asRecord } from './json.js';
/**
 * The completed-result metadata as a record: undefined for failed calls
 * (which keep the raw error content), for absent metadata on nested code
 * dispatch or malformed replay records, and for non-object shapes. Every
 * `presentResult` funnels through here so the completed card falls back to
 * the generic card the same way on every tool.
 * @param result - the settled tool result.
 * @returns the metadata record, or undefined for the generic fallback.
 */
export function metaRecordOf(result) {
    if (result.isError)
        return undefined;
    return asRecord(result.meta);
}
/**
 * The declined-write content: the user answered the plan without approving,
 * so nothing was written. Shared by the write tools so the wording
 * cannot drift between them.
 * @returns the single declined text block.
 */
export function renderDeclined() {
    return [
        {
            type: 'text',
            text: 'Declined: the user answered the plan without approving. Nothing was written.',
        },
    ];
}
/**
 * The output-schema variant for the non-retryable committed-unverified
 * outcome every non-idempotent create (note, item, collection) can report.
 * One copy: the retry-safety contract the schema expresses must not drift
 * between tools.
 */
export const COMMITTED_UNVERIFIED_VARIANT = {
    type: 'object',
    additionalProperties: false,
    properties: {
        kind: { type: 'string', enum: ['committed-unverified'], required: true },
        committed: { type: 'boolean', enum: [true], required: true },
        retryable: { type: 'boolean', enum: [false], required: true },
        reason: {
            type: 'string',
            enum: ['saved-state-unverified', 'commit-unknown'],
            required: true,
        },
        ref: { type: 'string' },
        key: { type: 'string' },
        version: { type: 'integer' },
        libraryVersion: { type: 'integer' },
        serverId: { type: 'string', required: true },
    },
};
/**
 * Render the committed-unverified receipt: what Zotero may have done (the
 * past verb differs per create), the identity hint when the response carried
 * one, and the reconciliation instruction, never a retry.
 */
export function renderCommittedUnverified(value, objectName, pastVerb) {
    const known = [
        ...(value.key === undefined ? [] : [`key ${value.key}`]),
        ...(value.ref === undefined ? [] : [`ref ${value.ref}`]),
        ...(value.version === undefined ? [] : [`version ${value.version}`]),
        ...(value.libraryVersion === undefined ? [] : [`library version ${value.libraryVersion}`]),
        ...(value.serverId === undefined ? [] : [`server ${value.serverId}`]),
    ];
    const identity = known.length === 0 ? '' : ` (${known.join('; ')})`;
    const reconciliation = value.key !== undefined || value.ref !== undefined
        ? `reconcile the ${objectName} by its key/ref`
        : `reconcile by checking Zotero for the ${objectName} before taking any further action`;
    const text = value.reason === 'commit-unknown'
        ? `Zotero may have ${pastVerb} the ${objectName}${identity}, but the response did not prove the outcome. Do not retry; ${reconciliation}.`
        : `Zotero ${pastVerb} the ${objectName}${identity}, but its saved state could not be verified. Do not retry; ${reconciliation}.`;
    return [{ type: 'text', text }];
}
/**
 * The result-card titles for one create tool: declined, the two
 * committed-unverified reasons, and the applied receipt with its ref.
 */
export function presentCreateResultView(noun, pastVerb, result) {
    const record = metaRecordOf(result);
    if (record === undefined)
        return undefined;
    if (record.kind === 'declined') {
        return { card: 'generic', title: declinedTitle(noun) };
    }
    if (record.kind === 'committed-unverified') {
        return {
            card: 'generic',
            title: record.reason === 'commit-unknown'
                ? `Zotero ${noun} outcome unknown; do not retry`
                : `Zotero ${noun} ${pastVerb} but not verified; do not retry`,
        };
    }
    const ref = typeof record.ref === 'string' ? record.ref : '';
    return { card: 'generic', title: `Zotero ${noun} created${ref === '' ? '' : `: ${ref}`}` };
}
/** The presentation meta the create tools project for the Sources panel. */
export function createWritePresentationMeta(value) {
    if (value.kind === 'applied') {
        return { kind: 'applied', ref: value.ref, key: value.key, version: value.version };
    }
    if (value.kind === 'committed-unverified') {
        return {
            kind: 'committed-unverified',
            committed: true,
            retryable: false,
            reason: value.reason,
            ...(value.key === undefined ? {} : { key: value.key }),
            ...(value.ref === undefined ? {} : { ref: value.ref }),
            ...(value.version === undefined ? {} : { version: value.version }),
            ...(value.libraryVersion === undefined ? {} : { libraryVersion: value.libraryVersion }),
            ...(value.serverId === undefined ? {} : { serverId: value.serverId }),
        };
    }
    return { kind: 'declined' };
}
/**
 * The presentation meta the two list-update tools (tags, membership)
 * project: the change counts ride the applied arm so the Sources panel can
 * summarize the diff without re-reading the lists.
 */
export function listUpdatePresentationMeta(value) {
    return value.kind === 'applied'
        ? {
            kind: 'applied',
            ref: value.ref,
            version: value.version,
            addedCount: value.added.length,
            removedCount: value.removed.length,
        }
        : { kind: 'declined' };
}
/** The closing line of every write receipt: the library version and its serving instance. */
export function libraryVersionLine(value) {
    return `Library version: ${value.libraryVersion}${value.serverId === undefined ? '' : ` (served by ${value.serverId})`}`;
}
export const DECLINED_OUTPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        kind: { type: 'string', enum: ['declined'], required: true },
    },
};
/** Shared creation result for local item creation and the Scholarly write bridge. */
export const CREATED_ITEM_VARIANT = {
    type: 'object',
    additionalProperties: false,
    properties: {
        kind: { type: 'string', enum: ['applied'], required: true },
        ref: { type: 'string', required: true },
        key: { type: 'string', required: true },
        version: { type: 'integer', required: true },
        itemType: { type: 'string', required: true },
        title: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        collections: { type: 'array', items: { type: 'string' } },
        libraryVersion: { type: 'integer', required: true },
        serverId: { type: 'string' },
    },
};
const COMMON_UPDATE_LIST_PROPERTIES = {
    kind: { type: 'string', enum: ['applied'], required: true },
    ref: { type: 'string', required: true },
    version: {
        type: 'integer',
        required: true,
        description: "The item's version after the update (or the read version when unchanged).",
    },
    added: { type: 'array', items: { type: 'string' }, required: true },
    removed: { type: 'array', items: { type: 'string' }, required: true },
    unchanged: { type: 'boolean', required: true },
    libraryVersion: {
        type: 'integer',
        description: 'The library version the write advanced to; absent when unchanged.',
    },
    serverId: { type: 'string' },
};
export const UPDATE_ITEM_TAGS_OUTPUT_SCHEMA = {
    oneOf: [
        DECLINED_OUTPUT_SCHEMA,
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                ...COMMON_UPDATE_LIST_PROPERTIES,
                tags: { type: 'array', items: { type: 'string' }, required: true },
            },
        },
    ],
};
export const UPDATE_ITEM_COLLECTIONS_OUTPUT_SCHEMA = {
    oneOf: [
        DECLINED_OUTPUT_SCHEMA,
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                ...COMMON_UPDATE_LIST_PROPERTIES,
                collections: { type: 'array', items: { type: 'string' }, required: true },
            },
        },
    ],
};
/** Render the receipt blocks for a tags or collections update tool. */
export function renderUpdateList(value, options) {
    if (value.kind === 'declined') {
        return renderDeclined();
    }
    const lines = [
        value.unchanged
            ? `No change: ${value.ref} already carries ${options.unchangedTarget} (version ${value.version}).`
            : `Updated ${options.noun} on ${value.ref} (version ${value.version}); added ${value.added.length === 0 ? '(none)' : value.added.join(', ')}; removed ${value.removed.length === 0 ? '(none)' : value.removed.join(', ')}.`,
    ];
    lines.push(`${options.currentLabel}: ${value.items.length === 0 ? '(none)' : value.items.join(', ')}`);
    if (value.libraryVersion !== undefined) {
        lines.push(libraryVersionLine({ libraryVersion: value.libraryVersion, serverId: value.serverId }));
    }
    return [{ type: 'text', text: lines.join('\n') }];
}
/** The declined-arm title every write result card shares. */
function declinedTitle(noun) {
    return `Zotero ${noun}: declined, nothing written`;
}
/** The result-card titles for item updates (tags, membership, or item fields). */
export function presentUpdateResultView(noun, result) {
    const record = metaRecordOf(result);
    if (record === undefined)
        return undefined;
    if (record.kind === 'declined') {
        return { card: 'generic', title: declinedTitle(noun) };
    }
    const ref = typeof record.ref === 'string' ? record.ref : '';
    return { card: 'generic', title: `Zotero ${noun} updated${ref === '' ? '' : `: ${ref}`}` };
}
/**
 * The result-card titles for the delete tools: the shared declined arm, and
 * the deleted receipt with its ref when the outcome carried one (a library
 * tags delete has no single ref, so its receipt is the plain sentence).
 *
 * The two nouns are the two spellings the cards already use: the declined
 * arm names the operation ("collection delete") and the receipt names the
 * object ("collection"). Passing them separately keeps those pinned titles
 * byte-identical instead of normalizing the wording in a "refactor".
 */
export function presentDeleteResultView(declinedNoun, deletedNoun, result) {
    const record = metaRecordOf(result);
    if (record === undefined)
        return undefined;
    if (record.kind === 'declined') {
        return { card: 'generic', title: declinedTitle(declinedNoun) };
    }
    const ref = typeof record.ref === 'string' ? record.ref : '';
    return { card: 'generic', title: `Zotero ${deletedNoun} deleted${ref === '' ? '' : `: ${ref}`}` };
}
/**
 * The closed shape every failed-write row carries, shared so the batch and
 * restore receipts cannot drift.
 */
export const WRITE_FAILURE_ITEM = {
    type: 'object',
    additionalProperties: false,
    properties: {
        op: { type: 'string', enum: ['create', 'update', 'delete'], required: true },
        ref: { type: 'string' },
        index: { type: 'integer' },
        code: { type: 'string', required: true },
        message: { type: 'string', required: true },
        completedRefs: { type: 'array', items: { type: 'string' } },
    },
};
export const BATCH_ITEMS_OUTPUT_SCHEMA = {
    oneOf: [
        DECLINED_OUTPUT_SCHEMA,
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                kind: { type: 'string', enum: ['applied'], required: true },
                total: { type: 'integer', required: true },
                created: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            index: { type: 'integer', required: true },
                            ref: { type: 'string', required: true },
                            key: { type: 'string', required: true },
                            version: { type: 'integer', required: true },
                            itemType: { type: 'string', required: true },
                            title: { type: 'string' },
                            url: { type: 'string' },
                        },
                    },
                    required: true,
                },
                updated: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            ref: { type: 'string', required: true },
                            version: { type: 'integer', required: true },
                            addedTags: { type: 'array', items: { type: 'string' }, required: true },
                            removedTags: { type: 'array', items: { type: 'string' }, required: true },
                            addedCollections: { type: 'array', items: { type: 'string' }, required: true },
                            removedCollections: { type: 'array', items: { type: 'string' }, required: true },
                            unchanged: { type: 'boolean', required: true },
                        },
                    },
                    required: true,
                },
                deleted: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            ref: { type: 'string', required: true },
                            key: { type: 'string', required: true },
                            deleted: { type: 'boolean', enum: [true], required: true },
                            version: { type: 'integer', required: true },
                            children: { type: 'array', items: { type: 'string' }, required: true },
                        },
                    },
                    required: true,
                },
                unverified: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            op: { type: 'string', enum: ['create'], required: true },
                            index: { type: 'integer', required: true },
                            committed: { type: 'boolean', enum: [true], required: true },
                            retryable: { type: 'boolean', enum: [false], required: true },
                            reason: {
                                type: 'string',
                                enum: ['saved-state-unverified', 'commit-unknown'],
                                required: true,
                            },
                            key: { type: 'string' },
                            ref: { type: 'string' },
                            version: { type: 'integer' },
                            libraryVersion: { type: 'integer' },
                            serverId: { type: 'string', required: true },
                        },
                    },
                    required: true,
                },
                failed: {
                    type: 'array',
                    items: WRITE_FAILURE_ITEM,
                    required: true,
                },
                libraryVersion: { type: 'integer' },
                serverId: { type: 'string' },
            },
        },
    ],
};
export function presentBatchItemsResultView(result) {
    const record = metaRecordOf(result);
    if (record === undefined)
        return undefined;
    if (record.kind === 'declined') {
        return { card: 'generic', title: 'Zotero batch items: declined, nothing written' };
    }
    const created = typeof record.createdCount === 'number' ? record.createdCount : 0;
    const updated = typeof record.updatedCount === 'number' ? record.updatedCount : 0;
    const deleted = typeof record.deletedCount === 'number' ? record.deletedCount : 0;
    const unverified = typeof record.unverifiedCount === 'number' ? record.unverifiedCount : 0;
    const failed = typeof record.failedCount === 'number' ? record.failedCount : 0;
    return {
        card: 'generic',
        title: `Zotero batch items applied: ${created} created, ${updated} updated, ${deleted} trashed${failed > 0 ? `, ${failed} failed` : ''}${unverified > 0 ? `, ${unverified} unverified; do not retry` : ''}`,
    };
}
//# sourceMappingURL=write-present.js.map