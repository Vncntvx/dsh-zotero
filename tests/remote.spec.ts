/**
 * The zotero Remote service: the settings page's data channel. The three
 * endpoints read the namespace view, merge a user-layer patch, and clear one
 * field — all through the local settings seam, so validation and revision
 * fencing behave exactly as they do for any other settings write.
 * @module tests/remote
 */

import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import ZoteroService from '../src/index.js'
import { Config as ConfigSchema } from '../src/config.js'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { ZoteroRuntime } from '../src/remote.js'
import { TYPERT_MANIFEST } from '../src/typert.js'
import { MemorySettings } from './helpers/memory-settings.js'
import { MockZotero } from './helpers/mock-zotero.js'

let ctx: Context | undefined

async function boot(options: { baseUrl: string; doc?: Record<string, unknown> }) {
  const context = new Context()
  await context.plugin(SystemPrompt, {})
  await context.plugin(ToolRuntime, {})
  // Typert composes before the plugin so the manifest registration fires
  // while the service is mounting (the optional inject waits for it).
  await context.plugin(TypertRegistry)
  await context.plugin(MemorySettings, options.doc)
  await context.plugin(ZoteroService, { baseUrl: options.baseUrl })
  return context
}

describe('the zotero Remote service', () => {
  afterEach(async () => {
    await ctx?.fiber.dispose()
    ctx = undefined
  })

  it('serves the namespace view with its layers and revision', async () => {
    ctx = await boot({ baseUrl: 'http://127.0.0.1:23119/api' })
    const runtime = ctx.get('zoteroRemote') as ZoteroRuntime
    const view = await runtime.config()
    expect(view.available).toBe(true)
    expect(view.writable).toBe(true)
    expect(view.value).toMatchObject({
      baseUrl: 'http://127.0.0.1:23119/api',
      timeoutMs: 5000,
      maxSearchResults: 20,
    })
    expect(view.base).toMatchObject({ baseUrl: 'http://127.0.0.1:23119/api' })
    expect(view.user).toBeUndefined()
    expect(view.revision).toBe(0)
  })

  it('merges a patch into the user layer and reports the new view', async () => {
    ctx = await boot({ baseUrl: 'http://127.0.0.1:23119/api' })
    const runtime = ctx.get('zoteroRemote') as ZoteroRuntime
    const first = await runtime.config()
    const second = await runtime.configUpdate({ timeoutMs: 7000 }, first.revision)
    expect(second.user).toEqual({ timeoutMs: 7000 })
    expect(second.value).toMatchObject({ timeoutMs: 7000 })
    expect(second.revision).toBe((first.revision ?? 0) + 1)
  })

  it('refuses a patch that violates the config constraints', async () => {
    ctx = await boot({ baseUrl: 'http://127.0.0.1:23119/api' })
    const runtime = ctx.get('zoteroRemote') as ZoteroRuntime
    const first = await runtime.config()
    await expect(
      runtime.configUpdate({ baseUrl: 'http://example.com/api' }, first.revision),
    ).rejects.toThrow(/loopback/)
    const after = await runtime.config()
    expect(after.user).toBeUndefined()
  })

  it('refuses a stale revision with a conflict', async () => {
    ctx = await boot({ baseUrl: 'http://127.0.0.1:23119/api' })
    const runtime = ctx.get('zoteroRemote') as ZoteroRuntime
    const first = await runtime.config()
    await runtime.configUpdate({ timeoutMs: 7000 }, first.revision)
    await expect(runtime.configUpdate({ timeoutMs: 8000 }, first.revision)).rejects.toThrow(
      /revision/i,
    )
  })

  it('clears one field so it re-inherits the composition layer', async () => {
    ctx = await boot({ baseUrl: 'http://127.0.0.1:23119/api' })
    const runtime = ctx.get('zoteroRemote') as ZoteroRuntime
    const first = await runtime.config()
    // Clearing without any user layer exercises the empty-section fallback.
    const empty = await runtime.configClear('provider', first.revision)
    expect(empty.user).toEqual({})
    const patched = await runtime.configUpdate({ timeoutMs: 7000 }, empty.revision)
    const cleared = await runtime.configClear('timeoutMs', patched.revision)
    // The wholesale replace stores an empty user layer — the raw document
    // carries no field for the cleared key, which is what marks it inherited.
    expect(cleared.user).toEqual({})
    expect(cleared.value).toMatchObject({ timeoutMs: 5000 })
  })

  it('reports unavailable while no settings service composes the namespace', async () => {
    const context = new Context()
    const runtime = new ZoteroRuntime(context)
    const view = await runtime.config()
    expect(view.available).toBe(false)
    expect(view.writable).toBe(false)
    await expect(runtime.configUpdate({ timeoutMs: 7000 })).rejects.toThrow(/not composed/)
    await expect(runtime.configClear('timeoutMs')).rejects.toThrow(/not composed/)
    await context.fiber.dispose()
  })

  it('reports unavailable when the settings service lacks the namespace', async () => {
    const context = new Context()
    await context.plugin(MemorySettings, {})
    const runtime = new ZoteroRuntime(context)
    const view = await runtime.config()
    expect(view.available).toBe(false)
    expect(view.writable).toBe(false)
    await expect(runtime.configClear('timeoutMs')).rejects.toThrow(/not composed/)
    await context.fiber.dispose()
  })

  it('omits layers the registration never declared', async () => {
    const context = new Context()
    await context.plugin(MemorySettings, {})
    // Registered without a composition base: the view carries value and
    // revision but no base or user layers.
    context.settings.register(settingsNamespace('zotero'), ConfigSchema)
    const runtime = new ZoteroRuntime(context)
    const view = await runtime.config()
    expect(view.available).toBe(true)
    expect(view.value).toMatchObject({ timeoutMs: 5000 })
    expect(view.base).toBeUndefined()
    expect(view.user).toBeUndefined()
    await context.fiber.dispose()
  })

  it('claims the wire endpoints through the typert registry when one composes', async () => {
    ctx = await boot({ baseUrl: 'http://127.0.0.1:23119/api' })
    for (const invocation of TYPERT_MANIFEST.invocations) {
      // The registry keys endpoints as `<namespace>/<method>`.
      expect(ctx.typert.local.get(`zotero/${invocation.method}`)).toMatchObject({
        namespace: 'zotero',
        method: invocation.method,
      })
    }
    const record = ctx.typert.getPackage('dsh-zotero')
    expect(record?.model.services[0]?.key).toBe('zoteroRemote')
  })
})

describe('the zotero status endpoint', () => {
  afterEach(async () => {
    await ctx?.fiber.dispose()
    ctx = undefined
  })

  it('serves the connectivity view with every reported fact', async () => {
    const mock = await MockZotero.start()
    mock.route('GET', '/api/', (_req, _res, helpers) =>
      helpers.json(
        {},
        { 'Zotero-API-Version': '3', 'Zotero-Schema-Version': '37', 'Zotero-Server-ID': 'S1' },
      ),
    )
    ctx = await boot({ baseUrl: mock.baseUrl })
    const runtime = ctx.get('zoteroRemote') as ZoteroRuntime
    await expect(runtime.status()).resolves.toEqual({
      providerId: 'local',
      connected: true,
      apiVersion: '3',
      schemaVersion: '37',
      serverId: 'S1',
      diagnosis: 'ok',
    })
    await mock.close()
  })

  it('strips absent optional facts and converges failures into the view', async () => {
    const mock = await MockZotero.start()
    mock.route('GET', '/api/', (_req, _res, helpers) => helpers.raw(503, {}, 'down'))
    ctx = await boot({ baseUrl: mock.baseUrl })
    const runtime = ctx.get('zoteroRemote') as ZoteroRuntime
    const status = await runtime.status()
    expect(status.connected).toBe(false)
    expect(status.apiVersion).toBeUndefined()
    expect(status.serverId).toBeUndefined()
    expect(status.schemaVersion).toBeUndefined()
    expect(status.diagnosis).not.toBe('')
    await mock.close()
  })

  it('reports unavailable without the zotero service composed', async () => {
    const context = new Context()
    await context.plugin(TypertRegistry)
    await context.plugin(MemorySettings, {})
    new ZoteroRuntime(context)
    await expect(context.get('zoteroRemote')!.status()).resolves.toEqual({
      providerId: 'zotero',
      connected: false,
      diagnosis: 'The Zotero service is not composed.',
    })
    await context.fiber.dispose()
  })
})

describe('the zotero typert manifest', () => {
  it('declares the settings and status endpoints under the zotero namespace', () => {
    expect(TYPERT_MANIFEST.package).toBe('dsh-zotero')
    expect(TYPERT_MANIFEST.face).toBe('host')
    expect(TYPERT_MANIFEST.invocations.map((invocation) => invocation.method)).toEqual([
      'status',
      'config',
      'configUpdate',
      'configClear',
    ])
    for (const invocation of TYPERT_MANIFEST.invocations) {
      expect(invocation.namespace).toBe('zotero')
      expect(invocation.service).toBe('zoteroRemote')
    }
    const status = TYPERT_MANIFEST.invocations.find((invocation) => invocation.method === 'status')
    expect(status?.result).toMatchObject({
      mode: 'strict',
      typeSymbol: 'dsh-zotero#ZoteroStatusView',
    })
    for (const invocation of TYPERT_MANIFEST.invocations.filter(
      (entry) => entry.method !== 'status',
    )) {
      expect(invocation.result).toMatchObject({
        mode: 'strict',
        typeSymbol: 'dsh-zotero#ZoteroConfigView',
      })
    }
  })
})
