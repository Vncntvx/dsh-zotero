/**
 * Timing and size constants for the MinerU parsing component.
 *
 * The transport's per-request default is far too short for the precise API's
 * advertised sizes (200 MB PDFs, 200 MB result archives), so every parsing
 * request states its own phase budget. The poll window and the total window
 * are deliberately the same length: a fixed poll count that expires before the
 * total deadline made the outer deadline unreachable in practice.
 * @module dsh-zotero/parsing/limits
 */

/** The whole submit → upload → poll → download → store body. */
export const PARSE_TOTAL_TIMEOUT_MS = 30 * 60_000

/** Poll cadence and the number of polls the total window can hold. */
export const POLL_INTERVAL_MS = 2_000
export const MAX_POLLS = Math.floor(PARSE_TOTAL_TIMEOUT_MS / POLL_INTERVAL_MS)

/** Small JSON calls: submit and one poll. */
export const SUBMIT_TIMEOUT_MS = 60_000
export const POLL_TIMEOUT_MS = 60_000

/** Large transfers: the signed upload and the result/markdown download. */
export const UPLOAD_TIMEOUT_MS = 20 * 60_000
export const RESULT_TIMEOUT_MS = 10 * 60_000

/** A public URL PDF downloaded as the source of a parse. */
export const SOURCE_TRANSFER_TIMEOUT_MS = 20 * 60_000

/** One HEAD revalidation of a cached URL source. */
export const HEAD_TIMEOUT_MS = 15_000
