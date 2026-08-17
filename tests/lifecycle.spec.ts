import { Context, Service, type Context as CordisContext, type Fiber } from '@deepseek-ai/cordis'
import {
  CommandId,
  type CommandDefinition,
  type CommandInvocation,
  type CommandResult,
} from '@deepseek-ai/dsh-commands'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ZoteroService from '../src/index.js'
import {
  ZOTERO_CAPABILITY_UNAVAILABLE,
  ZOTERO_PROVIDER_UNAVAILABLE,
  ZoteroError,
} from '../src/errors.js'
import { ZOTERO_PROMPT_SECTION_ORDER } from '../src/prompt.js'
import { parseRef } from '../src/refs.js'
import type { ZoteroProvider } from '../src/types.js'
import { MockZotero } from './helpers/mock-zotero.js'

/** Minimal command registry stand-in so the optional /zotero command path can be exercised. */
class StubCommands extends Service {
  readonly registered: CommandDefinition[] = []

  constructor(ctx: CordisContext) {
    super(ctx, 'commands')
  }

  register(definition: CommandDefinition): () => void {
    const registered = this.registered
    // Effect-scoped like the real registry: the registration lives in the
    // scope that called register(), so a disposed injection unwinds it.
    return this.ctx.effect(() => {
      registered.push(definition)
      return () => {
        const index = registered.indexOf(definition)
        if (index >= 0) registered.splice(index, 1)
      }
    }, 'StubCommands.register()')
  }
}

let mock: MockZotero

beforeEach(async () => {
  mock = await MockZotero.start()
})

afterEach(async () => {
  await mock.close()
})

async function bootContext(
  commands: boolean,
  config: Record<string, unknown> = {},
): Promise<{ ctx: Context; stub?: StubCommands; zoteroFiber: Fiber }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, {})
  let stub: StubCommands | undefined
  if (commands) {
    await ctx.plugin(StubCommands)
    stub = ctx.get('commands') as unknown as StubCommands
  }
  const zoteroFiber = ctx.plugin(ZoteroService, { baseUrl: mock.baseUrl, ...config })
  await zoteroFiber
  return { ctx, stub, zoteroFiber }
}

function invocation(
  rawInput: string,
  signal: AbortSignal = new AbortController().signal,
): CommandInvocation {
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

  it('never touches Zotero while loading or disposing — the plugin is request-driven only', async () => {
    const withCommands = await bootContext(true)
    expect(mock.requests).toEqual([])
    await withCommands.zoteroFiber.dispose()
    expect(mock.requests).toEqual([])

    const withoutCommands = await bootContext(false)
    expect(mock.requests).toEqual([])
    await withoutCommands.zoteroFiber.dispose()
    expect(mock.requests).toEqual([])
  })
})

describe('/zotero status command', () => {
  it('reports a connected Zotero 10+ instance', async () => {
    mock.route('GET', '/api/', (req, res, helpers) =>
      helpers.json(
        {},
        {
          'Zotero-API-Version': '3',
          'Zotero-Schema-Version': '25',
          'Zotero-Server-ID': 'sPMHtLD6HHBd',
        },
      ),
    )
    const { stub } = await bootContext(true)
    const definition = stub!.registered[0]!
    const result = (await definition.handler(invocation('status'))) as CommandResult
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
    const result = (await definition.handler(invocation('status'))) as CommandResult
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
    const result = (await definition.handler(invocation('status'))) as CommandResult
    expect(result.kind).toBe('success')
    if (result.kind !== 'success') throw new Error('unreachable')
    expect(result.text).toContain('not connected')
    expect(result.text).toContain('Settings')
  })

  it('rejects unknown subcommands with usage text', async () => {
    mock.route('GET', '/api/', (req, res, helpers) =>
      helpers.json({}, { 'Zotero-API-Version': '3' }),
    )
    const { stub } = await bootContext(true)
    const definition = stub!.registered[0]!
    const result = (await definition.handler(invocation('open'))) as CommandResult
    expect(result).toEqual({ kind: 'error', text: 'Usage: /zotero status' })
  })
})

describe('prompt section', () => {
  it('contributes the zotero policy section at order 106', async () => {
    const { ctx } = await bootContext(true)
    const assembly = await ctx.systemPrompt.assemble()
    const section = assembly.sections.find((entry) => entry.name === 'zotero:policy')
    expect(section).toBeDefined()
    // Assemblies expose name/text only; order is observed through position —
    // 106 lands after the identity/persona sections that open the prompt.
    expect(assembly.sections.map((entry) => entry.name).indexOf('zotero:policy')).toBeGreaterThan(0)
    expect(ZOTERO_PROMPT_SECTION_ORDER).toBe(106)
    for (const tool of [
      'zotero_search',
      'zotero_get',
      'zotero_retrieve',
      'zotero_attachment',
      'zotero_export',
    ]) {
      expect(section!.text).toContain(tool)
    }
    expect(section!.text).toContain('zotero://user/0/item/')
    expect(section!.text).toContain('never invent page numbers')
    expect(section!.text).toContain('use the Zotero tools only when the user explicitly asks')
    expect(section!.text).toContain(
      'On connectivity failures (Zotero not running, local API disabled, unsupported API version, timeout), the plugin asks you how to proceed with a recommended action',
    )
    // Library content is untrusted data, never instructions (prompt-injection
    // hardening for titles, notes, annotations, full text, URLs, exports).
    expect(section!.text).toContain('untrusted research data')
  })

  it('states the live tool caps the model must stay within', async () => {
    const { ctx } = await bootContext(true)
    const assembly = await ctx.systemPrompt.assemble()
    const section = assembly.sections.find((entry) => entry.name === 'zotero:policy')
    expect(section!.text).toContain('zotero_search limit up to 20')
    expect(section!.text).toContain('zotero_retrieve passages up to 4')
    expect(section!.text).toContain('zotero_export refs up to 50')
    expect(section!.text).toContain('Exceeding a cap errors')
    expect(section!.text).toContain('noteMatches')
  })

  it('tracks config edits in the assembled cap values', async () => {
    const { ctx } = await bootContext(true, {
      maxSearchResults: 30,
      maxEvidencePassages: 6,
      maxExportRefs: 50,
    })
    const assembly = await ctx.systemPrompt.assemble()
    const section = assembly.sections.find((entry) => entry.name === 'zotero:policy')
    expect(section!.text).toContain('zotero_search limit up to 30')
    expect(section!.text).toContain('zotero_retrieve passages up to 6')
    expect(section!.text).toContain('zotero_export refs up to 50')
    expect(section!.text).not.toContain('limit up to 20')
  })
})

describe('disposal unwinds registrations', () => {
  it('removes tools, the prompt section, and the command when the plugin fiber is disposed', async () => {
    const { ctx, stub, zoteroFiber } = await bootContext(true)
    expect(ctx.tools.get('zotero_search')).toBeDefined()
    expect(
      (await ctx.systemPrompt.assemble()).sections.some((entry) => entry.name === 'zotero:policy'),
    ).toBe(true)
    expect(stub!.registered.map((definition) => definition.name)).toEqual(['zotero'])

    await zoteroFiber.dispose()

    expect(ctx.get('zotero')).toBeUndefined()
    expect(ctx.tools.get('zotero_search')).toBeUndefined()
    expect(ctx.tools.get('zotero_export')).toBeUndefined()
    expect(
      (await ctx.systemPrompt.assemble()).sections.some((entry) => entry.name === 'zotero:policy'),
    ).toBe(false)
    expect(stub!.registered).toEqual([])
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
      search: async () => {
        throw new Error('test double: must not be called')
      },
      getItem: async () => {
        throw new Error('test double: must not be called')
      },
      getAttachmentLocation: async () => {
        throw new Error('test double: must not be called')
      },
      retrieve: async () => {
        throw new Error('test double: must not be called')
      },
      export: async () => {
        throw new Error('test double: must not be called')
      },
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
      search: async () => {
        throw new Error('test double: must not be called')
      },
      getItem: async () => {
        throw new Error('test double: must not be called')
      },
      getAttachmentLocation: async () => {
        throw new Error('test double: must not be called')
      },
      retrieve: async () => {
        throw new Error('test double: must not be called')
      },
      export: async () => {
        throw new Error('test double: must not be called')
      },
    }
    const dispose = service.registerProvider(foreign)
    dispose()
    // The service still resolves its configured 'local' provider; 'foreign' is gone from the registry.
    mock.route('GET', '/api/', (req, res, helpers) =>
      helpers.json({}, { 'Zotero-API-Version': '3' }),
    )
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
      search: async () => {
        throw new Error('test double: must not be called')
      },
      getItem: async () => {
        throw new Error('test double: must not be called')
      },
      getAttachmentLocation: async () => {
        throw new Error('test double: must not be called')
      },
      retrieve: async () => {
        throw new Error('test double: must not be called')
      },
      export: async () => {
        throw new Error('test double: must not be called')
      },
    })
    let thrown: unknown
    try {
      await service.search({
        scope: { kind: 'library' },
        mode: 'metadata',
        sort: 'dateModified',
        direction: 'desc',
        offset: 0,
        limit: 5,
      })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ZoteroError)
    expect((thrown as ZoteroError).code).toBe(ZOTERO_CAPABILITY_UNAVAILABLE)
    expect((thrown as ZoteroError).message).toContain('search')
  })

  it('refuses export on a provider without the citation capability', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime, {})
    await ctx.plugin(ZoteroService, { baseUrl: mock.baseUrl, provider: 'nocite' })
    const service = ctx.get('zotero') as ZoteroService
    service.registerProvider({
      id: 'nocite',
      capabilities: new Set(['metadata']),
      status: async () => ({ providerId: 'nocite', connected: true, diagnosis: 'ok' }),
      search: async () => {
        throw new Error('test double: must not be called')
      },
      getItem: async () => {
        throw new Error('test double: must not be called')
      },
      getAttachmentLocation: async () => {
        throw new Error('test double: must not be called')
      },
      retrieve: async () => {
        throw new Error('test double: must not be called')
      },
      export: async () => {
        throw new Error('test double: must not be called')
      },
    })
    let thrown: unknown
    try {
      await service.export({ refs: [parseRef('zotero://user/0/item/ABCD1234')], format: 'bibtex' })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ZoteroError)
    expect((thrown as ZoteroError).code).toBe(ZOTERO_CAPABILITY_UNAVAILABLE)
    expect((thrown as ZoteroError).message).toContain('citation')
  })

  it('refuses get and attachment on a search-only provider', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime, {})
    await ctx.plugin(ZoteroService, { baseUrl: mock.baseUrl, provider: 'searchonly' })
    const service = ctx.get('zotero') as ZoteroService
    service.registerProvider({
      id: 'searchonly',
      capabilities: new Set(['search']),
      status: async () => ({ providerId: 'searchonly', connected: true, diagnosis: 'ok' }),
      search: async () => {
        throw new Error('test double: must not be called')
      },
      getItem: async () => {
        throw new Error('test double: must not be called')
      },
      getAttachmentLocation: async () => {
        throw new Error('test double: must not be called')
      },
      retrieve: async () => {
        throw new Error('test double: must not be called')
      },
      export: async () => {
        throw new Error('test double: must not be called')
      },
    })
    const attempts: [string, Promise<unknown>][] = [
      [
        'metadata',
        service.get({ ref: parseRef('zotero://user/0/item/ABCD1234'), include: new Set() }),
      ],
      ['attachments', service.attachment(parseRef('zotero://user/0/attachment/WXYZ6789'))],
    ]
    for (const [capability, attempt] of attempts) {
      let thrown: unknown
      try {
        await attempt
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(ZoteroError)
      expect((thrown as ZoteroError).code).toBe(ZOTERO_CAPABILITY_UNAVAILABLE)
      expect((thrown as ZoteroError).message).toContain(capability)
    }
  })
})
