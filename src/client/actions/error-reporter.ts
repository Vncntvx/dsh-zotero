/**
 * Client-crash reporting for the browser half.
 *
 * Two reporters cover two disjoint crash sets, and the split is structural:
 * a React class boundary contains a throw at the nearest boundary above the
 * throw site, so a crash the plugin's own render boundaries contain
 * (`ZoteroCardBoundary`, `ZoteroSurfaceBoundary`) never reaches the harness's
 * `SlotErrorBoundary` — they sit *inside* it — and a crash that does reach it
 * (an `inject` factory throw, or a throw in a surface with no boundary of its
 * own) is never seen by the plugin boundaries.
 *
 * - The render boundaries report what they contain, through the module-level
 *   reporter binding set at registration time. A class component mounted by
 *   the slot renderer is handed no face of its own, so a module binding is the
 *   only channel that reaches the gateway without threading a prop through the
 *   renderer; the attachment resolver takes the same shape.
 * - The slot intake (`src/client/index.ts`) reports what the boundaries cannot
 *   see, subscribing to `ctx.slots.onEntryError` — the registry's own
 *   supervision seam, which fires for a render throw and an `inject` factory
 *   throw, for ordinary Slots and Factory occurrences alike — and passing the
 *   reporter explicitly rather than reading the binding.
 * @module dsh-zotero/client/actions/error-reporter
 */

import type { ZoteroClientErrorReport } from '../../contract.ts'
import { messageOf } from '../error-text.ts'

/**
 * What a reporter knows about one crash, beyond the throw itself.
 *
 * Two shapes, one union: a boundary hands over React's component stack, and the
 * supervision seam hands over whether the report retired the entry from its
 * cell. Kept discriminated so the reporter never probes an unknown object's
 * keys at runtime.
 */
type CrashInfo =
  | { readonly kind: 'componentStack'; readonly componentStack?: string | null }
  | { readonly kind: 'slotEntry'; readonly abdicated: boolean }

type ErrorReporter = (report: ZoteroClientErrorReport) => Promise<unknown>

let activeReporter: ErrorReporter | undefined

export function setErrorReporter(reporter: ErrorReporter | undefined): void {
  activeReporter = reporter
}

export function getErrorReporter(): ErrorReporter | undefined {
  return activeReporter
}

/**
 * The component-stack line filed for a crash that retired its entry. Spelled
 * here so the spec asserts the constant the reporter writes, not a copy of it.
 */
export const RETIRED_ENTRY = 'slot entry retired after crash (abdicated)'

/**
 * Report one crashed surface or slot entry into the host diagnostics ring.
 *
 * Fire-and-forget: the boundary or renderer has already contained the crash, so
 * a rejected report must never become a second failure.
 * @param surface - the crashed surface: a SlotMap key, `factory:<name>`, `tool:<name>`, or `root`.
 * @param error - the thrown value.
 * @param info - React's component stack (a boundary catch) or the seam's abdication fact.
 * @param reporter - the gateway to file through; the slot intake passes the one
 *   its fiber was handed, while a boundary omits it and reads the registration
 *   binding. One argument, both callers: the boundary has no other channel.
 */
export function reportCrashedSurface(
  surface: string,
  error: unknown,
  info?: CrashInfo,
  reporter?: ErrorReporter,
): void {
  const targetReporter = reporter ?? getErrorReporter()
  if (targetReporter === undefined) return
  // The intake's wire contract requires a non-empty message, so the report goes
  // through the same first-line fallback the boundaries' console lines use, with
  // one final placeholder for a literally empty thrown string, since
  // `throw ''` would file a report the host silently refuses.
  const message = messageOf(error) || 'unknown failure'
  const componentStack =
    info === undefined
      ? undefined
      : info.kind === 'slotEntry' && info.abdicated
        ? RETIRED_ENTRY
        : info.kind === 'componentStack' && typeof info.componentStack === 'string'
          ? info.componentStack
          : undefined
  const report: ZoteroClientErrorReport = {
    surface,
    message,
    ...(error instanceof Error && error.stack !== undefined ? { stack: error.stack } : {}),
    ...(componentStack === undefined ? {} : { componentStack }),
  }
  void targetReporter(report).catch(() => {
    // Unreachable through the gateway (it folds failures into ok:false), but a
    // rejected intake must never become a second render failure.
  })
}
