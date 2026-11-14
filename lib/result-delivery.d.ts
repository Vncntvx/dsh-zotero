/** Bounded tool values backed by immutable Harness files and durable receipts. */
import type { Context } from '@deepseek-ai/cordis';
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import { z } from 'zod';
import type { ResolvedConfig } from './config.js';
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'ptc-mode': {
            kind: 'ptc-mode';
        };
    }
}
/** Opaque path-safe keys work with every official storageDomain backend. */
export declare function resultReceiptKey(...coordinates: string[]): Promise<string>;
/**
 * The one file-attachment shape both the delivery writer and the result read
 * route accept: the delivery persists receipts shaped by this schema, and the
 * read route narrows event payloads through the same definition, so the two
 * ends cannot drift apart on what counts as a readable attachment.
 */
export declare const fileSchema: z.ZodObject<{
    attachmentId: z.ZodString;
    name: z.ZodString;
    bytes: z.ZodNumber;
}, z.core.$strict>;
/** Narrow an unknown block payload to the FileAttachmentRef the delivery writes. */
export declare function isFileAttachmentRef(value: unknown): value is FileAttachmentRef;
declare const receiptSchema: z.ZodObject<{
    delivery: z.ZodLiteral<"file">;
    version: z.ZodLiteral<1>;
    tool: z.ZodString;
    sessionId: z.ZodString;
    callId: z.ZodString;
    jobId: z.ZodOptional<z.ZodString>;
    summary: z.ZodString;
    file: z.ZodObject<{
        attachmentId: z.ZodString;
        name: z.ZodString;
        bytes: z.ZodNumber;
    }, z.core.$strict>;
    facts: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
}, z.core.$strict>;
type Receipt = z.infer<typeof receiptSchema>;
export type DeliveredResult = {
    delivery: 'inline';
    data: JsonValue;
} | Receipt;
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
    private facility?;
    private domain?;
    private readonly pending;
    private readonly outputs;
    /**
     * One publication per owning call. A foreground settle and a promotion can
     * both reach the same call after a timeout; deduplicating in flight keeps
     * them from streaming the same body twice.
     */
    private readonly publishing;
    constructor(ctx: Context, config: () => ResolvedConfig);
    track<T>(promise: Promise<T>): Promise<T>;
    private receipts;
    prepare(exec: ToolExecution, data: JsonValue, render: (value: JsonValue) => ContentBlock[], signal: AbortSignal, jobId?: string, facts?: JsonValue): Promise<DeliveredResult>;
    private publish;
    wrap(definition: ToolDefinition): ToolDefinition;
    receipt(sessionId: string, callId: string): Promise<Receipt | undefined>;
    installJobs(): void;
}
export {};
//# sourceMappingURL=result-delivery.d.ts.map