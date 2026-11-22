/** Runtime contracts for the two MinerU APIs. @module dsh-zotero/enrichment/api */
import { z } from 'zod';
import { ZoteroError } from '../errors.js';
/** Preserve support identifiers while keeping untrusted details bounded. */
export declare class MineruApiError extends ZoteroError {
    readonly apiCode?: string | number | undefined;
    readonly traceId?: string | undefined;
    readonly taskId?: string | undefined;
    readonly terminal: boolean;
    constructor(message: string, apiCode?: string | number | undefined, traceId?: string | undefined, taskId?: string | undefined, terminal?: boolean);
    get retryable(): boolean;
}
export declare function responseWithData<T>(value: unknown, schema: z.ZodType<T>, phase: string, taskId?: string): {
    data: T;
    traceId?: string;
};
export declare function responseData<T>(value: unknown, schema: z.ZodType<T>, phase: string): T;
export declare const freeSubmit: z.ZodObject<{
    task_id: z.ZodString;
    file_url: z.ZodString;
}, z.core.$strip>;
export declare const proSubmit: z.ZodObject<{
    batch_id: z.ZodString;
    file_urls: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export declare const freeStatus: z.ZodObject<{
    task_id: z.ZodString;
    state: z.ZodEnum<{
        done: "done";
        failed: "failed";
        pending: "pending";
        running: "running";
        uploading: "uploading";
        "waiting-file": "waiting-file";
    }>;
    markdown_url: z.ZodPreprocess<z.ZodOptional<z.ZodString>, unknown>;
    err_msg: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    err_code: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, z.core.$strip>;
export declare const proStatus: z.ZodObject<{
    batch_id: z.ZodString;
    extract_result: z.ZodArray<z.ZodObject<{
        file_name: z.ZodString;
        state: z.ZodEnum<{
            converting: "converting";
            done: "done";
            failed: "failed";
            pending: "pending";
            running: "running";
            "waiting-file": "waiting-file";
        }>;
        full_zip_url: z.ZodPreprocess<z.ZodOptional<z.ZodString>, unknown>;
        err_msg: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        extract_progress: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            total_pages: z.ZodNumber;
            extracted_pages: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
//# sourceMappingURL=api.d.ts.map