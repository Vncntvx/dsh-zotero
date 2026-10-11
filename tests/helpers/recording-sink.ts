/**
 * A diagnostics sink that records every line it is offered, for assertions in
 * the transport specs (read and write).
 * @module tests/helpers/recording-sink
 */

import type { DiagnosticDetail, DiagnosticLevel, DiagnosticSink } from '../../src/diagnostics.js'

/** One line the sink was handed, in arrival order. */
export interface RecordedLine {
  readonly level: DiagnosticLevel
  readonly event: string
  readonly message: string
  readonly detail?: DiagnosticDetail
}

/** @returns the sink and the lines it has recorded so far. */
export function recordingSink(): { sink: DiagnosticSink; lines: RecordedLine[] } {
  const lines: RecordedLine[] = []
  const push =
    (level: DiagnosticLevel) =>
    (event: string, message: string, detail?: DiagnosticDetail): void => {
      lines.push({ level, event, message, ...(detail === undefined ? {} : { detail }) })
    }
  return {
    sink: { debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') },
    lines,
  }
}
