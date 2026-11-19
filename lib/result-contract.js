/** Complete result file receipts shared across host publication and browser tests. */
import { z } from 'zod';
/**
 * The one file-attachment shape both the delivery writer and the result read
 * route accept: the delivery persists receipts shaped by this schema, and the
 * read route narrows event payloads through the same definition, so the two
 * ends cannot drift apart on what counts as a readable attachment.
 */
export const fileSchema = z
    .object({
    attachmentId: z.string().min(1),
    name: z.string().min(1),
    bytes: z.number().int().nonnegative(),
})
    .strict();
/** Narrow an unknown block payload to the FileAttachmentRef the delivery writes. */
export function isFileAttachmentRef(value) {
    return fileSchema.safeParse(value).success;
}
export const receiptSchema = z
    .object({
    delivery: z.literal('file'),
    version: z.literal(1),
    tool: z.string().max(64),
    sessionId: z.string().min(1),
    callId: z.string().min(1),
    jobId: z.string().optional(),
    summary: z.string().max(256),
    createdAt: z.number().int().nonnegative(),
    file: fileSchema,
    facts: z.record(z.string(), z.json()).optional(),
})
    .strict();
//# sourceMappingURL=result-contract.js.map