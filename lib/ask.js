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
import { HarnessError } from '@deepseek-ai/dsh-llm';
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools';
import { ZOTERO_LOCAL_API_VERSION } from './constants.js';
import { TOOL_ABORTED_MESSAGE, ZOTERO_API_DISABLED, ZOTERO_API_VERSION, ZOTERO_NOT_RUNNING, ZOTERO_TIMEOUT, ZoteroError, } from './errors.js';
/** The connectivity failure codes that warrant asking the user how to proceed. */
const ASK_WORTHY_CODES = [
    ZOTERO_NOT_RUNNING,
    ZOTERO_API_DISABLED,
    ZOTERO_API_VERSION,
    ZOTERO_TIMEOUT,
];
const ABORT_LABEL = 'Abort this query';
const ABORT_DESCRIPTION = 'Stop this operation; ask me to retry later if you still need it.';
const RETRY_DESCRIPTION = 'Re-run the query with the original parameters.';
const FAILURE_SPECS = {
    [ZOTERO_NOT_RUNNING]: {
        header: 'Zotero is not running',
        question: 'Zotero is not running, so I cannot read your library. What should I do?',
        detail: 'Start Zotero, then in Settings → Advanced check "Allow other applications on this computer to communicate with Zotero".',
        retryLabel: 'I started Zotero, retry (Recommended)',
        retryDescription: RETRY_DESCRIPTION,
        abortLabel: ABORT_LABEL,
        abortDescription: ABORT_DESCRIPTION,
    },
    [ZOTERO_API_DISABLED]: {
        header: 'Zotero local API is disabled',
        question: 'Zotero is running but rejected the local API request (403).',
        detail: 'In Zotero Settings → Advanced, check "Allow other applications on this computer to communicate with Zotero".',
        retryLabel: 'I enabled the local API, retry (Recommended)',
        retryDescription: RETRY_DESCRIPTION,
        abortLabel: ABORT_LABEL,
        abortDescription: ABORT_DESCRIPTION,
    },
    [ZOTERO_API_VERSION]: {
        header: 'Zotero and this plugin share no API version',
        question: `The running Zotero does not implement local API version ${ZOTERO_LOCAL_API_VERSION}, which this plugin requires.`,
        detail: `Upgrade Zotero to a version whose local API supports version ${ZOTERO_LOCAL_API_VERSION} — or update dsh-zotero if the running Zotero is newer than this plugin line.`,
        retryLabel: 'I fixed the version, retry (Recommended)',
        retryDescription: RETRY_DESCRIPTION,
        abortLabel: ABORT_LABEL,
        abortDescription: ABORT_DESCRIPTION,
    },
    [ZOTERO_TIMEOUT]: {
        header: 'Zotero timed out',
        question: 'Zotero did not respond within the timeout (it may be indexing a large library).',
        detail: 'The request failed after the configured timeout.',
        retryLabel: 'Retry (Recommended)',
        retryDescription: 'Run the same request again.',
        abortLabel: ABORT_LABEL,
        abortDescription: ABORT_DESCRIPTION,
    },
};
function isAskWorthyCode(code) {
    return ASK_WORTHY_CODES.includes(code);
}
function questionOf(spec) {
    return {
        id: 'zotero-failure',
        question: spec.question,
        header: spec.header,
        detail: spec.detail,
        options: [
            { label: spec.retryLabel, description: spec.retryDescription },
            { label: spec.abortLabel, description: spec.abortDescription },
        ],
    };
}
export class ConnectivityRecovery {
    asking = new Map();
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
    async ask(code, question, waiterSignal) {
        let shared = this.asking.get(code);
        if (shared === undefined) {
            const controller = new AbortController();
            const entry = {
                controller,
                waiters: 0,
                promise: question(controller.signal),
            };
            shared = entry;
            this.asking.set(code, entry);
            void entry.promise
                .catch(() => undefined)
                .finally(() => {
                if (this.asking.get(code) === entry)
                    this.asking.delete(code);
            });
        }
        shared.waiters += 1;
        const entry = shared;
        try {
            return await awaitSharedAsk(entry, waiterSignal);
        }
        finally {
            entry.waiters -= 1;
            if (entry.waiters === 0) {
                // Last waiter left before the question settled: end the shared ask
                // so no orphaned card stays in front of the user.
                entry.controller.abort();
            }
        }
    }
}
/**
 * Wait for a shared question, or detach early when the waiter's own signal
 * aborts. Detaching does not reject the shared promise for other waiters.
 */
function awaitSharedAsk(entry, waiterSignal) {
    if (waiterSignal === undefined)
        return entry.promise;
    if (waiterSignal.aborted) {
        return Promise.reject(new HarnessError(TOOL_ABORTED_MESSAGE, TOOL_ABORTED));
    }
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            reject(new HarnessError(TOOL_ABORTED_MESSAGE, TOOL_ABORTED));
        };
        waiterSignal.addEventListener('abort', onAbort, { once: true });
        entry.promise.then((value) => {
            waiterSignal.removeEventListener('abort', onAbort);
            resolve(value);
        }, (error) => {
            waiterSignal.removeEventListener('abort', onAbort);
            reject(error);
        });
    });
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
export async function withConnectivityAsk(ctx, recovery, exec, run) {
    try {
        return await run();
    }
    catch (error) {
        if (!(error instanceof ZoteroError) || !isAskWorthyCode(error.code))
            throw error;
        const questions = ctx.get('userQuestions');
        if (questions === undefined)
            throw error;
        const spec = FAILURE_SPECS[error.code];
        let retry;
        try {
            retry = await recovery.ask(error.code, async (signal) => {
                const request = {
                    questions: [questionOf(spec)],
                    ...(exec.agent !== undefined ? { agent: exec.agent } : {}),
                    // The gate's own signal: one waiter's cancellation must not
                    // cancel a question the other waiters still need answered.
                    signal,
                };
                const answer = await questions.ask(request);
                const answerItem = answer.answers.find((item) => item.id === 'zotero-failure');
                // Matched by label string because the answer protocol carries only
                // selected labels (no stable option ids); the labels are code
                // constants (FAILURE_SPECS), never i18n copy, so a rename breaks the
                // build's contract visibly in one place. Revisit if the protocol
                // gains option ids.
                return (answerItem?.selected ?? []).includes(spec.retryLabel);
            }, exec.signal);
        }
        catch {
            // A failed question (no provider, aborted ask, delegated caller) must
            // never mask the underlying connectivity failure. This waiter's own
            // abort still surfaces as TOOL_ABORTED for this call alone.
            if (exec.signal?.aborted)
                throw new HarnessError(TOOL_ABORTED_MESSAGE, TOOL_ABORTED);
            throw error;
        }
        if (!retry)
            throw error;
        // Outside the catch: a second failure propagates as-is, never re-asking.
        return await run();
    }
}
//# sourceMappingURL=ask.js.map