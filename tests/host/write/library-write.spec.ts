/** Panel mutations retain the tool policy, approval gate and single dispatch. */
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeLibraryWrite } from '../../../src/library-write.js'
import type { ZoteroLibraryWriteRequestView } from '../../../src/contract.js'
import {
  ZOTERO_CAPABILITY_UNAVAILABLE,
  ZOTERO_WRITE_APPROVAL_UNAVAILABLE,
} from '../../../src/errors.js'
import { setupHostLane, type HostLane } from '../../helpers/lanes/host-lane.js'
import {
  StubApproval,
  approvalAsks,
  resetApprovalStub,
  setApprovalOutcome,
  ApprovingQuestions,
} from '../../helpers/approval-stub.js'

let lane: HostLane | undefined
const agent = { status: 'running' }
class PanelSessions extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sessionController')
  }
  async resolveAgent() {
    return { agent }
  }
}
class PanelAccess extends Service {
  constructor(ctx: Context) {
    super(ctx, 'remoteAccess')
  }
  allows() {
    return true
  }
}
const signal = () => new AbortController().signal
const request: ZoteroLibraryWriteRequestView = {
  sessionId: 'panel-session',
  operation: 'createNote',
  args: { markdown: 'panel note' },
}

beforeEach(() => {
  resetApprovalStub()
  agent.status = 'running'
})
afterEach(async () => {
  await lane?.teardown()
  lane = undefined
  vi.restoreAllMocks()
})
async function boot(enabled = true) {
  lane = await setupHostLane(
    { writeEnabled: enabled },
    {
      compose: async (ctx) => {
        await ctx.plugin(PanelSessions)
        await ctx.plugin(PanelAccess)
        await ctx.plugin(StubApproval)
        await ctx.plugin(ApprovingQuestions)
      },
    },
  )
  return lane
}

describe('panel write gateway', () => {
  it('runs the registered tool through session approval and makes no HTTP request after refusal', async () => {
    const host = await boot()
    setApprovalOutcome('rejected')
    const result = await executeLibraryWrite(host.ctx, request, signal())
    expect(result.kind).toBe('declined')
    expect(approvalAsks).toHaveLength(1)
    expect(approvalAsks[0]?.toolName).toBe('zotero_create_note')
    expect(host.mock.requests).toHaveLength(0)
  })

  it('fails before tool dispatch when writes are disabled', async () => {
    const host = await boot(false)
    const execute = vi.spyOn(host.ctx.tools, 'execute')
    await expect(executeLibraryWrite(host.ctx, request, signal())).rejects.toMatchObject({
      code: ZOTERO_CAPABILITY_UNAVAILABLE,
    })
    expect(execute).not.toHaveBeenCalled()
    expect(approvalAsks).toHaveLength(0)
  })

  it('requires an authorized running session with an audit channel', async () => {
    const host = await boot()
    agent.status = 'idle'
    await expect(executeLibraryWrite(host.ctx, request, signal())).rejects.toMatchObject({
      code: ZOTERO_WRITE_APPROVAL_UNAVAILABLE,
    })
    agent.status = 'running'
    vi.spyOn(host.ctx.get('remoteAccess')!, 'allows').mockReturnValue(false)
    await expect(executeLibraryWrite(host.ctx, request, signal())).rejects.toMatchObject({
      code: ZOTERO_WRITE_APPROVAL_UNAVAILABLE,
    })
    expect(host.mock.requests).toHaveLength(0)
  })

  it('refuses an unavailable session or tool instead of dispatching outside its scope', async () => {
    const host = await boot()
    const resolve = vi
      .spyOn(host.ctx.get('sessionController')!, 'resolveAgent')
      .mockResolvedValue({ error: 'missing' } as never)
    await expect(executeLibraryWrite(host.ctx, request, signal())).rejects.toMatchObject({
      code: ZOTERO_WRITE_APPROVAL_UNAVAILABLE,
    })
    resolve.mockRestore()
    vi.spyOn(host.ctx.tools, 'get').mockReturnValue(undefined)
    await expect(executeLibraryWrite(host.ctx, request, signal())).rejects.toMatchObject({
      code: ZOTERO_CAPABILITY_UNAVAILABLE,
    })
  })

  it.each([
    ['declined', false, 'declined'],
    ['committed-unverified', false, 'committed-unverified'],
    ['applied', false, 'applied'],
    ['conflict', true, 'failed'],
  ])('preserves %s settlement and never retries', async (kind, isError, expected) => {
    const host = await boot()
    const execute = vi.spyOn(host.ctx.tools, 'execute').mockResolvedValue({
      isError,
      meta: { kind },
      content: [{ type: 'text', text: kind }],
      ...(isError ? { error: { message: kind, info: { code: 'ZOTERO_CONFLICT' } } } : {}),
    } as never)
    expect(await executeLibraryWrite(host.ctx, request, signal())).toMatchObject({
      kind: expected,
      message: kind,
      ...(isError ? { code: 'ZOTERO_CONFLICT' } : {}),
    })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      agent,
      name: 'zotero_create_note',
      arguments: request.args,
    })
  })

  it('maps a tool-level user rejection to declined via the harness refusal message', async () => {
    const host = await boot()
    const execute = vi.spyOn(host.ctx.tools, 'execute').mockResolvedValue({
      isError: true,
      meta: null,
      content: [
        { type: 'text', text: 'the plan was not approved' },
        { type: 'other' },
        { type: 'text', text: 'no retry will happen' },
      ],
      error: {
        message: 'the user rejected tool "zotero_create_note"',
        info: { code: 'TOOL_DENIED' },
      },
    } as never)
    const outcome = await executeLibraryWrite(host.ctx, request, signal())
    expect(outcome.kind).toBe('declined')
    expect(outcome.message).toBe('the plan was not approved\nno retry will happen')
    expect(outcome.code).toBe('TOOL_DENIED')
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('maps Trash to the existing batch soft-delete operation', async () => {
    const host = await boot()
    const execute = vi
      .spyOn(host.ctx.tools, 'execute')
      .mockResolvedValue({ isError: false, meta: null, content: [] } as never)
    await executeLibraryWrite(
      host.ctx,
      {
        sessionId: 'panel-session',
        operation: 'trash',
        args: { refs: ['zotero://user/0/item/ITEM0001'] },
      },
      signal(),
    )
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      name: 'zotero_batch_items',
      arguments: { delete: ['zotero://user/0/item/ITEM0001'] },
    })
  })

  it('rejects malformed or cancelled requests before dispatch', async () => {
    const host = await boot()
    const execute = vi.spyOn(host.ctx.tools, 'execute')
    await expect(
      executeLibraryWrite(
        host.ctx,
        { ...request, args: { markdown: 'x', bypass: true } } as never,
        signal(),
      ),
    ).rejects.toThrow()
    await expect(executeLibraryWrite(host.ctx, request, AbortSignal.abort())).rejects.toThrow()
    expect(execute).not.toHaveBeenCalled()
  })
})
