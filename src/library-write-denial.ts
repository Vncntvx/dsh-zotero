/**
 * The one adapter for the harness's approval-refusal results.
 *
 * `packages/core/tools/src/pipeline.ts` `serviceAsk` materializes a non-granted
 * approval as `error.info = { name: 'ApprovalError', code }`, and
 * `packages/core/tools/src/error-codes.ts` fixes the three possible codes:
 * `APPROVAL_REJECTED`, `APPROVAL_CANCELLED`, and `APPROVAL_UNAVAILABLE`. Only
 * the first two mean the user ended the plan review; `APPROVAL_UNAVAILABLE`
 * means no approval channel could answer, which is a failure to ask rather
 * than a decision. The denial sentence in `error.message` is model-facing
 * prose, so this module never reads it.
 * @module src/library-write-denial
 */
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'

/** The `error.info.name` the harness sets on every approval denial. */
export const HARNESS_DENIAL_NAME = 'ApprovalError'

/**
 * Approval codes that mean the user, not the system, ended the review.
 * `APPROVAL_UNAVAILABLE` is deliberately absent: an absent approval channel
 * is never a user decision.
 */
export const HARNESS_DENIAL_CODES = ['APPROVAL_REJECTED', 'APPROVAL_CANCELLED'] as const

export type HarnessDenialCode = (typeof HARNESS_DENIAL_CODES)[number]

/**
 * Classify one tool execution result as a user decline or a real failure.
 * A decline is proven only by the harness's structured approval identity: a
 * gateway error that happens to quote a refusal sentence stays `failed`,
 * because prose does not carry the harness's own decision.
 * @param result - the settled tool result from `ctx.tools.execute`.
 * @returns `'declined'` only for a structured approval denial by the user.
 */
export function classifyDenial(result: ToolExecutionResult): 'declined' | 'failed' {
  if (!result.isError) return 'failed'
  const info = result.error.info
  if (info === undefined || info.name !== HARNESS_DENIAL_NAME) return 'failed'
  return HARNESS_DENIAL_CODES.some((code) => code === info.code) ? 'declined' : 'failed'
}
