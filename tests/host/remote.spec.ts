/**
 * The zotero Remote service: the dedicated web tab's connectivity probe. The
 * configuration surface reads and writes the namespace through the harness's
 * settings scope instead, so the Remote carries only `status` — the one fact
 * the settings plane does not.
 * @module tests/remote
 */

import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { afterEach, describe, expect, it } from 'vitest'
import { ZoteroRuntime } from '../../src/remote.js'
import { TYPERT_MANIFEST } from '../../src/typert.js'
import { type HostLane, setupHostLane } from '../helpers/lanes/host-lane.js'
import { MemorySettings } from '../helpers/memory-settings.js'

/** The lane the current test booted; `afterEach` releases it. */
let lane: HostLane | undefined

afterEach(async () => {
  await lane?.ctx.fiber.dispose()
  await lane?.teardown()
  lane = undefined
})

describe('the zotero status endpoint', () => {
  it('serves the connectivity view with every reported fact', async () => {
    lane = await setupHostLane(undefined, { settings: {}, typert: true })
    lane.mock.route('GET', '/api/', (_req, _res, helpers) =>
      helpers.json(
        {},
        { 'Zotero-API-Version': '3', 'Zotero-Schema-Version': '37', 'Zotero-Server-ID': 'S1' },
      ),
    )
    const runtime = lane.ctx.get('zoteroRemote') as ZoteroRuntime
    const status = await runtime.status()
    expect(status).toEqual({
      providerId: 'local',
      connected: true,
      apiVersion: '3',
      schemaVersion: '37',
      serverId: 'S1',
      diagnosis: 'ok',
    })
    // A provider that wires no write capability reports no write block; the
    // Remote must not invent one.
    expect(status.write).toBeUndefined()
  })

  it('forwards the provider write state the web tab status strip renders', async () => {
    lane = await setupHostLane({ writeEnabled: true }, { settings: {}, typert: true })
    lane.mock.route('GET', '/api/', (_req, _res, helpers) =>
      helpers.json({}, { 'Zotero-Server-ID': 'S-write' }),
    )
    const runtime = lane.ctx.get('zoteroRemote') as ZoteroRuntime
    await expect(runtime.status()).resolves.toMatchObject({
      providerId: 'local',
      connected: true,
      serverId: 'S-write',
      diagnosis: 'ok',
      // The capability is wired; no grant is stored yet.
      write: { enabled: true, authorized: false },
    })
  })

  it('strips absent optional facts and converges failures into the view', async () => {
    lane = await setupHostLane(undefined, { settings: {}, typert: true })
    lane.mock.route('GET', '/api/', (_req, _res, helpers) => helpers.raw(503, {}, 'down'))
    const runtime = lane.ctx.get('zoteroRemote') as ZoteroRuntime
    const status = await runtime.status()
    expect(status.connected).toBe(false)
    expect(status.apiVersion).toBeUndefined()
    expect(status.serverId).toBeUndefined()
    expect(status.schemaVersion).toBeUndefined()
    expect(status.diagnosis).not.toBe('')
  })

  it('reports unavailable without the zotero service composed', async () => {
    // Deliberately hand-built rather than a lane: the service being absent is
    // the composition under test, so no lane can boot it.
    const context = new Context()
    await context.plugin(TypertRegistry)
    await context.plugin(MemorySettings)
    new ZoteroRuntime(context)
    await expect(context.get('zoteroRemote')!.status()).resolves.toEqual({
      providerId: 'local',
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
    // Strict codecs carry a lazy factory (dsh 0.1.6: TypertCodec.create).
    expect(typeof (status?.result as { create?: unknown } | undefined)?.create).toBe('function')
  })

  it('claims the wire endpoint through the typert registry when one composes', async () => {
    lane = await setupHostLane(
      { baseUrl: 'http://127.0.0.1:23119/api' },
      { settings: {}, typert: true },
    )
    for (const invocation of TYPERT_MANIFEST.invocations) {
      // The registry keys endpoints as `<namespace>/<method>`.
      expect(lane.ctx.typert.local.get(`zotero/${invocation.method}`)).toMatchObject({
        namespace: 'zotero',
        method: invocation.method,
      })
    }
    const record = lane.ctx.typert.getPackage('dsh-zotero')
    expect(record?.model.services[0]?.key).toBe('zoteroRemote')
  })
})
