/**
 * The host-side event fold of the literature trail: a compact, JSON-only
 * record of the session's Zotero tool outcomes, consumed by the incremental
 * source projection.
 *
 * State holds arguments and presentation facts. Only exports and valid durable
 * receipts retain content blocks; other tool bodies already live in the
 * session event log. The incremental workspace index owns aggregation.
 * @module dsh-zotero/sources/event-ledger
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import { type ChunkedList } from '@deepseek-ai/dsh-chunked-list';
import type { SettledToolBlock, ToolBlockLike } from './block-types.js';
/** One settled Zotero outcome as pure JSON. */
interface LedgerBlockFact {
    readonly callId: string;
    readonly seq: number;
    readonly time: number;
    readonly name: string;
    readonly argsRaw: string;
    readonly callTime: number;
    readonly content: readonly JsonValue[];
    readonly isError: boolean;
    readonly error?: {
        readonly name: string;
        readonly code: string;
        readonly reason?: string;
    };
    readonly meta?: JsonValue;
}
/** One call whose result has not landed yet. */
interface LedgerPendingCall {
    readonly callId: string;
    readonly name: string;
    readonly argsRaw: string;
    readonly seq: number;
    readonly time: number;
}
/** The fold state: settled facts in transcript order plus unsettled calls. */
export interface SourceLedgerState {
    /**
     * Settled facts in transcript order, as the harness chunked list: an append
     * copies at most one 64-value chunk and shares every older one, and the
     * recursive zod schema validates checkpointed shapes (absent = empty).
     */
    readonly blockChunks?: ChunkedList<LedgerBlockFact> | undefined;
    readonly pending: Readonly<Record<string, LedgerPendingCall>>;
    /**
     * Call ids that need a durable dedupe: the ones a `tool/ptc-dispatch`
     * settled, because that arm records without a pending entry (a dispatch may
     * outlive its turn). The tool/result arm needs no record — its pending entry
     * is the dedupe and is deleted in the same step — so this stays small even on
     * a long session. A Set cannot survive the strict zod state schema, so the
     * ids ride the state as a plain record.
     */
    readonly recorded: Readonly<Record<string, true>>;
}
/** The projection state: the complete durable fold. */
export interface SourceLedgerProjectionState {
    readonly ledger: SourceLedgerState;
}
/** The empty fold state. */
export declare function emptyLedgerState(): SourceLedgerState;
/** How many settled facts the state holds. */
export declare function blockCountOf(state: SourceLedgerState): number;
/** Every settled fact, flattened. Used by a rebuild, not by the per-event fold. */
export declare function factsOf(state: SourceLedgerState): readonly LedgerBlockFact[];
/**
 * The settled facts at or after one transcript index, without materializing the
 * prefix the caller already folded.
 * @param state - the fold state.
 * @param start - the first fact index to return.
 * @returns the facts in transcript order.
 */
export declare function factsFrom(state: SourceLedgerState, start: number): readonly LedgerBlockFact[];
/** Build the settled block a fact replays as. */
export declare function settledBlockOf(fact: LedgerBlockFact): SettledToolBlock;
/**
 * Fold one committed session event into the ledger.
 *
 * Unrelated events return the same state reference. Malformed payloads are
 * skipped rather than thrown: a throwing `apply` would fail every later read of
 * the Session's projections.
 * @param state - the current fold state.
 * @param event - the committed session event.
 * @returns the next state, or the same reference when nothing changed.
 */
export declare function foldLedgerEvent(state: SourceLedgerState, event: SessionEvent): SourceLedgerState;
/**
 * The calls still waiting for their result, as the running blocks the
 * workspace reducer counts as running operations. They always follow every
 * settled block: a call without a result has no transcript position yet.
 * @param state - the fold state.
 * @returns the running blocks, in first-seen order.
 */
export declare function pendingBlocksOf(state: SourceLedgerState): readonly ToolBlockLike[];
export {};
//# sourceMappingURL=event-ledger.d.ts.map