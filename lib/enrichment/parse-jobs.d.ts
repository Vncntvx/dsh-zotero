import { type DisplayArtifactLookup } from './artifact-reads.js';
import type { ParsedArtifactStore, SourceIndexRecord } from './artifact-store.js';
/** Session-owned explicit parsing jobs; the UI observes jobs without owning their lifetime. */
import type { Context } from '@deepseek-ai/cordis';
import { type ZoteroArtifactMetadataView, type ZoteroDocumentArtifactRequestView, ZoteroDocumentArtifactResultView, ZoteroDocumentParseReceiptRequestView, ZoteroDocumentParseReceiptResultView, ZoteroStartDocumentParseRequestView, ZoteroStartDocumentParseResultView } from '../contract.js';
import type { EnrichmentPreferences } from '../enrichment-preferences.js';
import type { ParseDocumentResult } from './parse-document.js';
import type { ParsePhase } from './parse-once.js';
import { type ParseAttachmentResolver } from './parse-target.js';
import type { ParseSourceInput } from './types.js';
declare module '@deepseek-ai/dsh-jobs' {
    interface JobKindMap {
        'zotero-enrichment': 'zotero-enrichment';
    }
}
export declare const PARSE_JOB_KIND = "zotero-enrichment";
export declare const PARSE_JOB_LABEL = "\u6587\u6863\u89E3\u6790 \u00B7 MinerU";
/**
 * One completion-notice waiter's lifetime, and the cadence at which its
 * successor is armed. These are slices, not job bounds: a queued reparse waits
 * for its lane predecessor, downloads its source, and parses, so the job can
 * outlive any single wait. A successor is armed while the current waiter is
 * still live, so at least one waiter is registered for the job's whole actual
 * lifetime.
 */
export declare const PARSE_NOTICE_WAIT_MS: number;
export declare const PARSE_NOTICE_REARM_MS: number;
export declare const PARSE_CANCELLED_MESSAGE = "Document parsing was cancelled.";
export declare const PARSE_FAILED_MESSAGE = "Document parsing failed. Retry the operation to resume its generation.";
/** Real phase labels for the jobs roster; no invented percentages. */
export declare const PARSE_JOB_PHASES: Readonly<Record<ParsePhase, string>>;
export type ParseJobPhase = ParsePhase;
type ReceiptState = ZoteroDocumentParseReceiptResultView;
/** Only hashes and bounded public receipts cross this durable boundary. */
export interface ParseJobRecord {
    readonly version: 1;
    readonly owner: string;
    readonly operationId: string;
    readonly binding: string;
    readonly action: 'parse' | 'reparse';
    readonly generation: string;
    readonly jobId: string;
    readonly state: ReceiptState;
}
export interface ParseJobPersistence {
    get(config: EnrichmentPreferences, owner: string, operationId: string): Promise<ParseJobRecord | undefined>;
    put(config: EnrichmentPreferences, record: ParseJobRecord): Promise<void>;
    generation(config: EnrichmentPreferences, source: string): Promise<string | undefined>;
    putGeneration(config: EnrichmentPreferences, source: string, generation: string): Promise<void>;
    /** Remove every receipt and generation file bound to one parse generation. */
    deleteByGeneration(config: EnrichmentPreferences, generation: string): Promise<number>;
}
/** Receipts survive service remounts. The root resolver must validate the snapshot directory. */
export declare class DiskParseJobPersistence implements ParseJobPersistence {
    private readonly root;
    constructor(root: (config: EnrichmentPreferences, create: boolean) => Promise<string>);
    private directory;
    private read;
    /** One receipt read against an already validated directory, so a scan validates once. */
    private readAt;
    private write;
    get(config: EnrichmentPreferences, owner: string, operationId: string): Promise<ParseJobRecord | undefined>;
    put(config: EnrichmentPreferences, record: ParseJobRecord): Promise<void>;
    generation(config: EnrichmentPreferences, source: string): Promise<string | undefined>;
    putGeneration(config: EnrichmentPreferences, source: string, generation: string): Promise<void>;
    deleteByGeneration(config: EnrichmentPreferences, generation: string): Promise<number>;
}
export interface ParseJobExecution {
    readonly input: ParseSourceInput;
    readonly config: EnrichmentPreferences;
    readonly generation: string;
    readonly signal: AbortSignal;
    readonly onProgress: (phase: ParseJobPhase) => void;
}
export interface EnrichmentParseJobsDeps {
    readonly config: () => EnrichmentPreferences;
    readonly resolveAttachment: ParseAttachmentResolver;
    /** Read-only store for opaque artifact targets and management listings. */
    readonly store: (config: EnrichmentPreferences) => Promise<ParsedArtifactStore>;
    /** Must settle after its own resources and shared ParseFlight waiter have been released. */
    readonly execute: (request: ParseJobExecution) => Promise<ParseDocumentResult>;
    readonly displayCandidate: (input: ParseSourceInput, config: EnrichmentPreferences, signal: AbortSignal, targetLabel: string, 
    /** Pre-resolved for artifact targets, so the candidate skips its index lookup. */
    record?: SourceIndexRecord) => Promise<DisplayArtifactLookup>;
    /** Lease-free metadata for the parsed-tab title; never resolves an attachment. */
    readonly metadata: (config: EnrichmentPreferences, request: Extract<ZoteroDocumentArtifactRequestView, {
        op: 'meta';
    }>, signal: AbortSignal) => Promise<{
        readonly metadata: ZoteroArtifactMetadataView;
    } | {
        readonly kind: 'missing';
    }>;
    /** One freshness probe per visible attachment row, from a single index snapshot. */
    readonly probe: (config: EnrichmentPreferences, request: Extract<ZoteroDocumentArtifactRequestView, {
        op: 'probe';
    }>, signal: AbortSignal) => Promise<Extract<ZoteroDocumentArtifactResultView, {
        kind: 'probed';
    }>>;
    readonly persistence: ParseJobPersistence;
}
/** No tools are dispatched. Jobs are admitted against a live session and the real registry. */
export declare class EnrichmentParseJobs {
    private readonly ctx;
    private readonly deps;
    private readonly reads;
    private closed;
    private disposal;
    private readonly operations;
    private readonly owned;
    private readonly admissions;
    private readonly shared;
    private readonly tails;
    private readonly generations;
    constructor(ctx: Context, deps: EnrichmentParseJobsDeps);
    private open;
    private authorize;
    private config;
    private expand;
    /** Drop in-memory job state bound to one artifact generation. */
    forgetGeneration(generation: string): void;
    /** Invalidate open document leases bound to one artifact. */
    retireArtifact(artifactId: string): void;
    /** Session-only authorization for the management endpoints. */
    authorizeManagement(sessionId: string, method: string, currentCtx?: Context): void;
    private owner;
    startDocumentParse(input: ZoteroStartDocumentParseRequestView, signal: AbortSignal, currentCtx?: Context): Promise<ZoteroStartDocumentParseResultView>;
    private admit;
    /**
     * Keep this panel-owned job's completion out of the agent inbox.
     *
     * The harness announces every settled owned job to its session and wakes an
     * idle agent with a follow-up turn. That notice is meant for work the model
     * started: a panel parse has no user request behind it, and `job_output`
     * returns only the receipt, so the wake spends a turn hunting a host artifact
     * it cannot read. A settlement that released a live `wait` is reported as
     * already delivered (`awaited`), which the completion reporter skips, so the
     * host — the actual owner of the receipt — holds a waiter for as long as the
     * job runs.
     *
     * A single bounded wait cannot cover the job: a queued reparse waits on its
     * lane predecessor and then downloads and parses, so the job lifetime has no
     * constant upper bound. Successors are therefore armed while their
     * predecessor is still live (`PARSE_NOTICE_REARM_MS < PARSE_NOTICE_WAIT_MS`).
     * Node runs due timers in expiry order and drains microtasks between
     * callbacks, so a successor overdue with its predecessor still registers
     * first; every settlement therefore releases at least one waiter. The steady
     * state is two waiters and one interval, and settlement clears both.
     *
     * The settled record itself stays in place: the panel reads its terminal row
     * to fetch the receipt, and removing it would strand the dialog.
     */
    private holdNotice;
    private reserve;
    /** An independent waiter leaves synchronously; the last one awaits real shared cleanup. */
    private wait;
    private receipt;
    documentArtifact(input: ZoteroDocumentArtifactRequestView, signal: AbortSignal, currentCtx?: Context): Promise<ZoteroDocumentArtifactResultView>;
    documentParseReceipt(input: ZoteroDocumentParseReceiptRequestView, signal: AbortSignal, currentCtx?: Context): Promise<ZoteroDocumentParseReceiptResultView>;
    private trimTerminal;
    /** Stop admission synchronously, abort owned waiters, and wait for their actual cleanup. */
    dispose(): Promise<void>;
}
export {};
//# sourceMappingURL=parse-jobs.d.ts.map