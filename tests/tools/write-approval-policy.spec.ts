/**
 * The session approval-policy gate that runs before any write plan card.
 *
 * `requestWriteApproval` is the deployment-level door: it honors
 * `approval/policy` (a `never` session auto-rejects) and writes the
 * `approval/asked` + `approval/decided` audit pair. These cases pin the
 * outcome map and the fail-closed rules (no approval service, no agent)
 * without a full host lane.
 * @module tests/tools/write-approval-policy
 */

import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { TOOL_ABORTED, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { requestWriteApproval } from '../../src/write-approval.js'

describe('requestWriteApproval', () => {
  it('covers the session approval gate outcomes', async () => {
    const outcomes: ApprovalOutcome[] = ['allowed-once', 'rejected', 'cancelled', 'unavailable']
    for (const outcome of outcomes) {
      const approval = {
        get: (key: string) =>
          key === 'approval'
            ? {
                request: async (request: {
                  toolName: string
                  callId?: unknown
                  reason?: string
                  displayReason?: { en: string; zh: string }
                }) => {
                  expect(request.toolName).toBe('zotero_create_note')
                  expect(request.callId).toBe('call-appr-1')
                  expect(request.reason).toBe('Zotero library write: zotero_create_note')
                  expect(request.displayReason?.en).toContain('Zotero library write')
                  return outcome
                },
              }
            : undefined,
      }
      const exec = {
        callId: 'call-appr-1',
        name: 'zotero_create_note',
        signal: new AbortController().signal,
        agent: { id: 'agent-1' } as never,
      } as unknown as ToolRunContext
      const result = await requestWriteApproval(approval as unknown as Context, {
        exec,
        plan: '- plan',
      })
      if (outcome === 'allowed-once') expect(result).toBe('allowed')
      else if (outcome === 'unavailable') expect(result).toBe('unavailable')
      else expect(result).toBe('declined')
    }
  })

  it('fails closed without an approval service', async () => {
    const bare = { get: () => undefined }
    const exec = {
      callId: 'call-2',
      name: 'zotero_create_note',
      signal: new AbortController().signal,
    } as unknown as ToolRunContext
    await expect(
      requestWriteApproval(bare as unknown as Context, { exec, plan: '- plan' }),
    ).resolves.toBe('unavailable')
  })

  it('fails closed when an approval service is composed but the call carries no agent', async () => {
    const noAgent = {
      get: () => ({ request: async () => 'rejected' as const }),
    }
    await expect(
      requestWriteApproval(noAgent as unknown as Context, {
        exec: { signal: new AbortController().signal, name: 'z', callId: 'c' } as never,
        plan: '- plan',
      }),
    ).resolves.toBe('unavailable')
  })

  it('fails closed when the approval ask itself throws', async () => {
    const throwing = {
      get: () => ({
        request: async () => {
          throw new Error('audit append failed')
        },
      }),
    }
    await expect(
      requestWriteApproval(throwing as unknown as Context, {
        exec: {
          signal: new AbortController().signal,
          name: 'z',
          callId: 'c',
          agent: { id: 'agent-1' } as never,
        } as never,
        plan: '- plan',
      }),
    ).resolves.toBe('unavailable')
  })

  it('rethrows a harness abort and wraps a lost abort as TOOL_ABORTED', async () => {
    const aborting = {
      get: () => ({
        request: async () => {
          throw new HarnessError('aborted by the UI', TOOL_ABORTED)
        },
      }),
    }
    await expect(
      requestWriteApproval(aborting as unknown as Context, {
        exec: {
          signal: new AbortController().signal,
          name: 'z',
          callId: 'c',
          agent: { id: 'agent-1' } as never,
        } as never,
        plan: '- plan',
      }),
    ).rejects.toMatchObject({ code: TOOL_ABORTED })

    // The caller's signal aborted while the ask was failing: the abort is
    // the truth even when the thrown value lost its class identity.
    const controller = new AbortController()
    const lostAbort = {
      get: () => ({
        request: async () => {
          controller.abort()
          throw new Error('fetch aborted')
        },
      }),
    }
    await expect(
      requestWriteApproval(lostAbort as unknown as Context, {
        exec: {
          signal: controller.signal,
          name: 'z',
          callId: 'c',
          agent: { id: 'agent-1' } as never,
        } as never,
        plan: '- plan',
      }),
    ).rejects.toMatchObject({ code: TOOL_ABORTED })
  })
})
