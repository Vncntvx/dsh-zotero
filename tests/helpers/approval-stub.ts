/**
 * The approval seam the write-path lanes compose: one configurable stub in
 * one home. The write gate fails closed without a composed approval service,
 * so every lane exercising the layers behind it registers this seam. The
 * ledger and the scripted outcome are module state, reset per case through
 * {@link resetApprovalStub}.
 * @module tests/helpers/approval-stub
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { Options } from '../../src/config.js'
import { setupHostLane, type HostLane } from './lanes/host-lane.js'

/** The request fields the write lanes inspect; the real seam carries more. */
export interface ApprovalAsk {
  readonly toolName?: string
  readonly callId?: unknown
  readonly reason?: string
  readonly displayReason?: { readonly en: string; readonly zh: string }
}

/** Every approval request the stub received, in order. */
export const approvalAsks: ApprovalAsk[] = []

/** The outcome the next request answers with; `allowed-once` grants once. */
let approvalOutcome: ApprovalOutcome = 'allowed-once'

/**
 * Answer every request with this outcome until the next reset.
 * @param outcome - the settlement the lane under test should observe.
 */
export function setApprovalOutcome(outcome: ApprovalOutcome): void {
  approvalOutcome = outcome
}

/** Clear the ledger and restore the grant-once default. */
export function resetApprovalStub(): void {
  approvalAsks.length = 0
  approvalOutcome = 'allowed-once'
}

/** The smallest approval seam the gate can find: records the ask, answers the scripted outcome. */
export class StubApproval extends Service {
  constructor(ctx: Context) {
    super(ctx, 'approval')
  }

  async request(request: ApprovalAsk): Promise<ApprovalOutcome> {
    approvalAsks.push(request)
    return approvalOutcome
  }
}

/** A host lane carrying the approval stub, for the write-path cases. */
export async function approvalLane(config: Options): Promise<HostLane> {
  return await setupHostLane(config, {
    compose: async (ctx) => {
      await ctx.plugin(StubApproval)
    },
  })
}
