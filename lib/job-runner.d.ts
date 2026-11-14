/**
 * Generic-job adaptation for long-running Zotero operations:
 * connects heavy domain operations (export, changes) to `ctx.jobs`,
 * providing progress updates to the Web session header, non-intrusive logging,
 * user cancellation (kill), and promote-on-timeout foreground execution.
 *
 * @module dsh-zotero/job-runner
 */
import type { ResultDelivery } from './result-delivery.js';
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { ToolExecution, ToolResultView } from '@deepseek-ai/dsh-tools';
import type { JobId, JobOutcome, JobRegistry, JobSpec } from '@deepseek-ai/dsh-jobs';
import type { DiagnosticSink } from './diagnostics.js';
import type { ZoteroProgressEvent } from './types.js';
/**
 * Shown when the host serves no job registry. The model cannot change the
 * deployment, so the sentence names the one thing it can do — run the call in
 * the foreground — instead of the packages the host would have to compose.
 */
export declare const JOBS_UNAVAILABLE_MESSAGE = "Background execution is unavailable in this session; run the call in the foreground.";
export declare const RUN_IN_BACKGROUND_DISABLED_MESSAGE = "run_in_background is disabled in this deployment; run the call in the foreground.";
export declare function jobStartedMessage(jobId: string): string;
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
export declare function registerBackgroundAware(ctx: Context, backgroundEnabled: () => boolean, register: (background: boolean) => () => void): () => void;
/**
 * The plugin's own view of a settled job: the harness `JobOutcome` plus the
 * object a failed producer actually threw.
 *
 * The harness boundary is string-only (`JobOutcome.detail`, `JobView.detail`,
 * `JobOutcome.result`), so `ZoteroError` identity cannot cross it. A foreground
 * wait that settles inside the promotion window is the one case the plugin can
 * still answer with the original error, because it holds this promise itself.
 * Every other arm (background, promoted, cancellation) reports the harness's
 * text and keeps the plugin's error out of reach. That is deliberate: nothing
 * at those boundaries can carry an error object.
 */
interface ZoteroJobOutcome extends JobOutcome {
    /** The thrown producer error, present only on the `failed` arm. */
    readonly error?: unknown;
}
export declare function jobPromotedMessage(jobId: string, timeoutMs: number): string;
/** Honest promotion copy when the foreground wait itself failed, not a timeout. */
export declare function jobWaitFailedMessage(jobId: string, error: unknown): string;
/**
 * Whether a tool result is one of the two job arms rather than a domain payload.
 * Structural (not `JobArmResult`) so it narrows schema-inferred unions whose
 * `jobId` is a plain string.
 */
export declare function isJobArm(value: unknown): value is {
    readonly kind: 'background' | 'promoted';
    readonly jobId: string;
};
/** Render the started/promoted text a model reads for a job arm. */
export declare function renderJobArm(value: {
    readonly kind: 'background' | 'promoted';
    readonly jobId: string;
    readonly message?: string;
}): ContentBlock[];
/** Generic card title for a job arm, with the tool noun supplied by the caller. */
export declare function presentJobArm(noun: string, record: Record<string, unknown>): ToolResultView | undefined;
/**
 * Output-schema arms for the two job returns every heavy tool shares. Kept
 * here so a third tool cannot spell them a third way.
 */
export declare const BACKGROUND_OUTPUT_PROPERTIES: {
    readonly kind: {
        readonly type: 'string';
        readonly required: true;
        readonly const: 'background';
    };
    readonly jobId: {
        readonly type: 'string';
        readonly required: true;
    };
    readonly resultSessionId: {
        readonly type: 'string';
    };
};
export declare const PROMOTED_OUTPUT_PROPERTIES: {
    readonly kind: {
        readonly type: 'string';
        readonly required: true;
        readonly const: 'promoted';
    };
    readonly jobId: {
        readonly type: 'string';
        readonly required: true;
    };
    readonly resultSessionId: {
        readonly type: 'string';
    };
    readonly timeoutMs: {
        readonly type: 'number';
        readonly required: true;
    };
    readonly message: {
        readonly type: 'string';
        readonly required: true;
    };
};
/**
 * Parameter schema for the `run_in_background` flag that heavy tools share.
 */
export declare const RUN_IN_BACKGROUND_PARAMETER: {
    readonly run_in_background: {
        readonly type: 'boolean';
        readonly default: false;
        readonly description: 'Run in the background and return a job id immediately (collect with job_output, stop with job_kill).';
    };
};
/** The job kind a shared task registers under. */
type JobSpecKind = JobSpec['kind'];
/** One heavy operation the shared job runner can start or promote. */
export interface ZoteroJobTask<T> {
    readonly label: string;
    readonly exec: ToolExecution;
    readonly kind?: JobSpecKind;
    readonly outputLimitBytes?: number;
    readonly run: (signal: AbortSignal, onProgress: (event: ZoteroProgressEvent) => void, log: (text: string) => void, jobId?: string) => Promise<T>;
    readonly renderResult?: (value: T) => string;
}
type JobRegistrySource = JobRegistry | (() => JobRegistry | undefined);
interface PromotedJobResult {
    readonly kind: 'promoted';
    readonly jobId: JobId;
    readonly timeoutMs: number;
    readonly message: string;
    /** The owning session whose receipts resolve this job's persisted result. */
    readonly resultSessionId?: string;
}
interface BackgroundJobResult {
    readonly kind: 'background';
    readonly jobId: JobId;
    /** The owning session whose receipts resolve this job's persisted result. */
    readonly resultSessionId?: string;
}
export type JobArmResult = BackgroundJobResult | PromotedJobResult;
/** Job policy knobs every heavy tool reads from live config. */
export interface JobPolicy {
    readonly enableRunInBackground: boolean;
    readonly promoteOnTimeout: boolean;
    readonly foregroundWaitMs: number;
}
/** Read the three job controls from a live config without repeating the mapping in each tool. */
export declare function jobPolicyOf(config: JobPolicy): JobPolicy;
/**
 * Shared execute policy for heavy tools: explicit background start, promote
 * on foreground timeout, or a plain synchronous run. Tools supply the domain
 * call and the text renderer.
 */
export declare function executeWithJobs<T>(options: {
    readonly runner: ZoteroJobRunner;
    readonly exec: ToolExecution;
    readonly label: string;
    readonly kind?: ZoteroJobTask<T>['kind'];
    readonly outputLimitBytes?: number;
    readonly run: ZoteroJobTask<T>['run'];
    readonly renderResult: ZoteroJobTask<T>['renderResult'];
    readonly runInBackground: boolean;
    readonly policy: JobPolicy;
}): Promise<T | JobArmResult>;
export declare class ZoteroJobRunner {
    private readonly registrySource?;
    private readonly sink?;
    private readonly delivery?;
    /** Live jobs this runner started, with the owner the registry fences on. */
    private readonly active;
    constructor(registrySource?: JobRegistrySource | undefined, sink?: DiagnosticSink | undefined, delivery?: ResultDelivery | undefined);
    private registry;
    get isAvailable(): boolean;
    /**
     * Stop every job this runner started and has not observed settling. Used by
     * a component teardown so disabling a producer does not leave its jobs
     * pointing at a disposed store or transport.
     * @param reason - registry-visible cancellation reason.
     */
    killAll(reason: string): void;
    /**
     * Start an asynchronous background job with `ctx.jobs`.
     * @param task - the job body and its rendered outcome text.
     * @param options - `persistAtCompletion` is read once the body settles; a
     *   foreground wait passes a predicate so only a promoted settle publishes.
     */
    start<T>(task: ZoteroJobTask<T>, options?: {
        readonly persistAtCompletion?: () => boolean;
    }): {
        id: JobId;
        done: Promise<ZoteroJobOutcome>;
    };
    /**
     * Wait for a job in the foreground up to `waitTimeoutMs`.
     * If it completes in time, the job record is removed from the registry (clean foreground experience)
     * and the result is returned.
     * If it times out, the job is promoted to run in the background.
     */
    waitOrPromote<T>(task: ZoteroJobTask<T>, waitTimeoutMs: number): Promise<{
        kind: 'foreground';
        value: T;
    } | PromotedJobResult>;
    /** Remove a cancelled foreground record after the registry has settled it. */
    private removeAfterCancellation;
}
export {};
//# sourceMappingURL=job-runner.d.ts.map