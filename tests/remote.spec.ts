/**
 * The zotero Remote service: the dedicated web tab's connectivity probe. The
 * configuration surface reads and writes the namespace through the harness's
 * settings scope instead, so the Remote carries only `status` — the one fact
 * the settings plane does not.
 * @module tests/remote
 */

import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import ZoteroService from '../src/index.js'
import { ZoteroRuntime } from '../src/remote.js'
import { TYPERT_MANIFEST } from '../src/typert.js'
import { MemorySettings } from './helpers/memory-settings.js'
import { MockZotero } from './helpers/mock-zotero.js'

let ctx: Context | undefined

async function boot(options: { baseUrl: string }) {
  const context = new Context()
  await context.plugin(SystemPrompt, {})
  await context.plugin(ToolRuntime, {})
  // Typert composes before the plugin so the manifest registration fires
  // while the service is mounting (the optional inject waits for it).
  await context.plugin(TypertRegistry)
  await context.plugin(MemorySettings)
  await context.plugin(ZoteroService, { baseUrl: options.baseUrl })
  return context
}

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
    await context.plugin(MemorySettings)
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
  it('declares the status endpoint under the zotero namespace', () => {
    expect(TYPERT_MANIFEST.package).toBe('dsh-zotero')
    expect(TYPERT_MANIFEST.face).toBe('host')
    expect(TYPERT_MANIFEST.invocations.map((invocation) => invocation.method)).toEqual(['status'])
    for (const invocation of TYPERT_MANIFEST.invocations) {
      expect(invocation.namespace).toBe('zotero')
      expect(invocation.service).toBe('zoteroRemote')
    }
    const status = TYPERT_MANIFEST.invocations.find((invocation) => invocation.method === 'status')
    expect(status?.result).toMatchObject({
      mode: 'strict',
      typeSymbol: 'dsh-zotero#ZoteroStatusView',
    })
  })

  it('claims the wire endpoint through the typert registry when one composes', async () => {
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
