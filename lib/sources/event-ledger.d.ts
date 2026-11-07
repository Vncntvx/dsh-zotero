/**
 * The host-side event fold of the literature trail: a compact, JSON-only
 * record of the session's Zotero tool outcomes, replayed through the same
 * workspace builder the browser fallback uses.
 *
 * State holds the settled outcome facts (arguments, result content, meta), not
 * the rendered workspace, because the workspace builder owns the aggregation
 * rules and must not be duplicated. The facts are bounded by the session's own
 * tool output: full texts that exceed the inline budget are already spilled by
 * the tools, so a block carries a locator rather than the full text.
 * @module dsh-zotero/sources/event-ledger
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import type { SourceWorkspace } from './model.js';
import type { ToolBlockLike } from './block-types.js';
/** One settled Zotero outcome as pure JSON. */
export interface LedgerBlockFact {
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
export interface LedgerPendingCall {
    readonly callId: string;
    readonly name: string;
    readonly argsRaw: string;
    readonly seq: number;
    readonly time: number;
}
/** The fold state: settled facts in transcript order plus unsettled calls. */
export interface SourceLedgerState {
    readonly blocks: readonly LedgerBlockFact[];
    readonly pending: Readonly<Record<string, LedgerPendingCall>>;
}
/** The projection state: the fold plus the fork-inherited prefix length. */
export interface SourceLedgerProjectionState {
    readonly inheritedEventCount: number;
    readonly ledger: SourceLedgerState;
}
/** The empty fold state. */
export declare function emptyLedgerState(): SourceLedgerState;
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
 * The blocks a workspace build replays: settled outcomes plus the calls still
 * waiting, which the reducer counts as running operations.
 * @param state - the fold state.
 * @returns the ordered blocks.
 */
export declare function blocksOf(state: SourceLedgerState): readonly ToolBlockLike[];
/**
 * Build the rendered workspace from the current fold.
 * @param state - the fold state.
 * @param currentServerId - connected instance id, when the caller knows it.
 * @returns the aggregated workspace.
 */
export declare function workspaceOf(state: SourceLedgerState, currentServerId?: string): SourceWorkspace;
//# sourceMappingURL=event-ledger.d.ts.map