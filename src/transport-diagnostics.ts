/**
 * One failure classifier for the two HTTP transports (read and write), so
 * identical failures grade identically no matter which transport carried
 * them: a caller abort is routine (debug), the provider deadline is the
 * classic "Zotero did not answer" diagnosis (warn), and any other refusal
 * is an error. The error's stable code rides the detail when it has one.
 * @module dsh-zotero/transport-diagnostics
 */

import type { DiagnosticDetail, DiagnosticSink } from './diagnostics.js'
import { ZOTERO_TIMEOUT, ZoteroError } from './errors.js'

/** The event names one transport grades its failures under. */
export interface TransportFailureEvents {
  readonly abort: string
  readonly timeout: string
  readonly failure: string
}

/**
 * Record one failed transport exchange.
 * @param sink - the transport's diagnostics sink; undefined means silently unobserved.
 * @param events - the transport's abort/timeout/failure event names.
 * @param target - one-line name of the exchange (`GET users/0/items`), without a query string; the debug request line is the only event that quotes one.
 * @param startedAt - `Date.now()` captured when the exchange began.
 * @param error - the thrown failure, untranslated.
 * @param signal - the caller's abort signal, when one was supplied.
 */
export function logTransportFailure(
  sink: DiagnosticSink | undefined,
  events: TransportFailureEvents,
  target: string,
  startedAt: number,
  error: unknown,
  signal: AbortSignal | undefined,
): void {
  if (sink === undefined) return
  const detail: DiagnosticDetail = { ms: Date.now() - startedAt }
  if (signal?.aborted) {
    sink.debug(events.abort, target, detail)
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  const code = error instanceof ZoteroError ? error.code : undefined
  const withCode: DiagnosticDetail = code === undefined ? detail : { ...detail, errorCode: code }
  if (code === ZOTERO_TIMEOUT) {
    sink.warn(events.timeout, `${target}: ${message}`, withCode)
    return
  }
  sink.error(events.failure, `${target}: ${message}`, withCode)
}
