/** The real access service refuses a guest before both Gateway dispatch and in-method writes. */
import RemoteAccessService from '@deepseek-ai/dsh-api-remote-access'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import { Peer } from '@deepseek-ai/dsh-client-connection'
import type { RemoteInvocation } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, expect, it, vi } from 'vitest'
import { executeLibraryWrite } from '../../../src/library-write.js'
import ZoteroLibraryService from '../../../src/library/index.js'
import type { ZoteroLibraryWriteRequestView } from '../../../src/contract.js'
import { setupHostLane, type HostLane } from '../../helpers/lanes/host-lane.js'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface PrincipalMap {
    'zotero-audit-guest': { readonly kind: 'zotero-audit-guest'; readonly id: string }
  }
}
let lane: HostLane | undefined
afterEach(async () => {
  await lane?.teardown()
  lane = undefined
  vi.restoreAllMocks()
})
const request: ZoteroLibraryWriteRequestView = {
  sessionId: 'protected-session',
  operation: 'createNote',
  args: { markdown: 'private note' },
}

async function boot() {
  lane = await setupHostLane(
    { writeEnabled: true },
    {
      typert: true,
      compose: async (ctx) => {
        await ctx.plugin(RemoteAccessService)
        await ctx.plugin(TypertGatewayService)
      },
    },
  )
  await lane.ctx.plugin(ZoteroLibraryService, {})
  const peer = new Peer(lane.ctx, { principal: { kind: 'zotero-audit-guest', id: 'guest' } })
  return { lane, peer }
}

it('rejects an unbound guest at the real Gateway without dispatching a model tool', async () => {
  const { lane, peer } = await boot()
  const execute = vi.spyOn(lane.ctx.tools, 'execute')
  await expect(
    lane.ctx.typertGateway.invoke({
      peer,
      namespace: 'zotero',
      method: 'write',
      args: { request },
    }),
  ).rejects.toMatchObject({
    code: 'remote-access/denied',
    details: { action: 'zotero/write', reason: 'no-allow' },
  })
  expect(execute).not.toHaveBeenCalled()
  expect(lane.mock.requests).toEqual([])
})

it('retains the guest identity when a call reaches the in-method defense', async () => {
  const { lane, peer } = await boot()
  const signal = new AbortController().signal
  const invocation: RemoteInvocation = {
    request: { namespace: 'zotero', method: 'write', args: { request } },
    service: 'zoteroLibrary',
    peer,
    signal,
    uplink: <In>(): AsyncIterable<In> => ({
      [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }),
    }),
  }
  const execute = vi.spyOn(lane.ctx.tools, 'execute')
  await expect(
    executeLibraryWrite(lane.ctx.extend({ invocation }), request, signal),
  ).rejects.toMatchObject({
    code: 'remote-access/denied',
    details: { action: 'zotero/write', reason: 'no-allow' },
  })
  expect(execute).not.toHaveBeenCalled()
  expect(lane.mock.requests).toEqual([])
})
