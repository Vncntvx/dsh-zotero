import { createSourceWireView } from '../sources/window.js';
/**
 * The literature-trail projection: a pure fold over committed session events
 * that serves the whole trail to the browser without the history window.
 *
 * `apply` records settled Zotero outcomes; `view` freezes the workspace the
 * event fold accumulates. The fold is incremental and its cache is owned by
 * this instance: `apply` extends one {@link SourceWorkspaceIndex} per session
 * state chain, and `view` costs the blocks folded since the last read instead
 * of the whole log. A module-level memo would outlive the registration, so the
 * factory hands back a `dispose` and the service calls it on unload.
 *
 * `evidenceMatch` is left `unknown` here because the connected Server ID is a
 * client probe fact; the browser materializes it with {@link withEvidenceMatch}.
 * @module dsh-zotero/session-projection/source-ledger
 */
import { z } from 'zod';
import { chunkedListSchema } from '@deepseek-ai/dsh-chunked-list';
import { blockCountOf, emptyLedgerState, factsFrom, factsOf, foldLedgerEvent, pendingBlocksOf, settledBlockOf, } from '../sources/event-ledger.js';
import { SourceWorkspaceIndex } from '../sources/ledger.js';
import { sourceWorkspaceSchema } from '../sources/workspace-schema.js';
/** The projection key the browser reads. */
const SOURCE_LEDGER_KEY = 'zoteroSources';
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
/**
 * The fold state's strict schema. Exported so the spec can prove the bounds
 * the writer respects are also the bounds a replayed state must satisfy.
 */
export const ledgerStateSchema = z
    .object({
    // The fold appends through the harness chunked list: the recursive schema
    // enforces the 64-value chunk bound and rejects empty chunks and unknown
    // fields, so a corrupt or foreign state cannot claim an unbounded append
    // cost. `undefined` is the empty list.
    blockChunks: chunkedListSchema(blockFactSchema).optional(),
    pending: z.record(z.string(), pendingCallSchema),
    // The recorded callIds the fold dedupes against; see SourceLedgerState.
    recorded: z.record(z.string(), z.literal(true)),
})
    .strict();
const stateSchema = z
    .object({
    ledger: ledgerStateSchema,
})
    .strict();
/**
 * Create the literature-trail projection and the fold cache it owns.
 *
 * Fork-inherited events are folded like any other: a forked session's trail is
 * the history its user can see. The fold is lazy: a session whose trail is
 * never viewed stores its blocks but builds no index; the first view builds
 * one from the whole log, and every later apply extends it.
 * @returns the definition to register, plus the full-view reader and the disposer.
 */
export function createSourceLedgerProjection() {
    /**
     * The fold cache: one chain per state the harness handed back. A state that
     * this instance never folded (a restored checkpoint, or one whose index
     * moved past it) is rebuilt from its own blocks once, then keeps folding, so
     * a cold or interleaved read is linear instead of wrong.
     */
    let compactView = createSourceWireView();
    let chains = new WeakMap();
    const currentChain = (state) => {
        const chain = chains.get(state);
        if (chain === undefined)
            return undefined;
        return chain.index.applied === blockCountOf(state.ledger) ? chain : undefined;
    };
    const chainOf = (state) => {
        const current = currentChain(state);
        if (current !== undefined)
            return current;
        const index = new SourceWorkspaceIndex();
        for (const fact of factsOf(state.ledger))
            index.apply(settledBlockOf(fact));
        const rebuilt = { index };
        chains.set(state, rebuilt);
        return rebuilt;
    };
    const read = (state, currentServerId, windowed) => chainOf(state).index.workspace(pendingBlocksOf(state.ledger), {
        ...(currentServerId === undefined ? {} : { currentServerId }),
        windowed,
    });
    const definition = {
        key: SOURCE_LEDGER_KEY,
        // Version 4 moves the settled facts onto the harness chunked list shape
        // ({ values, previous } links instead of nested arrays); older checkpoints
        // fail the state schema and replay the event log.
        stateVersion: 4,
        stateSchema,
        init: () => ({
            ledger: emptyLedgerState(),
        }),
        apply: (state, event) => {
            const ledger = foldLedgerEvent(state.ledger, event);
            if (ledger === state.ledger)
                return state;
            const next = { ...state, ledger };
            const chain = currentChain(state);
            if (chain !== undefined) {
                for (const fact of factsFrom(ledger, chain.index.applied)) {
                    chain.index.apply(settledBlockOf(fact));
                }
                chains.set(next, { index: chain.index });
            }
            return next;
        },
        wire: {
            summary: false,
            viewSchema: sourceWorkspaceSchema,
            view: (state) => compactView(read(state, undefined, true), blockCountOf(state.ledger)),
        },
    };
    return {
        definition,
        fullWorkspaceOf: (state, currentServerId) => read(state, currentServerId, false),
        dispose: () => {
            chains = new WeakMap();
            compactView = createSourceWireView();
        },
    };
}
//# sourceMappingURL=source-ledger.js.map