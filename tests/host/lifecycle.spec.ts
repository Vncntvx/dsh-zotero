import { CommandId, type CommandInvocation, type CommandResult } from '@deepseek-ai/dsh-commands'
import { readFileSync } from 'node:fs'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it } from 'vitest'
import ZoteroService from '../../src/index.js'
import {
  NOT_RUNNING_MESSAGE,
  ZOTERO_CAPABILITY_UNAVAILABLE,
  ZOTERO_PROVIDER_UNAVAILABLE,
  ZoteroError,
} from '../../src/errors.js'
import {
  ZOTERO_STATUS_CONNECTED,
  ZOTERO_STATUS_DISCONNECTED,
  ZOTERO_STATUS_SERVER_ID_UNREPORTED,
  ZOTERO_USAGE_MESSAGE,
  statusLine,
} from '../../src/command.js'
import { parseRef } from '../../src/refs.js'
import {
  CONNECTIVITY_POLICY_SENTENCE,
  ZOTERO_PROMPT_ANCHOR,
  ZOTERO_PROMPT_ORDER_OFFSET,
} from '../../src/prompt.js'
import type { ZoteroProvider } from '../../src/types.js'
import { type HostLane, setupHostLane } from '../helpers/lanes/host-lane.js'
import { ZOTERO_TOOL_NAMES } from '../helpers/tool-names.js'

/** The lane the current test booted; `afterEach` releases it. */
let lane: HostLane | undefined

afterEach(async () => {
  await lane?.ctx.fiber.dispose()
  await lane?.teardown()
  lane = undefined
})

function invocation(
  rawInput: string,
  signal: AbortSignal = new AbortController().signal,
): CommandInvocation {
  return {
    commandId: CommandId('test-command'),
    agent: {} as never,
    rawInput,
    signal,
    attachments: [],
  }
}

describe('ZoteroService lifecycle', () => {
  it('provides ctx.zotero and removes it when its fiber is disposed', async () => {
    lane = await setupHostLane(undefined, { commands: true })
    const { ctx, zoteroFiber } = lane
    expect(ctx.get('zotero')).toBeInstanceOf(ZoteroService)
    await zoteroFiber.dispose()
    expect(ctx.get('zotero')).toBeUndefined()
  })

  it('registers the zotero command only when a command registry exists', async () => {
    lane = await setupHostLane(undefined, { commands: true })
    expect(lane.stub!.registered.map((definition) => definition.name)).toEqual(['zotero'])

    // This lane is released here; `lane` above is the one `afterEach` tears down.
    const withoutCommands = await setupHostLane()
    // The plugin still loads fine; there is just no command registry to register into.
    expect(withoutCommands.ctx.get('zotero')).toBeInstanceOf(ZoteroService)
    await withoutCommands.ctx.fiber.dispose()
    await withoutCommands.teardown()
  })

  it('brands the definitionId through the CommandDefinitionId constructor', async () => {
    lane = await setupHostLane(undefined, { commands: true })
    const definition = lane.stub!.registered[0]!
    // The brand constructor is an identity function; the wire value is the string.
    expect(definition.definitionId).toBe('dsh-zotero/status')
  })

  it('ships lib/command.js with a value import of CommandDefinitionId', () => {
    const built = readFileSync(new URL('../../lib/command.js', import.meta.url), 'utf8')
    expect(built).toMatch(/import\s*\{[^}]*CommandDefinitionId/)
    expect(built).toContain('dsh-zotero/status')
  })

  it('never touches Zotero while loading or disposing — the plugin is request-driven only', async () => {
    lane = await setupHostLane(undefined, { commands: true })
    expect(lane.mock.requests).toEqual([])
    await lane.zoteroFiber.dispose()
    expect(lane.mock.requests).toEqual([])

    // The second composition observes its own server, so a request made while
    // loading or disposing shows up in the lane that made it.
    const withoutCommands = await setupHostLane()
    expect(withoutCommands.mock.requests).toEqual([])
    await withoutCommands.zoteroFiber.dispose()
    expect(withoutCommands.mock.requests).toEqual([])
    await withoutCommands.ctx.fiber.dispose()
    await withoutCommands.teardown()
  })
})

describe('/zotero status command', () => {
  it('reports a connected instance with the build that answered', async () => {
    lane = await setupHostLane(undefined, { commands: true })
    lane.mock.route('GET', '/api/', (req, res, helpers) =>
      helpers.json(
        {},
        {
          'Zotero-API-Version': '3',
          'Zotero-Schema-Version': '25',
          'Zotero-Server-ID': 'sPMHtLD6HHBd',
          'X-Zotero-Version': '10.0.2-beta.9+c77df79af',
        },
      ),
    )
    const definition = lane.stub!.registered[0]!
    const result = (await definition.handler(invocation('status'))) as CommandResult
    expect(result.kind).toBe('success')
    if (result.kind !== 'success') throw new Error('unreachable')
    expect(result.text).toContain(ZOTERO_STATUS_CONNECTED)
    expect(result.text).toContain(statusLine('API version', '3'))
    expect(result.text).toContain(statusLine('Schema version', '25'))
    expect(result.text).toContain(statusLine('Server ID', 'sPMHtLD6HHBd'))
    // The build header is the only version fact that names a release, so the
    // command reports it rather than leaving the answering Zotero unnamed.
    expect(result.text).toContain(statusLine('Zotero version', '10.0.2-beta.9+c77df79af'))
  })

  it('reports a missing Server-ID and missing headers as a degraded instance without failing', async () => {
    lane = await setupHostLane(undefined, { commands: true })
    lane.mock.route('GET', '/api/', (req, res, helpers) => helpers.json({}))
    const definition = lane.stub!.registered[0]!
    const result = (await definition.handler(invocation('status'))) as CommandResult
    expect(result.kind).toBe('success')
    if (result.kind !== 'success') throw new Error('unreachable')
    expect(result.text).toContain(ZOTERO_STATUS_CONNECTED)
    expect(result.text).toContain(statusLine('Zotero version', undefined))
    expect(result.text).toContain(statusLine('API version', undefined))
    expect(result.text).toContain(statusLine('Schema version', undefined))
    expect(result.text).toContain(ZOTERO_STATUS_SERVER_ID_UNREPORTED)
  })

  it('reports a disconnected Zotero with the actionable diagnosis', async () => {
    lane = await setupHostLane(undefined, { commands: true })
    // The plugin makes no request while loading, so closing the mock after the
    // mount leaves the same dead endpoint this command has always probed.
    await lane.mock.close()
    const definition = lane.stub!.registered[0]!
    const result = (await definition.handler(invocation('status'))) as CommandResult
    expect(result.kind).toBe('success')
    if (result.kind !== 'success') throw new Error('unreachable')
    expect(result.text).toContain(ZOTERO_STATUS_DISCONNECTED)
    expect(result.text).toContain(NOT_RUNNING_MESSAGE)
  })

  it('rejects unknown subcommands with usage text', async () => {
    lane = await setupHostLane(undefined, { commands: true })
    lane.mock.route('GET', '/api/', (req, res, helpers) =>
      helpers.json({}, { 'Zotero-API-Version': '3' }),
    )
    const definition = lane.stub!.registered[0]!
    const result = (await definition.handler(invocation('open'))) as CommandResult
    expect(result).toEqual({ kind: 'error', text: ZOTERO_USAGE_MESSAGE })
  })
})

describe('prompt section', () => {
  it('contributes the zotero policy section after the first-party tool band', async () => {
    lane = await setupHostLane(undefined, { commands: true })
    const assembly = await lane.ctx.systemPrompt.assemble()
    const section = assembly.sections.find((entry) => entry.name === 'zotero:policy')
    expect(section).toBeDefined()
    // Assemblies expose name/text only; order is observed through position —
    // the policy lands after the identity/persona sections that open the
    // prompt and after every first-party per-tool section it complements.
    const names = assembly.sections.map((entry) => entry.name)
    expect(names.indexOf('zotero:policy')).toBeGreaterThan(0)
    // The pin guards the plugin-owned derivation (anchor + offset), not the
    // harness table: the anchor is the central placement name, the offset is
    // half the gap to the next first-party placement — 2900 + 50 = 2950 lands
    // between TOOL_REPORT and TOOL_COMPUTER_USE (3000) instead of colliding
    // with it. Either drifting fails here instead of passing by restatement.
    expect(ZOTERO_PROMPT_ANCHOR).toBe('TOOL_REPORT')
    expect(ZOTERO_PROMPT_ORDER_OFFSET).toBe(50)
    expect(lane.ctx.systemPrompt.getSectionOrder(ZOTERO_PROMPT_ANCHOR)).toBe(2900)
    for (const tool of ZOTERO_TOOL_NAMES) {
      expect(section!.text).toContain(tool)
    }
    expect(section!.text).toContain('zotero://user/0/item/')
    expect(section!.text).toContain('never invent page numbers')
    expect(section!.text).toContain('use the Zotero tools only when the user explicitly asks')
    expect(section!.text).toContain(CONNECTIVITY_POLICY_SENTENCE)
    // Library content is untrusted data, never instructions (prompt-injection
    // hardening for titles, notes, annotations, full text, URLs, exports).
    expect(section!.text).toContain('untrusted research data')
  })

  it('states the live tool caps the model must stay within', async () => {
    lane = await setupHostLane(undefined, { commands: true })
    const assembly = await lane.ctx.systemPrompt.assemble()
    const section = assembly.sections.find((entry) => entry.name === 'zotero:policy')
    expect(section!.text).toContain('zotero_search limit up to 20')
    expect(section!.text).toContain('zotero_retrieve passages up to 4')
    expect(section!.text).toContain('zotero_export refs up to 50')
    expect(section!.text).toContain('Exceeding a cap errors')
    expect(section!.text).toContain('supplemental')
  })

  it('tracks config edits in the assembled cap values', async () => {
    lane = await setupHostLane(
      { maxSearchResults: 30, maxEvidencePassages: 6, maxExportRefs: 50 },
      { commands: true },
    )
    const assembly = await lane.ctx.systemPrompt.assemble()
    const section = assembly.sections.find((entry) => entry.name === 'zotero:policy')
    expect(section!.text).toContain('zotero_search limit up to 30')
    expect(section!.text).toContain('zotero_retrieve passages up to 6')
    expect(section!.text).toContain('zotero_export refs up to 50')
    expect(section!.text).not.toContain('limit up to 20')
  })
})

describe('disposal unwinds registrations', () => {
  it('lets an in-flight request finish on its own deadline after the plugin is disposed', async () => {
    // Disposing the plugin does not abort a request that is already out: the
    // harness cancels a tool call through the caller's own signal, and nothing
    // unwinds it on unload. What has to hold is that such a request cannot
    // hang the host — the provider deadline ends it, so a reload leaves no
    // work waiting forever.
    lane = await setupHostLane({ timeoutMs: 60 }, { commands: true })
    lane.mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.delayJson({ key: 'ABCD1234', data: {} }, 5000),
    )
    const pending = lane.ctx.tools.execute({
      callId: ToolCallId('lifecycle-in-flight'),
      name: 'zotero_get',
      arguments: { ref: 'zotero://user/0/item/ABCD1234' },
      signal: new AbortController().signal,
    })
    await lane.zoteroFiber.dispose()
    const result = await pending
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('ZOTERO_TIMEOUT')
  })

  it('removes tools, the prompt section, and the command when the plugin fiber is disposed', async () => {
    lane = await setupHostLane(undefined, { commands: true })
    const { ctx, stub, zoteroFiber } = lane
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
    lane = await setupHostLane({ provider: 'sqlite' })
    const service = lane.ctx.get('zotero') as ZoteroService
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
    lane = await setupHostLane(undefined, { commands: true })
    const service = lane.ctx.get('zotero') as ZoteroService
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
      children: async () => {
        throw new Error('test double: must not be called')
      },
      changes: async () => {
        throw new Error('test double: must not be called')
      },
      browse: async () => {
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
    lane = await setupHostLane(undefined, { commands: true })
    const service = lane.ctx.get('zotero') as ZoteroService
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
      children: async () => {
        throw new Error('test double: must not be called')
      },
      changes: async () => {
        throw new Error('test double: must not be called')
      },
      browse: async () => {
        throw new Error('test double: must not be called')
      },
    }
    const dispose = service.registerProvider(foreign)
    dispose()
    // The service still resolves its configured 'local' provider; 'foreign' is gone from the registry.
    lane.mock.route('GET', '/api/', (req, res, helpers) =>
      helpers.json({}, { 'Zotero-API-Version': '3' }),
    )
    const status = await service.status()
    expect(status.providerId).toBe('local')
  })
})

describe('capability gating', () => {
  it('refuses search when the configured provider lacks the capability', async () => {
    lane = await setupHostLane({ provider: 'limited' })
    const service = lane.ctx.get('zotero') as ZoteroService
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
      children: async () => {
        throw new Error('test double: must not be called')
      },
      changes: async () => {
        throw new Error('test double: must not be called')
      },
      browse: async () => {
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
    lane = await setupHostLane({ provider: 'nocite' })
    const service = lane.ctx.get('zotero') as ZoteroService
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
      children: async () => {
        throw new Error('test double: must not be called')
      },
      changes: async () => {
        throw new Error('test double: must not be called')
      },
      browse: async () => {
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

  it('refuses every capability a search-only provider does not declare', async () => {
    lane = await setupHostLane({ provider: 'searchonly' })
    const service = lane.ctx.get('zotero') as ZoteroService
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
      children: async () => {
        throw new Error('test double: must not be called')
      },
      changes: async () => {
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
      browse: async () => {
        throw new Error('test double: must not be called')
      },
    })
    const attempts: [string, Promise<unknown>][] = [
      [
        'metadata',
        service.get({ ref: parseRef('zotero://user/0/item/ABCD1234'), include: new Set() }),
      ],
      ['attachments', service.attachment(parseRef('zotero://user/0/attachment/WXYZ6789'))],
      [
        'metadata',
        service.children({
          ref: parseRef('zotero://user/0/item/ABCD1234'),
          include: new Set(),
        }),
      ],
      ['browse', service.browse({ kind: 'libraries', offset: 0, limit: 5 })],
      [
        'changes',
        service.changes({
          library: { type: 'user', id: 0 },
          since: {
            serverId: 'S1',
            library: { type: 'user', id: 0 },
            version: 1,
            include: ['items', 'collections', 'savedSearches', 'deleted'],
          },
        }),
      ],
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
