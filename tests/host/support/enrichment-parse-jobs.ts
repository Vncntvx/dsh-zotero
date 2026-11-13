/** Real Cordis job registry assembly; only Agent driving and parse I/O are controlled. */
import { Context, Service } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent, type Inbox, type Model } from '@deepseek-ai/dsh-agent'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import RemoteAccessService, { type RemoteAccessBinding } from '@deepseek-ai/dsh-api-remote-access'
import { Peer } from '@deepseek-ai/dsh-client-connection'
import { RemoteError, type RemoteInvocation } from '@deepseek-ai/dsh-typert-protocol'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { vi } from 'vitest'
import {
  ENRICHMENT_DEFAULTS,
  type EnrichmentPreferences,
} from '../../../src/enrichment-preferences.js'
import type { ZoteroStartDocumentParseRequestView } from '../../../src/contract.js'
import {
  DiskParseJobPersistence,
  EnrichmentParseJobs,
  type EnrichmentParseJobsDeps,
  type ParseJobExecution,
} from '../../../src/enrichment/parse-jobs.js'
import { parsedIdentityOf } from '../../../src/enrichment/identity.js'
import { sourceKeyOf } from '../../../src/enrichment/source-stamp.js'
import type { ParseDocumentResult } from '../../../src/enrichment/parse-document.js'
import { parseDigest } from '../../../src/enrichment/parse-target.js'
import { attachmentRef } from '../../helpers/server/keys.js'

export const parseSignal = (): AbortSignal => new AbortController().signal
export const PARSE_URL = 'https://papers.example.org/document.pdf?token=private-source'
export const parseRequest = (
  sessionId = 'parse-owner',
  overrides: Partial<ZoteroStartDocumentParseRequestView> = {},
): ZoteroStartDocumentParseRequestView => ({
  sessionId,
  operationId: randomUUID(),
  target: { kind: 'url', url: PARSE_URL },
  action: 'parse',
  ...overrides,
})

export function parsedResult(
  request: Pick<ParseJobExecution, 'input' | 'config' | 'generation'>,
  markdown = '# Parsed PDF\nEvidence from this document.',
): ParseDocumentResult {
  const cacheKey = parseDigest(markdown)
  const fingerprint = parseDigest('document bytes')
  const sourceId = sourceKeyOf(request.input.key)
  const generation = request.generation
  return {
    artifact: {
      markdown,
      meta: {
        version: 2,
        parser: 'mineru',
        format: 'markdown',
        sourceId,
        generation,
        identity: parsedIdentityOf(request.input.key),
        mode: request.config.mode,
        contentFingerprint: fingerprint,
        taskId: 'task',
        files: ['full.md'],
      },
    },
    cacheKey,
    cached: false,
    stamp: { kind: 'bytes', fingerprint },
    provenance: {
      parser: 'mineru',
      mode: request.config.mode,
      artifactId: cacheKey,
      fingerprint,
      sourceId,
      generation,
    },
  }
}

const model: Model = {
  current: () => undefined,
  select: () => {
    throw new Error('The idle parsing fixture never selects a model')
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

/** The idle Agent is a fully typed public handle registered in the real registry. */
async function idleAgent(ctx: Context, rawId: string) {
  const fiber = ctx.plugin(() => {})
  await fiber
  const id = SessionId(rawId)
  const session = Session.create(id)
  const agent: Agent = {
    id,
    session,
    ctx: fiber.ctx,
    options: {},
    model,
    inbox,
    status: 'idle',
    send() {},
    followup() {},
    steer() {},
    inject() {},
    cancel() {},
    whenIdle: async () => {},
    runMaintenance: async (task) => await task(parseSignal()),
  }
  const detach = await ctx.agents.register(agent)
  return {
    agent,
    /** Remove this Agent from the live registry without disposing its scope. */
    unregister: async () => {
      await detach()
    },
    dispose: async () => {
      await fiber.dispose()
    },
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface PrincipalMap {
    'parse-guest': { readonly kind: 'parse-guest' }
  }
}

export async function parseJobsFixture(
  overrides: Partial<EnrichmentParseJobsDeps> = {},
  options: { controller?: boolean } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'zotero-parse-jobs-'))
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(RemoteAccessService)
  await ctx.plugin(LocalJobRegistry, {})
  const detach =
    options.controller === false ? () => {} : ctx.jobs.attachController('parse fixture')
  const owners = [await idleAgent(ctx, 'parse-owner'), await idleAgent(ctx, 'parse-other')]
  class Sessions extends Service {
    constructor(scoped: Context) {
      super(scoped, 'sessionController')
    }
    async resolveAgent(id: SessionId) {
      const agent = ctx.agents.get(id)
      return agent === undefined
        ? { error: new RemoteError('gateway/internal', 'Session is not live', {}) }
        : { agent }
    }
  }
  await ctx.plugin(Sessions)
  const config = {
    value: {
      ...ENRICHMENT_DEFAULTS,
      outputDir: root,
    } as EnrichmentPreferences,
  }
  const resolveAttachment = vi.fn<EnrichmentParseJobsDeps['resolveAttachment']>(async (ref) => ({
    ref,
    title: 'Selected PDF',
    contentType: 'application/pdf',
    kind: 'file',
    path: '/private/zotero/attachment.pdf',
  }))
  const execute = vi.fn<EnrichmentParseJobsDeps['execute']>(async (request) =>
    parsedResult(request),
  )
  const lookup = vi.fn<EnrichmentParseJobsDeps['lookup']>(async () => ({
    kind: 'miss',
    reason: 'absent',
  }))
  const persistence = new DiskParseJobPersistence(async () => root)
  const readImage = vi.fn<EnrichmentParseJobsDeps['readImage']>(async () => undefined)
  const deps: EnrichmentParseJobsDeps = {
    config: () => config.value,
    resolveAttachment,
    execute,
    lookup,
    readImage,
    persistence,
    ...overrides,
  }
  const helper = new EnrichmentParseJobs(ctx, deps)
  const helpers = [helper]
  let bindings: readonly RemoteAccessBinding[] = []
  ctx.remoteAccess.registerPolicy('parse-guest', { bindings: () => bindings })
  const guestContext = (method = 'startDocumentParse'): Context => {
    const invocation: RemoteInvocation = {
      request: { namespace: 'zotero', method, args: {} },
      service: 'enrichment',
      peer: new Peer(ctx, { principal: { kind: 'parse-guest' } }),
      signal: parseSignal(),
      uplink: <In>(): AsyncIterable<In> => ({
        [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }),
      }),
    }
    return ctx.extend({ invocation })
  }
  return {
    ctx,
    root,
    helper,
    deps,
    config,
    execute,
    lookup,
    readImage,
    resolveAttachment,
    persistence,
    owners,
    attachment: { kind: 'attachment' as const, ref: attachmentRef() },
    guestContext,
    grant(
      sessionId = 'parse-owner',
      actions = [
        'zotero/startDocumentParse',
        'zotero/documentArtifact',
        'zotero/documentParseReceipt',
      ],
    ) {
      bindings = [
        {
          resource: { kind: 'session', id: SessionId(sessionId) },
          role: { name: 'parse', resource: 'session', actions: actions as `zotero/${string}`[] },
        },
      ]
      ctx.remoteAccess.invalidate()
    },
    revoke() {
      bindings = []
      ctx.remoteAccess.invalidate()
    },
    remount() {
      const next = new EnrichmentParseJobs(ctx, deps)
      helpers.push(next)
      return next
    },
    async dispose() {
      for (const value of helpers) await value.dispose()
      detach()
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}
export type ParseJobsFixture = Awaited<ReturnType<typeof parseJobsFixture>>
