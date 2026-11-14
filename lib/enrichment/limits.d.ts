/**
 * Timing and size constants for the MinerU parsing component.
 *
 * The transport's per-request default is far too short for the precise API's
 * advertised sizes (200 MB PDFs, 200 MB result archives), so every enrichment
 * request states its own phase budget. The poll window and the total window
 * are deliberately the same length: a fixed poll count that expires before the
 * total deadline made the outer deadline unreachable in practice.
 * @module dsh-zotero/enrichment/limits
 */
/** The whole submit → upload → poll → download → store body. */
export declare const PARSE_TOTAL_TIMEOUT_MS: number;
/** Poll cadence and the number of polls the total window can hold. */
export declare const POLL_INTERVAL_MS = 2000;
export declare const MAX_POLLS: number;
/** Small JSON calls: submit and one poll. */
export declare const SUBMIT_TIMEOUT_MS = 60000;
export declare const POLL_TIMEOUT_MS = 60000;
/** Large transfers: the signed upload and the result/markdown download. */
export declare const UPLOAD_TIMEOUT_MS: number;
export declare const RESULT_TIMEOUT_MS: number;
/** A public URL PDF downloaded as the source of a parse. */
export declare const SOURCE_TRANSFER_TIMEOUT_MS: number;
/** One HEAD revalidation of a cached URL source. */
export declare const HEAD_TIMEOUT_MS = 15000;
//# sourceMappingURL=limits.d.ts.map