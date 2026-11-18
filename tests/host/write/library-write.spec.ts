import {
  TOOL_ABORTED,
  validateJsonSchemaValue,
  type ObjectJsonSchema,
} from '@deepseek-ai/dsh-tools'
import { libraryWriteCases } from '../support/library-write-cases.ts'
/** Panel mutations retain the tool policy, approval gate and single dispatch. */
import { Context, Service } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
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
import { nonTextContent, textContent, toolBatchResult } from '../support/tool-batch.js'
import { grantAuthorize, SERVER_ID } from '../../helpers/write-domain-fixtures.js'
import { deferred } from '../../helpers/sync.js'

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
const TOOL = 'zotero_create_note'

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
  it('preserves the acknowledged write facts after the registered saved-search tool is cancelled', async () => {
    const host = await boot()
    grantAuthorize(host.mock)
    const headers = { 'Zotero-Server-ID': SERVER_ID }
    host.mock.route('GET', '/api/', (_req, _res, helpers) => helpers.json({}, headers))
    const path = '/api/users/0/searches/SEARCH01'
    const ref = 'zotero://user/0/search/SEARCH01'
    const readback = deferred()
    const release = deferred()
    let acknowledged = false
    host.mock.route('GET', path, async (_req, _res, helpers) => {
      if (acknowledged) {
        readback.resolve()
        await release.promise
      }
      helpers.json(
        {
          key: 'SEARCH01',
          version: 7,
          data: {
            key: 'SEARCH01',
            name: 'Old',
            conditions: [{ condition: 'title', operator: 'contains', value: 'review' }],
          },
        },
        headers,
      )
    })
    host.mock.route('PATCH', path, (_req, _res, helpers) => {
      acknowledged = true
      helpers.raw(204, { ...headers, 'Last-Modified-Version': '8' }, '')
    })
    const controller = new AbortController()
    const call = executeLibraryWrite(
      host.ctx,
      {
        sessionId: request.sessionId,
        operation: 'updateSavedSearch',
        args: { search: ref, name: 'New' },
      },
      controller.signal,
    )
    try {
      expect(await Promise.race([readback.promise.then(() => 'readback'), call])).toBe('readback')
      controller.abort()
      const result = await call
      expect(result).toMatchObject({ kind: 'failed', code: TOOL_ABORTED })
      expect(result.message).toContain(`${ref}?server=${SERVER_ID} at library version 8`)
      expect(result.message).toContain('committed-unverified')
      expect(result.message).toContain('Do not retry')
      expect(host.mock.requests.filter(({ method }) => method === 'PATCH')).toHaveLength(1)
    } finally {
      release.resolve()
    }
  })

  it('runs the registered tool through session approval and makes no HTTP request after refusal', async () => {
    const host = await boot()
    setApprovalOutcome('rejected')
    const result = await executeLibraryWrite(host.ctx, request, signal())
    expect(result.kind).toBe('declined')
    expect(approvalAsks).toHaveLength(1)
    expect(approvalAsks[0]?.toolName).toBe(TOOL)
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
      code: 'remote-access/denied',
    })
    expect(host.mock.requests).toHaveLength(0)
  })

  it('refuses an unavailable session or tool instead of dispatching outside its scope', async () => {
    const host = await boot()
    const resolve = vi
      .spyOn(host.ctx.get('sessionController')!, 'resolveAgent')
      .mockResolvedValue({ error: new RemoteError('gateway/internal', 'missing', {}) })
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
    ['restored', false, 'restored'],
    ['partial', false, 'partial'],
    ['failed', false, 'failed'],
    ['conflict', true, 'failed'],
  ])('preserves %s settlement and never retries', async (kind, isError, expected) => {
    const host = await boot()
    const batch = isError
      ? toolBatchResult({
          isError: true,
          meta: { kind },
          content: [textContent(kind)],
          error: {
            message: kind,
            info: { name: 'ZoteroError', code: 'ZOTERO_CONFLICT' },
          },
        })
      : toolBatchResult({
          isError: false,
          meta: { kind },
          content: [textContent(kind)],
        })
    const execute = vi.spyOn(host.ctx.tools, 'execute').mockResolvedValue(batch)
    expect(await executeLibraryWrite(host.ctx, request, signal())).toMatchObject({
      kind: expected,
      message: kind,
      ...(isError ? { code: 'ZOTERO_CONFLICT' } : {}),
    })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      agent,
      calls: [
        {
          type: 'tool-call',
          name: TOOL,
          arguments: JSON.stringify(request.args),
        },
      ],
    })
  })

  it('maps a structured user rejection to declined', async () => {
    const host = await boot()
    const execute = vi.spyOn(host.ctx.tools, 'execute').mockResolvedValue(
      toolBatchResult({
        isError: true,
        meta: null,
        content: [
          textContent('the plan was not approved'),
          nonTextContent(),
          textContent('no retry will happen'),
        ],
        error: {
          message: 'the user rejected tool "zotero_create_note"',
          info: { name: 'ApprovalError', code: 'APPROVAL_REJECTED' },
        },
      }),
    )
    const outcome = await executeLibraryWrite(host.ctx, request, signal())
    expect(outcome.kind).toBe('declined')
    expect(outcome.message).toBe('the plan was not approved\nno retry will happen')
    expect(outcome.code).toBe('APPROVAL_REJECTED')
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('does not classify an unrelated error that merely mentions a rejected tool', async () => {
    const host = await boot()
    vi.spyOn(host.ctx.tools, 'execute').mockResolvedValue(
      toolBatchResult({
        isError: true,
        meta: null,
        content: [textContent('gateway failed')],
        error: {
          message: 'gateway failed after the user rejected tool "zotero_create_note"',
        },
      }),
    )
    const outcome = await executeLibraryWrite(host.ctx, request, signal())
    expect(outcome.kind).toBe('failed')
  })

  it('maps Trash to the existing batch soft-delete operation', async () => {
    const host = await boot()
    const execute = vi
      .spyOn(host.ctx.tools, 'execute')
      .mockResolvedValue(toolBatchResult({ isError: false, meta: null, content: [] }))
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
      calls: [
        {
          type: 'tool-call',
          name: 'zotero_batch_items',
          arguments: JSON.stringify({ delete: ['zotero://user/0/item/ITEM0001'] }),
        },
      ],
    })
  })

  it('rejects malformed or cancelled requests before dispatch', async () => {
    const host = await boot()
    const execute = vi.spyOn(host.ctx.tools, 'execute')
    // Deliberately invalid wire value: the closed request schema must reject
    // the extra `args` key. The cast is confined to this invalid-input boundary.
    const malformed: unknown = { ...request, args: { markdown: 'x', bypass: true } }
    await expect(
      executeLibraryWrite(host.ctx, malformed as ZoteroLibraryWriteRequestView, signal()),
    ).rejects.toThrow()
    await expect(executeLibraryWrite(host.ctx, request, AbortSignal.abort())).rejects.toThrow()
    expect(execute).not.toHaveBeenCalled()
  })
})

it.each(libraryWriteCases)(
  'dispatches $operation once to $tool with schema-valid arguments',
  async (entry) => {
    const host = await boot()
    const execute = vi
      .spyOn(host.ctx.tools, 'execute')
      .mockResolvedValue(
        toolBatchResult({ isError: false, meta: { kind: 'applied' }, content: [] }),
      )
    await executeLibraryWrite(
      host.ctx,
      {
        sessionId: request.sessionId,
        operation: entry.operation,
        args: entry.args,
      } as ZoteroLibraryWriteRequestView,
      signal(),
    )
    expect(execute).toHaveBeenCalledTimes(1)
    const call = execute.mock.calls[0]?.[0].calls[0]
    expect(call?.name).toBe(entry.tool)
    const args = JSON.parse(call!.arguments)
    expect(args).toEqual('dispatched' in entry ? entry.dispatched : entry.args)
    const tool = host.ctx.tools.get(entry.tool)
    expect(tool).toBeDefined()
    expect(
      validateJsonSchemaValue(tool!.parameters as unknown as ObjectJsonSchema, args, ''),
    ).toEqual([])
    expect(host.mock.requests).toHaveLength(0)
  },
)
