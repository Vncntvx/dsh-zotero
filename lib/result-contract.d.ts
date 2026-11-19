/** Complete result file receipts shared across host publication and browser tests. */
import { z } from 'zod';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
type FileAttachmentRef = Extract<ContentBlock, {
    type: 'file';
}>['attachment'];
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
export declare const receiptSchema: z.ZodObject<{
    delivery: z.ZodLiteral<"file">;
    version: z.ZodLiteral<1>;
    tool: z.ZodString;
    sessionId: z.ZodString;
    callId: z.ZodString;
    jobId: z.ZodOptional<z.ZodString>;
    summary: z.ZodString;
    createdAt: z.ZodNumber;
    file: z.ZodObject<{
        attachmentId: z.ZodString;
        name: z.ZodString;
        bytes: z.ZodNumber;
    }, z.core.$strict>;
    facts: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
}, z.core.$strict>;
export type DeliveredResult = {
    delivery: 'inline';
    data: JsonValue;
} | z.infer<typeof receiptSchema>;
export {};
//# sourceMappingURL=result-contract.d.ts.map