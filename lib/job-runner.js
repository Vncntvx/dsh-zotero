/**
 * Generic-job adaptation for long-running Zotero operations:
 * connects heavy domain operations (export, changes) to `ctx.jobs`,
 * providing progress updates to the Web session header, non-intrusive logging,
 * user cancellation (kill), and promote-on-timeout foreground execution.
 *
 * @module dsh-zotero/job-runner
 */
import { HarnessError } from '@deepseek-ai/dsh-llm';
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools';
import { errorMessageOf, TOOL_ABORTED_MESSAGE } from './errors.js';
/** Structured abort thrown when a tool call or job wait is cancelled by the caller. */
function toolAborted() {
    const error = new HarnessError(TOOL_ABORTED_MESSAGE, TOOL_ABORTED);
    error.name = 'AbortError';
    return error;
}
export const JOBS_UNAVAILABLE_MESSAGE = 'background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs';
export const RUN_IN_BACKGROUND_DISABLED_MESSAGE = 'run_in_background is disabled for this deployment (enableRunInBackground: false)';
export function jobStartedMessage(jobId) {
    return `started background job ${jobId}`;
}
/** Grace period for a cancelled job to settle before removing from the registry (ms). */
const JOB_CANCELLATION_SETTLE_MS = 1000;
export function jobPromotedMessage(jobId, timeoutMs) {
    return `operation timed out after ${timeoutMs}ms and was promoted to background job ${jobId}`;
}
/** Honest promotion copy when the foreground wait itself failed, not a timeout. */
export function jobWaitFailedMessage(jobId, error) {
    const reason = errorMessageOf(error);
    return `foreground wait failed (${reason}); the work continues as background job ${jobId}`;
}
/**
 * Whether a tool result is one of the two job arms rather than a domain payload.
 * Structural (not `JobArmResult`) so it narrows schema-inferred unions whose
 * `jobId` is a plain string.
 */
export function isJobArm(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const kind = value.kind;
    return kind === 'background' || kind === 'promoted';
}
/** Render the started/promoted text a model reads for a job arm. */
export function renderJobArm(value) {
    const text = value.kind === 'background'
        ? jobStartedMessage(value.jobId)
        : (value.message ?? jobStartedMessage(value.jobId));
    return [{ type: 'text', text }];
}
/** Generic card title for a job arm, with the tool noun supplied by the caller. */
export function presentJobArm(noun, record) {
    if (!isJobArm(record))
        return undefined;
    const jobId = String(record.jobId);
    const title = record.kind === 'background'
        ? `${noun}: background job ${jobId}`
        : `${noun}: promoted to job ${jobId}`;
    return { card: 'generic', title };
}
/**
 * Output-schema arms for the two job returns every heavy tool shares. Kept
 * here so a third tool cannot spell them a third way.
 */
export const BACKGROUND_OUTPUT_PROPERTIES = {
    kind: { type: 'string', required: true, const: 'background' },
    jobId: { type: 'string', required: true },
};
export const PROMOTED_OUTPUT_PROPERTIES = {
    kind: { type: 'string', required: true, const: 'promoted' },
    jobId: { type: 'string', required: true },
    timeoutMs: { type: 'number', required: true },
    message: { type: 'string', required: true },
};
/**
 * Parameter schema for the `run_in_background` flag that heavy tools share.
 */
export const RUN_IN_BACKGROUND_PARAMETER = {
    run_in_background: {
        type: 'boolean',
        description: 'Run in the background and return a job id immediately (collect with job_output, stop with job_kill).',
    },
};
/** Read the three job controls from a live config without repeating the mapping in each tool. */
export function jobPolicyOf(config) {
    return {
        enableRunInBackground: config.enableRunInBackground,
        promoteOnTimeout: config.promoteOnTimeout,
        foregroundWaitMs: config.foregroundWaitMs,
    };
}
/**
 * Shared execute policy for heavy tools: explicit background start, promote
 * on foreground timeout, or a plain synchronous run. Tools supply the domain
 * call (already wrapped in `withConnectivityAsk`) and the text renderer.
 */
export async function executeWithJobs(options) {
    const { runner, exec, label, run, renderResult, policy } = options;
    const task = { label, exec, run, renderResult };
    if (options.runInBackground) {
        if (!policy.enableRunInBackground) {
            throw new Error(RUN_IN_BACKGROUND_DISABLED_MESSAGE);
        }
        if (!runner.isAvailable) {
            throw new Error(JOBS_UNAVAILABLE_MESSAGE);
        }
        const { id } = runner.start(task);
        return { kind: 'background', jobId: id };
    }
    if (runner.isAvailable && policy.promoteOnTimeout) {
        const outcome = await runner.waitOrPromote(task, policy.foregroundWaitMs);
        return outcome.kind === 'promoted' ? outcome : outcome.value;
    }
    return await run(exec.signal, () => { }, () => { });
}
export class ZoteroJobRunner {
    registry;
    logger;
    constructor(registry, logger) {
        this.registry = registry;
        this.logger = logger;
    }
    get isAvailable() {
        return this.registry !== undefined;
    }
    /**
     * Start an asynchronous background job with `ctx.jobs`.
     */
    start(task) {
        if (!this.registry) {
            throw new Error(JOBS_UNAVAILABLE_MESSAGE);
        }
        if (task.exec.signal.aborted) {
            throw toolAborted();
        }
        const abortController = new AbortController();
        let resolveOutcome;
        const donePromise = new Promise((resolve) => {
            resolveOutcome = resolve;
        });
        const id = this.registry.start({
            kind: 'zotero',
            label: task.label,
            ...(task.exec.agent ? { owner: task.exec.agent.id } : {}),
            ...(task.outputLimitBytes !== undefined ? { outputLimitBytes: task.outputLimitBytes } : {}),
            run: (job) => {
                void (async () => {
                    try {
                        const value = await task.run(abortController.signal, (event) => {
                            job.updateProgress(event.message);
                            job.append(`[progress] ${event.message}\n`, { channel: 'log' });
                        }, (text) => {
                            job.append(text.endsWith('\n') ? text : `${text}\n`, { channel: 'log' });
                        });
                        const result = task.renderResult ? task.renderResult(value) : undefined;
                        resolveOutcome({
                            status: 'completed',
                            detail: task.label,
                            ...(result !== undefined ? { result } : {}),
                        });
                    }
                    catch (error) {
                        if (abortController.signal.aborted) {
                            const reason = typeof abortController.signal.reason === 'string'
                                ? abortController.signal.reason
                                : abortController.signal.reason instanceof Error
                                    ? abortController.signal.reason.message
                                    : 'cancelled';
                            resolveOutcome({
                                status: 'killed',
                                detail: reason,
                            });
                        }
                        else {
                            const message = errorMessageOf(error);
                            resolveOutcome({
                                status: 'failed',
                                detail: message,
                                error,
                            });
                        }
                    }
                })();
                return {
                    cancel: (reason) => {
                        abortController.abort(reason ?? 'Job cancelled by user');
                    },
                    done: donePromise,
                };
            },
        });
        return { id, done: donePromise };
    }
    /**
     * Wait for a job in the foreground up to `waitTimeoutMs`.
     * If it completes in time, the job record is removed from the registry (clean foreground experience)
     * and the result is returned.
     * If it times out, the job is promoted to run in the background.
     */
    async waitOrPromote(task, waitTimeoutMs) {
        if (!this.registry) {
            const value = await task.run(task.exec.signal, () => { }, () => { });
            return { kind: 'foreground', value };
        }
        if (task.exec.signal.aborted) {
            throw toolAborted();
        }
        let resultValue;
        // Outcome text is always materialized when the job settles. Skipping it for
        // a foreground settle is racy: the job can finish and render just as the
        // wait times out, leaving a promoted `JobOutcome.result` empty for
        // `job_output`. A discarded foreground string is cheaper than a wrong one.
        const wrappedTask = {
            ...task,
            run: async (signal, onProgress, log) => {
                const val = await task.run(signal, onProgress, log);
                resultValue = val;
                return val;
            },
        };
        // A registry that refuses admission (no controller for the owner, job
        // limit) must not fail a healthy foreground call: run under the caller's
        // own deadline instead, exactly as a composition without a registry does.
        // Mirrors tool-bash's startJob catch → foreground fallback.
        let started;
        try {
            started = this.start(wrappedTask);
        }
        catch (error) {
            this.logger?.warn?.(`zotero: job registration refused, running in the foreground: ${errorMessageOf(error)}`);
            const value = await task.run(task.exec.signal, () => { }, () => { });
            return { kind: 'foreground', value };
        }
        const { id, done } = started;
        const owner = task.exec.agent?.id;
        let view;
        try {
            view = await this.registry.wait(id, waitTimeoutMs, owner, task.exec.signal);
        }
        catch (error) {
            // Only a caller abort cancels the job. A registry failure (unknown id,
            // owner fence, internal error) must not destroy a healthy in-flight
            // operation or be reported as cancellation.
            if (task.exec.signal.aborted) {
                try {
                    this.registry.kill(id, owner, TOOL_ABORTED_MESSAGE);
                }
                catch {
                    // The owner may have been disposed, or the registry may have
                    // observed terminal settlement between wait rejection and here.
                }
                // `kill` moves a live job to `stopping`; remove is legal only after the
                // registry observes terminal settlement. Wait for the producer first,
                // then let the registry publish its terminal view before removing the
                // private foreground record. Cancellation itself must stay immediate.
                void this.removeAfterCancellation(id, owner, done);
                throw toolAborted();
            }
            // The job is still live and the id is the only handle. Hand it back as a
            // promotion so the model can collect or kill it, rather than rethrowing
            // and leaving unowned work in the registry.
            return {
                kind: 'promoted',
                jobId: id,
                timeoutMs: waitTimeoutMs,
                message: jobWaitFailedMessage(id, error),
            };
        }
        if (view.status === 'running' || view.status === 'stopping') {
            // Timed out: job is promoted to background.
            return {
                kind: 'promoted',
                jobId: id,
                timeoutMs: waitTimeoutMs,
                message: jobPromotedMessage(id, waitTimeoutMs),
            };
        }
        // Settled within foreground wait
        this.registry.remove(id, owner);
        if (view.status === 'failed') {
            // Prefer the producer's own error: the registry's `detail` is a string,
            // and a `ZoteroError`'s code is what the model routes on. `done` is
            // already settled here, because the registry publishes its terminal view
            // only after the producer promise resolves, so this await cannot block.
            const settled = await done;
            if (settled.error instanceof Error)
                throw settled.error;
            throw new Error(view.detail ?? 'Zotero operation failed');
        }
        if (view.status === 'killed') {
            throw new Error(`Zotero operation cancelled: ${view.detail ?? 'cancelled'}`);
        }
        return { kind: 'foreground', value: resultValue };
    }
    /** Remove a cancelled foreground record after the registry has settled it. */
    async removeAfterCancellation(id, owner, done) {
        if (!this.registry)
            return;
        try {
            await done;
            // LocalJobRegistry settles from the producer promise in a following
            // microtask; wait through its public view rather than racing remove.
            const view = await this.registry.wait(id, JOB_CANCELLATION_SETTLE_MS, owner);
            if (view.status === 'completed' || view.status === 'failed' || view.status === 'killed') {
                this.registry.remove(id, owner);
            }
        }
        catch {
            // A cancelled foreground call has no model-visible job id. If the
            // producer refuses to settle, the registry retains it for normal owner
            // disposal rather than turning cancellation into a second error.
        }
    }
}
//# sourceMappingURL=job-runner.js.map