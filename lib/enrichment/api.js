/** Runtime contracts for the two MinerU APIs. @module dsh-zotero/enrichment/api */
import { z } from 'zod';
import { ZoteroError, ZOTERO_ENRICHMENT_TASK_FAILED } from '../errors.js';
import { sanitizedErrorDetail } from './transport.js';
const text = z.string().trim().min(1);
const identifier = text.max(128).regex(/^[A-Za-z0-9_.-]+$/);
const address = text.refine((value) => {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password;
    }
    catch {
        return false;
    }
}, 'expected a credential-free HTTPS URL');
// Unfinished tasks may carry empty/null output fields. A done state still
// requires its concrete URL in the orchestrator before any download occurs.
const outputAddress = z.preprocess((value) => (value === '' || value === null ? undefined : value), address.optional());
const optionalMessage = z.string().nullable().optional();
const envelope = z.object({
    code: z.union([z.number().int(), text]),
    msg: z.string().optional(),
    trace_id: identifier.optional(),
    data: z.unknown().optional(),
});
/** Preserve support identifiers while keeping untrusted details bounded. */
export class MineruApiError extends ZoteroError {
    apiCode;
    traceId;
    taskId;
    terminal;
    constructor(message, apiCode, traceId, taskId, terminal = false) {
        const detail = sanitizedErrorDetail(message) ?? 'MinerU request failed';
        super(`${detail}${apiCode === undefined ? '' : ` (MinerU ${apiCode})`}${traceId === undefined ? '' : ` [trace ${traceId}]`}${taskId === undefined ? '' : ` [task ${taskId}]`}`, ZOTERO_ENRICHMENT_TASK_FAILED);
        this.apiCode = apiCode;
        this.traceId = traceId;
        this.taskId = taskId;
        this.terminal = terminal;
    }
    get retryable() {
        return [-10001, -60007, -60009].includes(Number(this.apiCode));
    }
}
export function responseWithData(value, schema, phase, taskId) {
    const parsed = envelope.safeParse(value);
    if (!parsed.success)
        throw new MineruApiError(`MinerU ${phase}: invalid response envelope`, undefined, undefined, taskId);
    const response = parsed.data;
    if (response.code !== 0)
        throw new MineruApiError(`MinerU ${phase}: ${response.msg || 'request rejected'}`, response.code, response.trace_id, taskId, taskId !== undefined && Number(response.code) === -60012);
    const data = schema.safeParse(response.data);
    if (!data.success) {
        const paths = data.error.issues.map((issue) => issue.path.join('.') || 'data').join(', ');
        throw new MineruApiError(`MinerU ${phase}: invalid response fields (${paths})`, undefined, response.trace_id, taskId);
    }
    return {
        data: data.data,
        ...(response.trace_id !== undefined ? { traceId: response.trace_id } : {}),
    };
}
export function responseData(value, schema, phase) {
    return responseWithData(value, schema, phase).data;
}
export const freeSubmit = z.object({ task_id: identifier, file_url: address });
export const proSubmit = z.object({ batch_id: identifier, file_urls: z.array(address).length(1) });
const progress = z.object({
    total_pages: z.number().int().positive(),
    extracted_pages: z.number().int().nonnegative().optional(),
});
export const freeStatus = z.object({
    task_id: identifier,
    state: z.enum(['waiting-file', 'uploading', 'pending', 'running', 'done', 'failed']),
    markdown_url: outputAddress,
    err_msg: optionalMessage,
    err_code: z.number().int().nullable().optional(),
});
export const proStatus = z.object({
    batch_id: identifier,
    extract_result: z
        .array(z.object({
        file_name: text,
        state: z.enum(['waiting-file', 'pending', 'running', 'converting', 'done', 'failed']),
        full_zip_url: outputAddress,
        err_msg: optionalMessage,
        extract_progress: progress.nullable().optional(),
    }))
        .max(1),
});
//# sourceMappingURL=api.js.map