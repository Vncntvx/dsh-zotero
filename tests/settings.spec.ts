/**
 * Settings-namespace behavior: the `zotero` section registers against the
 * settings seam with the composition entry as its base, and every committed
 * edit live-applies — the transport rebuilds, provider selection and tool
 * limits follow, and a write that violates the config constraints is refused
 * before it reaches storage.
 * @module tests/settings
 */

import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import ZoteroService from '../src/index.js'
import { ZOTERO_PROVIDER_UNAVAILABLE } from '../src/errors.js'
import { MemorySettings } from './helpers/memory-settings.js'
import { MockZotero } from './helpers/mock-zotero.js'

let mock: MockZotero | undefined
let ctx: Context | undefined
let callCounter = 0

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  await mock?.close()
  mock = undefined
})

/** Wait for the settings commit's watcher chain (rebuild) to settle. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function boot(options: { baseUrl: string; doc?: Record<string, unknown> }) {
  const context = new Context()
  await context.plugin(SystemPrompt, {})
  await context.plugin(ToolRuntime, {})
  await context.plugin(MemorySettings, options.doc)
  await context.plugin(ZoteroService, { baseUrl: options.baseUrl })
  return context
}

type ToolExecution = ReturnType<Context['tools']['execute']>

function runTool(name: string, args: Record<string, unknown>): ToolExecution {
  // The module-level ctx is assigned before any test invokes this helper.
  const tools = ctx as Context
  return tools.tools.execute({
    callId: CallId(`settings-tool-${++callCounter}`),
    name,
    arguments: args,
    signal: new AbortController().signal,
  })
}

describe('the zotero settings namespace', () => {
  it('registers with the Config schema and the composition entry as its base', async () => {
    ctx = await boot({ baseUrl: 'http://127.0.0.1:1/api' })
    const resolved = ctx.settings.get(settingsNamespace('zotero')) as Record<string, unknown>
    expect(resolved.baseUrl).toBe('http://127.0.0.1:1/api')
    expect(resolved.timeoutMs).toBe(5000)
    expect(resolved.maxSearchResults).toBe(20)
    const scope = ctx.zotero
    expect(scope.config.baseUrl).toBe('http://127.0.0.1:1/api')
    expect(scope.config.timeoutMs).toBe(5000)
  })

  it('honors a stored section from the settings document at boot', async () => {
    ctx = await boot({
      baseUrl: 'http://127.0.0.1:1/api',
      doc: { zotero: { timeoutMs: 7000, maxSearchResults: 5 } },
    })
    expect(ctx.zotero.config.timeoutMs).toBe(7000)
    expect(ctx.zotero.config.maxSearchResults).toBe(5)
  })

  it('live-applies a baseUrl edit by rebuilding the transport', async () => {
    mock = await MockZotero.start()
    mock.route('GET', '/api/', (req, res, helpers) =>
      helpers.json({}, { 'Zotero-Server-ID': 'S1', 'Zotero-API-Version': '3' }),
    )
    ctx = await boot({ baseUrl: 'http://127.0.0.1:1/api' })
    expect((await ctx.zotero.status()).connected).toBe(false)
    await ctx.settings.update(settingsNamespace('zotero'), { baseUrl: mock.baseUrl })
    await flush()
    const status = await ctx.zotero.status()
    expect(status.connected).toBe(true)
    expect(status.serverId).toBe('S1')
    expect(mock.requests.length).toBeGreaterThan(0)
  })

  it('refuses a write that violates the config constraints', async () => {
    ctx = await boot({ baseUrl: 'http://127.0.0.1:1/api' })
    await expect(
      ctx.settings.update(settingsNamespace('zotero'), { baseUrl: 'http://example.com/api' }),
    ).rejects.toThrow(/loopback/)
    expect(ctx.zotero.config.baseUrl).toBe('http://127.0.0.1:1/api')
  })

  it('live-applies a provider selection change', async () => {
    mock = await MockZotero.start()
    ctx = await boot({ baseUrl: mock.baseUrl })
    await ctx.settings.update(settingsNamespace('zotero'), { provider: 'missing' })
    await flush()
    await expect(
      ctx.zotero.search({
        scope: { kind: 'library' },
        mode: 'metadata',
        sort: 'dateModified',
        direction: 'desc',
        offset: 0,
        limit: 5,
      }),
    ).rejects.toMatchObject({ code: ZOTERO_PROVIDER_UNAVAILABLE })
  })

  it('live-applies a tool validation limit', async () => {
    ctx = await boot({ baseUrl: 'http://127.0.0.1:1/api' })
    await ctx.settings.update(settingsNamespace('zotero'), { maxSearchResults: 5 })
    await flush()
    const result = await runTool('zotero_search', { query: 'x', limit: 10 })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect((result.content[0] as { text: string }).text).toContain(
      'limit must be an integer between 1 and 5',
    )
  })
})
