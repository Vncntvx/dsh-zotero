/**
 * Generic-job adaptation for long-running Zotero operations:
 * connects heavy domain operations (export, changes) to `ctx.jobs`,
 * providing progress updates to the Web session header, non-intrusive logging,
 * user cancellation (kill), and promote-on-timeout foreground execution.
 *
 * @module dsh-zotero/job-runner
 */
import { HarnessError } from '@deepseek-ai/dsh-error';
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools';
import { ToolArgsError, ToolContextUnavailableError } from '@deepseek-ai/dsh-tools';
import { TOOL_ABORTED_MESSAGE } from './abort.js';
import { errorMessageOf, ZOTERO_UNEXPECTED, ZoteroError } from './errors.js';
import { FIBER_STATE } from './fiber-state.js';
/** Structured abort thrown when a tool call or job wait is cancelled by the caller. */
function toolAborted() {
    const error = new HarnessError(TOOL_ABORTED_MESSAGE, TOOL_ABORTED);
    error.name = 'AbortError';
    return error;
}
/**
 * Shown when the host serves no job registry. The model cannot change the
 * deployment, so the sentence names the one thing it can do — run the call in
 * the foreground — instead of the packages the host would have to compose.
 */
export const JOBS_UNAVAILABLE_MESSAGE = 'Background execution is unavailable in this session; run the call in the foreground.';
export const RUN_IN_BACKGROUND_DISABLED_MESSAGE = 'run_in_background is disabled in this deployment; run the call in the foreground.';
export function jobStartedMessage(jobId) {
    return `started background job ${jobId}`;
}
/**
 * Register a tool whose `run_in_background` parameter exists only when this
 * composition can serve it: the deployment enabled the flag and a job registry
 * is mounted. One long-lived registration follows both facts: it starts with
 * the arm the current composition can serve, swaps when the jobs service
 * mounts or unloads, and swaps again when the live switch flips through
 * `loader/volatile-update`. Execute still refuses an undeclared background
 * request, because the registry admits argument keys the schema omits.
 * @param ctx - the plugin context.
 * @param backgroundEnabled - the live deployment switch.
 * @param register - registers one arm and returns its disposer.
 * @returns the disposer for the whole registration.
 */
export function registerBackgroundAware(ctx, backgroundEnabled, register) {
    let jobsPresent = ctx.get('jobs') !== undefined;
    let current;
    let currentBackground;
    let closed = false;
    const install = () => {
        if (closed)
            return;
        const desired = backgroundEnabled() && jobsPresent;
        if (currentBackground === desired)
            return;
        current?.();
        current = register(desired);
        currentBackground = desired;
    };
    install();
    const injection = ctx.inject(['jobs'], () => {
        jobsPresent = true;
        install();
        return () => {
            jobsPresent = false;
            // The registry unloaded while this plugin stayed active: degrade to the
            // foreground schema instead of disappearing from the registry.
            if (ctx.fiber.state === FIBER_STATE.ACTIVE)
                install();
        };
    });
    const offConfig = ctx.on('loader/volatile-update', (paths) => {
        if (!paths.some((path) => path.length === 0 || path[0] === 'enableRunInBackground'))
            return;
        install();
    });
    return () => {
        closed = true;
        offConfig();
        current?.();
        current = undefined;
        currentBackground = undefined;
        void injection.dispose();
    };
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
    resultSessionId: { type: 'string' },
};
export const PROMOTED_OUTPUT_PROPERTIES = {
    kind: { type: 'string', required: true, const: 'promoted' },
    jobId: { type: 'string', required: true },
    resultSessionId: { type: 'string' },
    timeoutMs: { type: 'number', required: true },
    message: { type: 'string', required: true },
};
/**
 * Parameter schema for the `run_in_background` flag that heavy tools share.
 */
export const RUN_IN_BACKGROUND_PARAMETER = {
    run_in_background: {
        type: 'boolean',
        default: false,
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
 * call and the text renderer.
 */
export async function executeWithJobs(options) {
    const { runner, exec, label, run, renderResult, policy } = options;
    const task = {
        label,
        exec,
        ...(options.kind === undefined ? {} : { kind: options.kind }),
        ...(options.outputLimitBytes === undefined
            ? {}
            : { outputLimitBytes: options.outputLimitBytes }),
        run,
        renderResult,
    };
    if (options.runInBackground) {
        if (!policy.enableRunInBackground) {
            throw new ToolArgsError([RUN_IN_BACKGROUND_DISABLED_MESSAGE]);
        }
        if (!runner.isAvailable) {
            throw new ToolContextUnavailableError(JOBS_UNAVAILABLE_MESSAGE);
        }
        const { id } = runner.start(task);
        return {
            kind: 'background',
            jobId: id,
            ...(exec.agent?.session ? { resultSessionId: exec.agent.session.header.id } : {}),
        };
    }
    if (runner.isAvailable && policy.promoteOnTimeout) {
        const outcome = await runner.waitOrPromote(task, policy.foregroundWaitMs);
        return outcome.kind === 'promoted'
            ? {
                ...outcome,
                ...(exec.agent?.session ? { resultSessionId: exec.agent.session.header.id } : {}),
            }
            : outcome.value;
    }
    return await run(exec.signal, () => { }, () => { });
}
export class ZoteroJobRunner {
    registrySource;
    sink;
    delivery;
    /** Live jobs this runner started, with the owner the registry fences on. */
    active = new Map();
    constructor(registrySource, sink, delivery) {
        this.registrySource = registrySource;
        this.sink = sink;
        this.delivery = delivery;
    }
    registry() {
        return typeof this.registrySource === 'function' ? this.registrySource() : this.registrySource;
    }
    get isAvailable() {
        return this.registry() !== undefined;
    }
    /**
     * Stop every job this runner started and has not observed settling. Used by
     * a component teardown so disabling a producer does not leave its jobs
     * pointing at a disposed store or transport.
     * @param reason - registry-visible cancellation reason.
     */
    killAll(reason) {
        for (const [id, { registry, owner }] of this.active) {
            try {
                registry.kill(id, owner, reason);
            }
            catch {
                // A job that settled between the snapshot and kill is already gone.
            }
        }
    }
    /**
     * Start an asynchronous background job with `ctx.jobs`.
     * @param task - the job body and its rendered outcome text.
     * @param options - `persistAtCompletion` is read once the body settles; a
     *   foreground wait passes a predicate so only a promoted settle publishes.
     */
    start(task, options) {
        const registry = this.registry();
        if (!registry) {
            throw new ToolContextUnavailableError(JOBS_UNAVAILABLE_MESSAGE);
        }
        if (task.exec.signal.aborted) {
            throw toolAborted();
        }
        const abortController = new AbortController();
        let resolveOutcome;
        const donePromise = new Promise((resolve) => {
            resolveOutcome = resolve;
        });
        const id = registry.start({
            kind: task.kind ?? 'zotero',
            label: task.label,
            ...(task.outputLimitBytes === undefined ? {} : { outputLimitBytes: task.outputLimitBytes }),
            toolCall: { callId: task.exec.callId, rootCallId: task.exec.rootCallId },
            ...(task.exec.agent ? { owner: task.exec.agent.id } : {}),
            run: (job) => {
                void (async () => {
                    try {
                        const value = await task.run(abortController.signal, (event) => {
                            job.updateProgress(event.message);
                            job.append(`[progress] ${event.message}\n`, { channel: 'log' });
                        }, (text) => {
                            job.append(text.endsWith('\n') ? text : `${text}\n`, { channel: 'log' });
                        }, job.id);
                        const prepared = this.delivery && (options?.persistAtCompletion?.() ?? true)
                            ? await this.delivery
                                .prepare(task.exec, value, (data) => [{ type: 'text', text: task.renderResult?.(data) ?? '' }], abortController.signal, job.id)
                                .catch((error) => {
                                // A publish failure after the body has settled must not turn a
                                // completed, already-published job into a failed one.
                                this.sink?.warn('job.delivery', `${task.label} completed but its result could not be persisted: ${errorMessageOf(error)}`);
                                return undefined;
                            })
                            : undefined;
                        const result = prepared?.delivery === 'file' ? prepared.summary : task.renderResult?.(value);
                        this.sink?.info('job.outcome', `${task.label} completed`);
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
                            this.sink?.info('job.outcome', `${task.label} cancelled: ${reason}`);
                            resolveOutcome({
                                status: 'killed',
                                detail: reason,
                            });
                        }
                        else {
                            const message = errorMessageOf(error);
                            const code = error instanceof ZoteroError ? error.code : undefined;
                            this.sink?.error('job.outcome', `${task.label} failed: ${message}`, code === undefined ? undefined : { errorCode: code });
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
        this.delivery?.track(donePromise);
        this.active.set(id, { registry, owner: task.exec.agent?.id });
        void donePromise.then(() => this.active.delete(id), () => this.active.delete(id));
        return { id, done: donePromise };
    }
    /**
     * Wait for a job in the foreground up to `waitTimeoutMs`.
     * If it completes in time, the job record is removed from the registry (clean foreground experience)
     * and the result is returned.
     * If it times out, the job is promoted to run in the background.
     */
    async waitOrPromote(task, waitTimeoutMs) {
        const registry = this.registry();
        if (!registry) {
            const value = await task.run(task.exec.signal, () => { }, () => { });
            return { kind: 'foreground', value };
        }
        if (task.exec.signal.aborted) {
            throw toolAborted();
        }
        let resultValue;
        /** A promoted job publishes its result; a foreground settle leaves that to `wrap`. */
        let promoted = false;
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
            started = this.start(wrappedTask, { persistAtCompletion: () => promoted });
        }
        catch (error) {
            this.sink?.warn('job.refused', `job registration refused, running in the foreground: ${errorMessageOf(error)}`);
            const value = await task.run(task.exec.signal, () => { }, () => { });
            return { kind: 'foreground', value };
        }
        const { id, done } = started;
        const owner = task.exec.agent?.id;
        /**
         * Publish a body the run already produced. The job body itself publishes
         * too (same owning call, deduplicated in `ResultDelivery`), so a promotion
         * that races the settle still has one receipt before the caller sees it.
         */
        const publishSettled = async (value) => {
            if (value === undefined || this.delivery === undefined)
                return;
            try {
                await this.delivery.prepare(task.exec, value, (data) => [{ type: 'text', text: task.renderResult?.(data) ?? '' }], task.exec.signal, id);
            }
            catch (error) {
                this.sink?.warn('job.delivery', `${task.label} was promoted but its result could not be persisted: ${errorMessageOf(error)}`);
            }
        };
        let view;
        try {
            view = await registry.wait(id, waitTimeoutMs, owner, task.exec.signal);
        }
        catch (error) {
            // Only a caller abort cancels the job. A registry failure (unknown id,
            // owner fence, internal error) must not destroy a healthy in-flight
            // operation or be reported as cancellation.
            if (task.exec.signal.aborted) {
                try {
                    registry.kill(id, owner, TOOL_ABORTED_MESSAGE);
                }
                catch {
                    // The owner may have been disposed, or the registry may have
                    // observed terminal settlement between wait rejection and here.
                }
                // `kill` moves a live job to `stopping`; stay on its settlement for
                // the bounded cancellation window so the completion is `awaited` and
                // no follow-up notice announces a job id this call never returned.
                // Cancellation still ends within the settle window even if the
                // producer refuses to stop.
                await this.removeAfterCancellation(registry, id, owner);
                throw toolAborted();
            }
            // The job is still live and the id is the only handle. Hand it back as a
            // promotion so the model can collect or kill it, rather than rethrowing
            // and leaving unowned work in the registry.
            this.sink?.warn('job.promoted', `${task.label} handed to the background after a wait failure`, {
                jobId: id,
            });
            promoted = true;
            await publishSettled(resultValue);
            return {
                kind: 'promoted',
                jobId: id,
                timeoutMs: waitTimeoutMs,
                message: jobWaitFailedMessage(id, error),
            };
        }
        if (view.status === 'running' || view.status === 'stopping') {
            // Timed out: job is promoted to background.
            this.sink?.info('job.promoted', `${task.label} promoted to the background`, {
                jobId: id,
                waitMs: waitTimeoutMs,
            });
            promoted = true;
            await publishSettled(resultValue);
            return {
                kind: 'promoted',
                jobId: id,
                timeoutMs: waitTimeoutMs,
                message: jobPromotedMessage(id, waitTimeoutMs),
            };
        }
        // Settled within foreground wait
        registry.remove(id, owner);
        if (view.status === 'failed') {
            // Prefer the producer's own error: the registry's `detail` is a string,
            // and a `ZoteroError`'s code is what the model routes on. `done` is
            // already settled here, because the registry publishes its terminal view
            // only after the producer promise resolves, so this await cannot block.
            const settled = await done;
            if (settled.error instanceof Error)
                throw settled.error;
            throw new ZoteroError(view.detail ?? 'Zotero operation failed', ZOTERO_UNEXPECTED);
        }
        if (view.status === 'killed') {
            // A job killed while this call waited is an abort, not a generic failure:
            // the model must not retry work another caller cancelled.
            const error = new HarnessError(`Zotero operation cancelled: ${view.detail ?? 'cancelled'}`, TOOL_ABORTED);
            error.name = 'AbortError';
            throw error;
        }
        return { kind: 'foreground', value: resultValue };
    }
    /** Remove a cancelled foreground record after the registry has settled it. */
    async removeAfterCancellation(registry, id, owner) {
        try {
            // LocalJobRegistry settles from the producer promise in a following
            // microtask; wait through its public view rather than racing remove.
            const view = await registry.wait(id, JOB_CANCELLATION_SETTLE_MS, owner);
            if (view.status === 'completed' || view.status === 'failed' || view.status === 'killed') {
                registry.remove(id, owner);
            }
        }
        catch {
            // A cancelled foreground call has no model-visible job id. If the
            // producer refuses to settle within the window, the registry retains it
            // for normal owner disposal rather than turning cancellation into a
            // second error.
        }
    }
}
//# sourceMappingURL=job-runner.js.map