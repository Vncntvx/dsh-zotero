/**
 * Interactive recovery for Zotero connectivity failures.
 *
 * When a request-driven tool call fails because Zotero cannot serve it
 * (not running, local API disabled, unsupported API version, timeout),
 * the caller is asked how to proceed through the `userQuestions` seam,
 * with the recommended action offered first. The ask happens only inside
 * a tool call that actually attempted a Zotero request — loading the
 * plugin never probes, and a tool that was never called never asks.
 * Everything here fails closed: an absent question service, a failed
 * question, or a non-retry answer all surface the original typed
 * `ZoteroError`, so a broken question mechanism can never mask a broken
 * Zotero connection, and a retry is attempted at most once.
 * @module dsh-zotero/ask
 */
import type { Context } from '@deepseek-ai/cordis';
import { type ToolRunContext } from '@deepseek-ai/dsh-tools';
/** The parts of a tool execution `withConnectivityAsk` needs. */
type ConnectivityAskExec = Pick<ToolRunContext, 'signal' | 'agent'>;
export declare class ConnectivityRecovery {
    private readonly asking;
    /**
     * Answer one failure kind, asking only when no question for it is in
     * flight. Concurrent callers share one question; a waiter whose own
     * `waiterSignal` aborts detaches without cancelling the shared ask for
     * the others. The shared question is aborted only when the last waiter
     * leaves.
     * @param code - the failure kind the question belongs to.
     * @param question - the ask to run when this caller is the first; its
     *   signal is the gate's own (never a single caller's). Resolves true when
     *   the user chose to retry.
     * @param waiterSignal - this caller's cancellation; aborts only this
     *   waiter's wait, not the shared question while others remain.
     * @returns the answer this caller acts on.
     */
    ask(code: string, question: (signal: AbortSignal) => Promise<boolean>, waiterSignal?: AbortSignal): Promise<boolean>;
}
/**
 * Run one Zotero request; on a connectivity failure, ask the user how to
 * proceed and retry at most once when they choose the recommended action.
 * @param ctx - the plugin context; the question service is looked up
 *   optionally, so headless compositions skip the ask.
 * @param recovery - the instance's recovery gate: callers that failed the
 *   same way share one question instead of stacking identical cards.
 * @param exec - the tool execution (signal and agent) the failure belongs to.
 * @param run - the request to attempt; must be re-runnable with identical
 *   arguments, because the retry path calls it a second time.
 * @returns the request result, or throws the original `ZoteroError` when
 *   the failure is not ask-worthy, no question service exists, the user
 *   does not choose to retry, the question itself fails, or the retry
 *   fails again.
 */
export declare function withConnectivityAsk<T>(ctx: Context, recovery: ConnectivityRecovery, exec: ConnectivityAskExec, run: () => Promise<T>): Promise<T>;
export {};
//# sourceMappingURL=ask.d.ts.map