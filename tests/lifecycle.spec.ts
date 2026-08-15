import { Context, Service, type Context as CordisContext, type Fiber } from '@deepseek-ai/cordis'
import { CommandId, type CommandDefinition, type CommandInvocation, type CommandResult } from '@deepseek-ai/dsh-commands'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ZoteroService from '../src/index.js'
import { ZOTERO_CAPABILITY_UNAVAILABLE, ZOTERO_PROVIDER_UNAVAILABLE, ZoteroError } from '../src/errors.js'
import type { ZoteroProvider } from '../src/types.js'
import { MockZotero } from './helpers/mock-zotero.js'

/** Minimal command registry stand-in so the optional /zotero command path can be exercised. */
class StubCommands extends Service {
  readonly registered: CommandDefinition[] = []

  constructor(ctx: CordisContext) {
    super(ctx, 'commands')
  }

  register(definition: CommandDefinition): () => void {
    this.registered.push(definition)
    return () => {}
  }
}

let mock: MockZotero

beforeEach(async () => {
  mock = await MockZotero.start()
})

afterEach(async () => {
  await mock.close()
})

async function bootContext(commands: boolean): Promise<{ ctx: Context; stub?: StubCommands; zoteroFiber: Fiber }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, {})
  let stub: StubCommands | undefined
  if (commands) {
    await ctx.plugin(StubCommands)
    stub = ctx.get('commands') as unknown as StubCommands
  }
  const zoteroFiber = ctx.plugin(ZoteroService, { baseUrl: mock.baseUrl })
  await zoteroFiber
  return { ctx, stub, zoteroFiber }
}

function invocation(rawInput: string, signal: AbortSignal = new AbortController().signal): CommandInvocation {
  return { commandId: CommandId('test-command'), agent: {} as never, rawInput, signal }
}

describe('ZoteroService lifecycle', () => {
  it('provides ctx.zotero and removes it when its fiber is disposed', async () => {
    const { ctx, zoteroFiber } = await bootContext(true)
    expect(ctx.get('zotero')).toBeInstanceOf(ZoteroService)
    await zoteroFiber.dispose()
    expect(ctx.get('zotero')).toBeUndefined()
  })

  it('registers the zotero command only when a command registry exists', async () => {
    const withCommands = await bootContext(true)
    expect(withCommands.stub!.registered.map((definition) => definition.name)).toEqual(['zotero'])

    const withoutCommands = await bootContext(false)
    // The plugin still loads fine; there is just no command registry to register into.
    expect(withoutCommands.ctx.get('zotero')).toBeInstanceOf(ZoteroService)
  })
})

describe('/zotero status command', () => {
  it('reports a connected Zotero 10+ instance', async () => {
    mock.route('GET', '/api/', (req, res, helpers) => helpers.json({}, {
      'Zotero-API-Version': '3',
      'Zotero-Schema-Version': '25',
      'Zotero-Server-ID': 'sPMHtLD6HHBd',
    }))
    const { stub } = await bootContext(true)
    const definition = stub!.registered[0]!
    const result = await definition.handler(invocation('status')) as CommandResult
    expect(result.kind).toBe('success')
    if (result.kind !== 'success') throw new Error('unreachable')
    expect(result.text).toContain('connected')
    expect(result.text).toContain('3')
    expect(result.text).toContain('25')
    expect(result.text).toContain('sPMHtLD6HHBd')
  })

  it('reports a missing Server-ID and missing headers as a degraded instance without failing', async () => {
    mock.route('GET', '/api/', (req, res, helpers) => helpers.json({}))
    const { stub } = await bootContext(true)
    const definition = stub!.registered[0]!
    const result = await definition.handler(invocation('status')) as CommandResult
    expect(result.kind).toBe('success')
    if (result.kind !== 'success') throw new Error('unreachable')
    expect(result.text).toContain('connected')
    expect(result.text).toContain('API version: not reported')
    expect(result.text).toContain('Schema version: not reported')
    expect(result.text).toContain('Server ID: not reported (Zotero 9 or earlier)')
  })

  it('reports a disconnected Zotero with the actionable diagnosis', async () => {
    const url = mock.baseUrl
    await mock.close()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime, {})
    await ctx.plugin(StubCommands)
    const registered = (ctx.get('commands') as unknown as StubCommands).registered
    await ctx.plugin(ZoteroService, { baseUrl: url })
    const definition = registered[0]!
    const result = await definition.handler(invocation('status')) as CommandResult
    expect(result.kind).toBe('success')
    if (result.kind !== 'success') throw new Error('unreachable')
    expect(result.text).toContain('not connected')
    expect(result.text).toContain('Settings')
  })

  it('rejects unknown subcommands with usage text', async () => {
    mock.route('GET', '/api/', (req, res, helpers) => helpers.json({}, { 'Zotero-API-Version': '3' }))
    const { stub } = await bootContext(true)
    const definition = stub!.registered[0]!
    const result = await definition.handler(invocation('open')) as CommandResult
    expect(result).toEqual({ kind: 'error', text: 'Usage: /zotero status' })
  })
})

describe('provider selection', () => {
  it('fails with PROVIDER_UNAVAILABLE when the configured provider is not registered', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime, {})
    await ctx.plugin(ZoteroService, { baseUrl: mock.baseUrl, provider: 'sqlite' })
    const service = ctx.get('zotero') as ZoteroService
    let thrown: unknown
    try {
      await service.status()
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ZoteroError)
    expect((thrown as ZoteroError).code).toBe(ZOTERO_PROVIDER_UNAVAILABLE)
    expect((thrown as ZoteroError).message).toContain('sqlite')
  })
})

describe('provider registration', () => {
  it('rejects a duplicate provider id', async () => {
    const { ctx } = await bootContext(true)
    const service = ctx.get('zotero') as ZoteroService
    const foreign: ZoteroProvider = {
      id: 'local',
      capabilities: new Set(),
      status: async () => ({ providerId: 'local', connected: false, diagnosis: 'test double' }),
      search: async () => { throw new Error('test double: must not be called') },
    }
    let thrown: unknown
    try {
      service.registerProvider(foreign)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ZoteroError)
    expect((thrown as ZoteroError).code).toBe(ZOTERO_PROVIDER_UNAVAILABLE)
  })

  it('removes a provider when its registration disposer runs', async () => {
    const { ctx } = await bootContext(true)
    const service = ctx.get('zotero') as ZoteroService
    const foreign: ZoteroProvider = {
      id: 'foreign',
      capabilities: new Set(),
      status: async () => ({ providerId: 'foreign', connected: true, diagnosis: 'ok' }),
      search: async () => { throw new Error('test double: must not be called') },
    }
    const dispose = service.registerProvider(foreign)
    dispose()
    // The service still resolves its configured 'local' provider; 'foreign' is gone from the registry.
    mock.route('GET', '/api/', (req, res, helpers) => helpers.json({}, { 'Zotero-API-Version': '3' }))
    const status = await service.status()
    expect(status.providerId).toBe('local')
  })
})

describe('capability gating', () => {
  it('refuses search when the configured provider lacks the capability', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime, {})
    await ctx.plugin(ZoteroService, { baseUrl: mock.baseUrl, provider: 'limited' })
    const service = ctx.get('zotero') as ZoteroService
    service.registerProvider({
      id: 'limited',
      capabilities: new Set(['metadata']),
      status: async () => ({ providerId: 'limited', connected: true, diagnosis: 'ok' }),
      search: async () => { throw new Error('test double: must not be called') },
    })
    let thrown: unknown
    try {
      await service.search({
        scope: { kind: 'library' }, mode: 'metadata', sort: 'dateModified', direction: 'desc', offset: 0, limit: 5,
      })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ZoteroError)
    expect((thrown as ZoteroError).code).toBe(ZOTERO_CAPABILITY_UNAVAILABLE)
    expect((thrown as ZoteroError).message).toContain('search')
  })
})
