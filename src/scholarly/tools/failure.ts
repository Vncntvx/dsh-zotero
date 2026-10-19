/**
 * One-line failure description shared by the scholarly tools.
 *
 * A transport failure must never read as "the index holds no such work". A
 * rate limit, a timeout, or an open circuit says nothing about existence, the
 * same distinction `scholarly_verify` draws between `unverified` and
 * `not_found`. Every tool that fans out over indexes funnels its failures
 * through here, so the wording cannot drift between them.
 * @module dsh-zotero/scholarly/tools/failure
 */

import { errorMessageOf } from '../../errors.js'
import { httpStatusOf } from '../transport/http.js'

/**
 * Format one registry-read rejection for a model-facing notice.
 *
 * A `ScholarlyHttpError` spells out `HTTP <status> from <host>` for every
 * status except 429, whose message reads `Rate limited by <host> (retry after
 * Ns)`, because an operator has to recognize a rate limit without knowing the
 * number. The status is prefixed only when the message does not already carry
 * it, so the note never reads as `HTTP 404 — HTTP 404 from host`.
 * @param error - the rejection from a registry read.
 * @returns a single-line description.
 */
export function failureTextOf(error: unknown): string {
  const message = errorMessageOf(error)
  const status = httpStatusOf(error)
  return status !== undefined && !message.includes(String(status))
    ? `HTTP ${status} — ${message}`
    : message
}
