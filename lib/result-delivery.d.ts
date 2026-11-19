import { receiptSchema, type DeliveredResult } from './result-contract.js';
export { fileSchema, receiptSchema, isFileAttachmentRef } from './result-contract.js';
/**
 * Complete tool values backed by standard Harness attachments and durable receipts.
 * The spill-policy preview cannot replace this envelope: browsers download its
 * versioned JSON, nested calls forward its FileBlock, and job_output reattaches
 * it after restart. Both paths use the harness token estimator; optional
 * whole-document text spills remain owned by spill.ts.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import { z } from 'zod';
import type { ResolvedConfig } from './config.js';
import type { DiagnosticSink } from './diagnostics.js';
/** A broken producer cannot hold plugin teardown forever. */
export declare const RESULT_DELIVERY_DRAIN_MS = 5000;
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'ptc-mode': {
            kind: 'ptc-mode';
        };
    }
}
/** Opaque path-safe keys work with every official storageDomain backend. */
export declare function resultReceiptKey(...coordinates: string[]): Promise<string>;
type Receipt = z.infer<typeof receiptSchema>;
export type { DeliveredResult } from './result-contract.js';
/** A registration transform applied to one tool definition before it is registered. */
export type ToolWrapper = (definition: ToolDefinition) => ToolDefinition;
/** The pass-through wrapper for registrations that need no delivery envelope. */
export declare const identityToolWrapper: ToolWrapper;
/** JSON encoder with bounded string chunks, including pathological single-line fields. */
export declare function jsonBytes(value: unknown, signal?: AbortSignal): AsyncGenerator<Uint8Array>;
/**
 * Count an inline result's bytes and recover its canonical text in one pass.
 *
 * `jsonBytes` is the only encoder: decoding each chunk with a streaming
 * `TextDecoder` rebuilds exactly the text that encoder emitted, so the caller
 * no longer pays for a second `JSON.stringify` of the same object. A chunk may
 * split a multi-byte UTF-8 sequence, which is why the decoder stays open until
 * the final `decode()`; `jsonBytes` additionally avoids splitting surrogate
 * pairs. Returning `undefined` at the first chunk past `limit` preserves the
 * original early-exit behaviour (including the generator's cleanup).
 *
 * The value must be JSON-shaped (`JsonValue`): encoder and `JSON.stringify`
 * agree on strings, arrays, plain objects, skipped `undefined` properties and
 * non-finite numbers, but not on `toJSON()` hosts such as `Date` or BigInt.
 * @param value - the object to encode.
 * @param limit - maximum byte length before the inline branch gives up.
 * @param signal - cancellation carried into every encoded chunk.
 * @returns byte count and canonical text, or undefined when over the limit.
 */
export declare function inlineJson(value: unknown, limit: number, signal?: AbortSignal): Promise<{
    bytes: number;
    canonical: string;
} | undefined>;
export declare function isDelivered(value: unknown): value is DeliveredResult;
export declare function renderDelivered(value: DeliveredResult, render: (value: JsonValue) => ContentBlock[]): ContentBlock[];
export declare class ResultDelivery {
    private readonly ctx;
    private readonly config;
    private readonly diagnostics?;
    private facility?;
    private domain?;
    private readonly domains;
    private stopping;
    private committing;
    private readonly pending;
    private readonly outputs;
    /**
     * One publication per owning call. A foreground settle and a promotion can
     * both reach the same call after a timeout; deduplicating in flight keeps
     * them from streaming the same body twice.
     */
    private readonly publishing;
    constructor(ctx: Context, config: () => ResolvedConfig, diagnostics?: DiagnosticSink | undefined);
    track<T>(promise: Promise<T>): Promise<T>;
    private receipts;
    prepare(exec: ToolExecution, data: JsonValue, render: (value: JsonValue) => ContentBlock[], signal: AbortSignal, jobId?: string, facts?: JsonValue): Promise<DeliveredResult>;
    private assertActive;
    private publish;
    wrap(definition: ToolDefinition): ToolDefinition;
    receipt(sessionId: string, callId: string): Promise<Receipt | undefined>;
    /** FIFO retention counts deliveries, keeping their call and job aliases together. */
    pruneReceipts(sessionId: string, max?: number): Promise<number>;
    private pruneTable;
    installJobs(): void;
}
//# sourceMappingURL=result-delivery.d.ts.map