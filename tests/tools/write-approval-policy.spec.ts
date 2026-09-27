/**
 * The session approval-policy gate that runs before any write plan card.
 *
 * `requestWriteApproval` is the deployment-level door: it honors
 * `approval/policy` (a `never` session auto-rejects) and writes the
 * `approval/asked` + `approval/decided` audit pair. These cases pin the
 * outcome map and the skip rules (no approval service, no agent) without a
 * full host lane.
 * @module tests/tools/write-approval-policy
 */

import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { requestWriteApproval } from '../../src/write-approval.js'

describe('requestWriteApproval', () => {
  it('covers the session approval gate outcomes', async () => {
    const outcomes: Array<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'> = [
      'allowed-once',
      'rejected',
      'cancelled',
      'unavailable',
    ]
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

  it('skips the approval gate without an approval service or without an agent', async () => {
    const bare = { get: () => undefined }
    const exec = {
      callId: 'call-2',
      name: 'zotero_create_note',
      signal: new AbortController().signal,
    } as unknown as ToolRunContext
    await expect(
      requestWriteApproval(bare as unknown as Context, { exec, plan: '- plan' }),
    ).resolves.toBe('allowed')
    const noAgent = {
      get: () => ({ request: async () => 'rejected' as const }),
    }
    await expect(
      requestWriteApproval(noAgent as unknown as Context, {
        exec: { signal: new AbortController().signal, name: 'z', callId: 'c' } as never,
        plan: '- plan',
      }),
    ).resolves.toBe('allowed')
  })
})
