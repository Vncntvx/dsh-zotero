/**
 * The literature-trail projection: a pure fold over committed session events
 * that serves the whole trail to the browser without the history window.
 *
 * `apply` records settled Zotero outcomes; `view` replays them through the one
 * workspace builder. `evidenceMatch` is left `unknown` here because the
 * connected Server ID is a client probe fact; the browser materializes it with
 * {@link withEvidenceMatch}.
 * @module dsh-zotero/session-projection/source-ledger
 */
import { z } from 'zod';
import { emptyLedgerState, foldLedgerEvent, workspaceOf, } from '../sources/event-ledger.js';
/** The projection key the browser reads. */
export const SOURCE_LEDGER_KEY = 'zoteroSources';
const supportedLibrarySchema = z.union([
    z.object({ type: z.literal('user'), id: z.literal(0) }).strict(),
    z.object({ type: z.literal('group'), id: z.number().int().positive() }).strict(),
]);
const operationFactsSchema = z
    .object({
    running: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    stopped: z.number().int().nonnegative(),
})
    .strict();
const sourceScopeSchema = z.union([
    z
        .object({
        kind: z.literal('library'),
        library: supportedLibrarySchema.optional(),
    })
        .strict(),
    z
        .object({
        kind: z.literal('publications'),
        library: supportedLibrarySchema.optional(),
    })
        .strict(),
    z
        .object({
        kind: z.literal('collection'),
        ref: z.string().optional(),
        name: z.string().optional(),
    })
        .strict(),
    z
        .object({
        kind: z.literal('savedSearch'),
        ref: z.string().optional(),
        name: z.string().optional(),
    })
        .strict(),
]);
const searchOccurrenceSchema = z
    .object({
    callId: z.string().min(1),
    query: z.string().optional(),
    mode: z.enum(['metadata', 'everything']),
    scope: sourceScopeSchema,
    library: supportedLibrarySchema.optional(),
    itemTypes: z.array(z.string()),
    tags: z.array(z.string()),
    tagMatch: z.enum(['all', 'any']).optional(),
    excludeTags: z.array(z.string()),
    includeTrashed: z.boolean(),
    returned: z.number().int().nonnegative(),
    total: z.number().int().nonnegative().optional(),
    noteMatches: z.number().int().nonnegative().optional(),
})
    .strict();
const evidencePassageSchema = z
    .object({
    source: z.string(),
    sourceRef: z.string(),
    text: z.string(),
    previewTruncated: z.boolean(),
    pageLabel: z.string().optional(),
    attachmentRef: z.string().optional(),
    callIds: z.array(z.string()),
})
    .strict();
const exportDocumentItemSchema = z
    .object({
    ref: z.string(),
    exportKey: z.string().optional(),
    citationKey: z.string().optional(),
    citationKeySource: z.enum(['native', 'extra']).optional(),
    citationKeyConflict: z.object({ native: z.string(), extra: z.string() }).strict().optional(),
    title: z.string().optional(),
    entryIndex: z.number().int().nonnegative().optional(),
    start: z.number().int().nonnegative().optional(),
    end: z.number().int().nonnegative().optional(),
})
    .strict();
const exportArtifactSchema = z
    .object({
    resultFile: z
        .object({ seq: z.number().int().nonnegative(), index: z.number().int().nonnegative() })
        .strict()
        .optional(),
    callId: z.string().min(1),
    format: z.string(),
    style: z.string().optional(),
    locale: z.string().optional(),
    refs: z.array(z.string()),
    refsOmitted: z.number().int().nonnegative(),
    settledAt: z.number().optional(),
    items: z.array(exportDocumentItemSchema).optional(),
    text: z.string(),
})
    .strict();
const coverageSchema = z
    .object({
    indexedPages: z.number().int().nonnegative().optional(),
    totalPages: z.number().int().nonnegative().optional(),
    indexedChars: z.number().int().nonnegative().optional(),
    totalChars: z.number().int().nonnegative().optional(),
    complete: z.boolean(),
})
    .strict();
const availabilitySchema = z
    .object({
    requested: z.boolean(),
    returnedPassages: z.number().int().nonnegative(),
    unavailable: z.boolean(),
})
    .strict();
const retrievalFactsSchema = z
    .object({
    attachmentRef: z.string().optional(),
    attachmentContentType: z.string().optional(),
    coverage: coverageSchema.optional(),
    truncated: z.boolean(),
    sourceAvailability: z.record(z.string(), availabilitySchema),
})
    .strict();
const retrievalSummarySchema = z
    .object({
    runCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
})
    .strict();
const attachmentSchema = z
    .object({
    ref: z.string().optional(),
    kind: z.enum(['file', 'url']),
    contentType: z.string(),
    title: z.string(),
    location: z.string(),
})
    .strict();
const attachmentHintSchema = z
    .object({ ref: z.string().optional(), contentType: z.string().optional() })
    .strict();
const sourceItemSchema = z
    .object({
    key: z.string().min(1),
    ref: z.string(),
    serverIds: z.array(z.string()),
    evidenceMatch: z.enum(['verified', 'unknown', 'mismatch']),
    title: z.string().optional(),
    creators: z.string().optional(),
    year: z.number().optional(),
    venue: z.string().optional(),
    facts: z.object({ reportedEvidenceCount: z.number().int().nonnegative() }).strict(),
    operations: operationFactsSchema,
    searches: z.array(searchOccurrenceSchema),
    evidence: z.array(evidencePassageSchema),
    bestAttachment: attachmentHintSchema.optional(),
    attachment: attachmentSchema.optional(),
    retrievalFacts: retrievalFactsSchema.optional(),
    retrievalSummary: retrievalSummarySchema.optional(),
    exports: z.array(exportArtifactSchema),
    firstSeenAt: z.number(),
    lastTouchedAt: z.number(),
})
    .strict();
/** Wire validation for the served workspace. */
export const sourceWorkspaceSchema = z
    .object({
    sources: z.array(sourceItemSchema),
    exports: z.array(exportArtifactSchema),
    exportOperations: operationFactsSchema,
    omittedRows: z.number().int().nonnegative(),
})
    .strict();
const blockFactSchema = z
    .object({
    callId: z.string().min(1),
    seq: z.number().int().nonnegative(),
    time: z.number(),
    name: z.string().min(1),
    argsRaw: z.string(),
    callTime: z.number(),
    content: z.array(z.json()),
    isError: z.boolean(),
    error: z
        .object({ name: z.string(), code: z.string(), reason: z.string().optional() })
        .strict()
        .optional(),
    meta: z.json().optional(),
})
    .strict();
const pendingCallSchema = z
    .object({
    callId: z.string().min(1),
    name: z.string().min(1),
    argsRaw: z.string(),
    seq: z.number().int().nonnegative(),
    time: z.number(),
})
    .strict();
const ledgerStateSchema = z
    .object({
    blocks: z.array(blockFactSchema),
    pending: z.record(z.string(), pendingCallSchema),
})
    .strict();
const stateSchema = z
    .object({
    inheritedEventCount: z.number().int().nonnegative(),
    ledger: ledgerStateSchema,
})
    .strict();
const workspaceCache = new WeakMap();
function memoizedWorkspaceOf(ledger) {
    const cached = workspaceCache.get(ledger);
    if (cached !== undefined)
        return cached;
    const workspace = workspaceOf(ledger);
    workspaceCache.set(ledger, workspace);
    return workspace;
}
/**
 * The literature trail as a host projection. Fork-inherited events are folded:
 * a forked session's trail is the history its user can see.
 */
export const sourceLedgerProjection = {
    key: SOURCE_LEDGER_KEY,
    stateVersion: 1,
    stateSchema,
    init: (_header, inheritedEventCount) => ({
        inheritedEventCount,
        ledger: emptyLedgerState(),
    }),
    apply: (state, event) => {
        const ledger = foldLedgerEvent(state.ledger, event);
        return ledger === state.ledger ? state : { ...state, ledger };
    },
    wire: {
        summary: false,
        viewSchema: sourceWorkspaceSchema,
        view: (state) => memoizedWorkspaceOf(state.ledger),
    },
};
//# sourceMappingURL=source-ledger.js.map