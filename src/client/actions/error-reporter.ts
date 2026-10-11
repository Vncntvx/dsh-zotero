/**
 * Shared client-error reporter for the render boundaries.
 * Configured during plugin UI registration from `ctx.remote.zotero`.
 *
 * The boundaries that catch a crashed surface are class components mounted by
 * the slot renderer, which hands them no face of their own. A module binding
 * set at registration time is the only channel that reaches every surface
 * (Sources tab, tool cards, detail section) without threading a prop through
 * the slot renderer; the attachment resolver takes the same shape.
 * @module dsh-zotero/client/actions/error-reporter
 */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroClientErrorReport, ZoteroReportResultView } from '../../contract.ts'
import { messageOf } from '../error-text.ts'

export type ErrorReporter = (
  report: ZoteroClientErrorReport,
) => Promise<RemoteResult<ZoteroReportResultView>>

let activeReporter: ErrorReporter | undefined

export function setErrorReporter(reporter: ErrorReporter | undefined): void {
  activeReporter = reporter
}

export function getErrorReporter(): ErrorReporter | undefined {
  return activeReporter
}

/**
 * Report one crashed surface when a reporter is wired. Fire-and-forget: the
 * boundary has already rendered its fallback, so a rejected report must not
 * produce a second failure.
 * @param surface - which UI surface crashed (e.g. `sources`, `tool:zotero_search`).
 * @param error - the thrown value.
 * @param info - React's component stack, when the boundary has one.
 */
export function reportCrashedSurface(
  surface: string,
  error: unknown,
  info?: { componentStack?: string | null },
): void {
  const reporter = getErrorReporter()
  if (reporter === undefined) return
  // The intake's wire contract requires a non-empty message, so the report
  // goes through the same first-line fallback the boundary's console line
  // uses, with one final placeholder for a literally empty thrown string;
  // otherwise `throw ''` would file a report the host silently refuses.
  const message = messageOf(error) || 'unknown failure'
  void reporter({
    surface,
    message,
    ...(error instanceof Error && error.stack !== undefined ? { stack: error.stack } : {}),
    ...(info?.componentStack ? { componentStack: info.componentStack } : {}),
  }).catch(() => {
    // Unreachable via the gateway (it folds failures into ok:false), but a
    // rejected intake must never become a second render failure.
  })
}
