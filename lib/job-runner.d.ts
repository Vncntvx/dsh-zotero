/**
 * Generic-job adaptation for long-running Zotero operations:
 * connects heavy domain operations (export, changes) to `ctx.jobs`,
 * providing progress updates to the Web session header, non-intrusive logging,
 * user cancellation (kill), and promote-on-timeout foreground execution.
 *
 * @module dsh-zotero/job-runner
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { ToolExecution, ToolResultView } from '@deepseek-ai/dsh-tools';
import type { JobId, JobOutcome, JobRegistry } from '@deepseek-ai/dsh-jobs';
import type { ZoteroProgressEvent } from './types.js';
export declare const JOBS_UNAVAILABLE_MESSAGE = "background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs";
export declare const RUN_IN_BACKGROUND_DISABLED_MESSAGE = "run_in_background is disabled for this deployment (enableRunInBackground: false)";
export declare function jobStartedMessage(jobId: string): string;
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
        readonly type: "string";
        readonly required: true;
        readonly const: "background";
    };
    readonly jobId: {
        readonly type: "string";
        readonly required: true;
    };
};
export declare const PROMOTED_OUTPUT_PROPERTIES: {
    readonly kind: {
        readonly type: "string";
        readonly required: true;
        readonly const: "promoted";
    };
    readonly jobId: {
        readonly type: "string";
        readonly required: true;
    };
    readonly timeoutMs: {
        readonly type: "number";
        readonly required: true;
    };
    readonly message: {
        readonly type: "string";
        readonly required: true;
    };
};
/**
 * Parameter schema for the `run_in_background` flag that heavy tools share.
 */
export declare const RUN_IN_BACKGROUND_PARAMETER: {
    readonly run_in_background: {
        readonly type: "boolean";
        readonly description: "Run in the background and return a job id immediately (collect with job_output, stop with job_kill).";
    };
};
export interface ZoteroJobTask<T> {
    readonly label: string;
    readonly exec: ToolExecution;
    readonly outputLimitBytes?: number;
    readonly run: (signal: AbortSignal, onProgress: (event: ZoteroProgressEvent) => void, log: (text: string) => void) => Promise<T>;
    readonly renderResult?: (value: T) => string;
}
export interface PromotedJobResult {
    readonly kind: 'promoted';
    readonly jobId: JobId;
    readonly timeoutMs: number;
    readonly message: string;
}
export interface BackgroundJobResult {
    readonly kind: 'background';
    readonly jobId: JobId;
}
export type JobArmResult = BackgroundJobResult | PromotedJobResult;
/** Job policy knobs every heavy tool reads from live config. */
export interface JobPolicy {
    readonly enableRunInBackground: boolean;
    readonly promoteOnTimeout: boolean;
    readonly foregroundWaitMs: number;
}
/** Read the three job controls from a live config without repeating the mapping in each tool. */
export declare function jobPolicyOf(config: Pick<JobPolicy, keyof JobPolicy>): JobPolicy;
/**
 * Shared execute policy for heavy tools: explicit background start, promote
 * on foreground timeout, or a plain synchronous run. Tools supply the domain
 * call (already wrapped in `withConnectivityAsk`) and the text renderer.
 */
export declare function executeWithJobs<T>(options: {
    readonly runner: ZoteroJobRunner;
    readonly exec: ToolExecution;
    readonly label: string;
    readonly run: ZoteroJobTask<T>['run'];
    readonly renderResult: ZoteroJobTask<T>['renderResult'];
    readonly runInBackground: boolean;
    readonly policy: JobPolicy;
}): Promise<T | JobArmResult>;
export declare class ZoteroJobRunner {
    private readonly registry?;
    private readonly logger?;
    constructor(registry?: JobRegistry | undefined, logger?: {
        warn(message: string): void;
    } | undefined);
    get isAvailable(): boolean;
    /**
     * Start an asynchronous background job with `ctx.jobs`.
     */
    start<T>(task: ZoteroJobTask<T>): {
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