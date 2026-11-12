/** Parsing endpoint composition: real host/domain services, controlled Session controller and HTTP. */
import { Context, Service } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent, type Inbox, type Model } from '@deepseek-ai/dsh-agent'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import RemoteAccessService, { type RemoteAccessBinding } from '@deepseek-ai/dsh-api-remote-access'
import { Peer } from '@deepseek-ai/dsh-client-connection'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { vi } from 'vitest'
import type {
  ZoteroDocumentArtifactResultView,
  ZoteroDocumentParseReceiptResultView,
  ZoteroParseTargetView,
  ZoteroStartDocumentParseRequestView,
  ZoteroStartDocumentParseResultView,
} from '../../../src/contract.js'
import { EnrichmentService } from '../../../src/enrichment/index.js'
import type { EnrichmentConfig } from '../../../src/enrichment/config.js'
import { MineruClient } from '../../../src/enrichment/transport.js'
import { setupHostLane } from '../../helpers/lanes/host-lane.js'
import { ATTACHMENT_KEY, ITEM_KEY, attachmentRef } from '../../helpers/server/keys.js'
import { attachment, versionHeaders } from '../../helpers/server/objects.js'
import { serveJson, serveText } from '../../helpers/server/serve.js'

export const OWNER = SessionId('parse-endpoint-owner')
export const OTHER = SessionId('parse-endpoint-other')
export const OPERATION_ID = '11111111-1111-4111-8111-111111111111'
export const DOCUMENT_URL = 'https://papers.example.org/document.pdf?edition=2'
export const PDF = new TextEncoder().encode('%PDF-1.7 synthetic endpoint document')
export const MARKDOWN = '# Parsed endpoint document\n\nEvidence available to ordinary reads.'
const SUBMIT = 'https://mineru.net/api/v1/agent/parse/file'
const POLL = 'https://mineru.net/api/v1/agent/parse/endpoint-task'
const UPLOAD = 'https://upload.example.org/document'
const RESULT = 'https://cdn.example.org/full.md'
export const ENDPOINTS = ['startDocumentParse', 'documentArtifact', 'documentParseReceipt'] as const
export type ParseEndpoint = (typeof ENDPOINTS)[number]

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface PrincipalMap {
    'parse-endpoint-guest': { readonly kind: 'parse-endpoint-guest' }
  }
}

export function startRequest(
  target: ZoteroParseTargetView = { kind: 'url', url: DOCUMENT_URL },
): ZoteroStartDocumentParseRequestView {
  return { sessionId: OWNER, operationId: OPERATION_ID, target, action: 'parse' }
}
export function endpointRequest(method: ParseEndpoint, sessionId: string = OWNER) {
  const request = startRequest()
  return method === 'startDocumentParse'
    ? { ...request, sessionId }
    : method === 'documentArtifact'
      ? { sessionId, target: request.target }
      : { sessionId, operationId: OPERATION_ID }
}

/** A public idle Agent handle with real Session, registry identity and owned Cordis lifecycle. */
async function registerIdleAgent(ctx: Context, id: SessionId) {
  const fiber = ctx.plugin({ inject: ['agents'], apply() {} })
  await fiber
  const model: Model = {
    current: () => undefined,
    select: () => {
      throw new Error('No model step is allowed')
    },
  }
  const inbox: Inbox = {
    nextTurn: [],
    nextStep: [],
    clear() {},
    append() {},
    prepend() {},
    replace: () => false,
    remove: () => false,
    splice: () => [],
  }
  const agent: Agent = {
    id,
    ctx: fiber.ctx,
    session: Session.create(id),
    options: {},
    status: 'idle',
    model,
    inbox,
    send: vi.fn(),
    followup: vi.fn(),
    steer: vi.fn(),
    inject: vi.fn(),
    cancel: vi.fn(),
    whenIdle: async () => {},
    runMaintenance: async (task) => await task(new AbortController().signal),
  }
  await fiber.ctx.agents.register(agent)
  return agent
}

/** No socket: the real transport still executes public-DNS admission, request and response handling. */
function scriptedMineru() {
  const calls: { url: string; init: RequestInit }[] = []
  const headers = { etag: '"endpoint-v1"', 'content-length': String(PDF.byteLength) }
  const client = new MineruClient({
    resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    dispatcher: () => ({ dispatcher: {} as never, close: async () => {} }),
    fetch: async (url, init) => {
      calls.push({ url, init: init ?? {} })
      if (url === DOCUMENT_URL && init?.method === 'HEAD') return new Response(null, { headers })
      if (url === DOCUMENT_URL && init?.method === 'GET')
        return new Response(new Uint8Array(PDF).buffer, { headers })
      if (url === SUBMIT && init?.method === 'POST')
        return Response.json({ code: 0, data: { task_id: 'endpoint-task', file_url: UPLOAD } })
      if (url === UPLOAD && init?.method === 'PUT') return new Response(null)
      if (url === POLL && init?.method === 'GET')
        return Response.json({
          code: 0,
          data: { task_id: 'endpoint-task', state: 'done', markdown_url: RESULT },
        })
      if (url === RESULT && init?.method === 'GET') return new Response(MARKDOWN)
      throw new Error(`Unexpected scripted HTTP request: ${init?.method} ${url}`)
    },
  })
  return { client, calls }
}

export async function endpointFixture(options: { attachment?: 'child' | 'top' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'zotero-parse-endpoints-'))
  const http = scriptedMineru()
  let bindings: readonly RemoteAccessBinding[] = []
  const sessionCalls: SessionId[] = []
  let removeSessionResource: () => void = () => {}
  const lane = await setupHostLane(
    {},
    {
      typert: true,
      compose: async (ctx) => {
        await ctx.plugin(SessionProjectionRegistry)
        await ctx.plugin(AgentRegistry)
        await ctx.plugin(RemoteAccessService)
        await ctx.plugin(TypertGatewayService)
        await ctx.plugin(LocalJobRegistry, {})
        ctx.jobs.attachController('parsing endpoint observer')
        // SessionController's resolver is private. Its public resource-registry
        // boundary is substituted here; field extraction is equivalent for these
        // closed DTOs, each with a single request object carrying sessionId.
        class Sessions extends Service {
          static inject = ['typert']
          constructor(scoped: Context) {
            super(scoped, 'sessionController')
            removeSessionResource = scoped.typert.resources.register('session', {
              field: 'sessionId',
            })
          }
          async resolveAgent(id: SessionId) {
            sessionCalls.push(id)
            const agent = ctx.agents.get(id)
            return agent === undefined
              ? { error: new RemoteError('gateway/internal', 'Session is not live', {}) }
              : { agent }
          }
        }
        await ctx.plugin(Sessions)
        ctx.remoteAccess.registerPolicy('parse-endpoint-guest', { bindings: () => bindings })
      },
    },
  )
  const ctx = lane.ctx
  const agent = await registerIdleAgent(ctx, OWNER)
  await registerIdleAgent(ctx, OTHER)
  const sourcePath = join(root, 'selected.pdf')
  await writeFile(sourcePath, PDF)
  serveJson(
    lane.mock,
    `/api/users/0/items/${ATTACHMENT_KEY}`,
    attachment({
      data: { ...(options.attachment === 'child' ? { parentItem: ITEM_KEY } : {}) },
    }),
    versionHeaders(),
  )
  serveText(
    lane.mock,
    `/api/users/0/items/${ATTACHMENT_KEY}/file/view/url`,
    pathToFileURL(sourcePath).href,
    versionHeaders(),
  )
  const outputDir = join(root, 'parsed')
  const config = {
    outputDir,
  } satisfies EnrichmentConfig
  const enrichmentFiber = ctx.plugin((enrichmentCtx) => {
    new EnrichmentService(enrichmentCtx, config, { client: http.client })
  })
  await enrichmentFiber
  const owner = new Peer(ctx, { principal: { kind: 'owner' } })
  const guest = new Peer(ctx, { principal: { kind: 'parse-endpoint-guest' } })
  const started = vi.spyOn(ctx.jobs, 'start')
  const resolved = vi.spyOn(ctx.zotero, 'resolveAttachment')
  const invoke = async (
    method: ParseEndpoint,
    request: unknown,
    peer: Peer = owner,
  ): Promise<unknown> =>
    await ctx.typertGateway.invoke({ namespace: 'zotero', method, args: { request }, peer })
  return {
    ctx,
    lane,
    agent,
    root,
    outputDir,
    sourcePath,
    config,
    http,
    owner,
    guest,
    started,
    resolved,
    sessionCalls,
    attachmentTarget: { kind: 'attachment' as const, ref: attachmentRef() },
    grant(sessionId: SessionId = OWNER, methods: readonly ParseEndpoint[] = ENDPOINTS) {
      bindings = [
        {
          resource: { kind: 'session', id: sessionId },
          role: {
            name: 'parse-session',
            resource: 'session',
            actions: methods.map((method) => `zotero/${method}` as const),
          },
        },
      ]
      ctx.remoteAccess.invalidate()
    },
    grantGlobal() {
      bindings = [
        {
          resource: { kind: 'global' },
          role: {
            name: 'parse-global',
            resource: 'global',
            actions: ENDPOINTS.map((method) => `zotero/${method}` as const),
          },
        },
      ]
      ctx.remoteAccess.invalidate()
    },
    removeSessionResource: () => removeSessionResource(),
    invoke,
    start: async (request = startRequest(), peer = owner) =>
      (await invoke('startDocumentParse', request, peer)) as ZoteroStartDocumentParseResultView,
    artifact: async (target: ZoteroParseTargetView, peer = owner) =>
      (await invoke(
        'documentArtifact',
        { sessionId: OWNER, target },
        peer,
      )) as ZoteroDocumentArtifactResultView,
    receipt: async (peer = owner) =>
      (await invoke(
        'documentParseReceipt',
        { sessionId: OWNER, operationId: OPERATION_ID },
        peer,
      )) as ZoteroDocumentParseReceiptResultView,
    async failure(method: ParseEndpoint, request: unknown, peer = owner) {
      try {
        await invoke(method, request, peer)
      } catch (error) {
        return { error, wire: ctx.typertGateway.wireStream.failure(error) }
      }
      throw new Error(`Expected zotero/${method} to fail`)
    },
    async dispose() {
      try {
        await enrichmentFiber.dispose()
        await owner.dispose()
        await guest.dispose()
        await ctx.fiber.dispose()
      } finally {
        await lane.teardown()
        await rm(root, { recursive: true, force: true })
      }
    },
  }
}
export type EndpointFixture = Awaited<ReturnType<typeof endpointFixture>>
