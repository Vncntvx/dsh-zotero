/**
 * The zotero Remote service: the dedicated web tab's connectivity probe. The
 * configuration surface reads and writes the namespace through the shared
 * configuration form instead, so the Remote carries only `status` — the one
 * fact the settings plane does not.
 * @module tests/remote
 */

import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { afterEach, describe, expect, it } from 'vitest'
import { ZoteroRuntime } from '../../src/remote.js'
import { ZOTERO_STATUS_SERVICE_KEY } from '../../src/contract.js'
import { TYPERT_MANIFEST } from '../../src/typert.js'
import { type HostLane, setupHostLane } from '../helpers/lanes/host-lane.js'

/** The lane the current test booted; `afterEach` releases it. */
let lane: HostLane | undefined

afterEach(async () => {
  await lane?.ctx.fiber.dispose()
  await lane?.teardown()
  lane = undefined
})

describe('the zotero status endpoint', () => {
  it('serves the connectivity view with every reported fact', async () => {
    lane = await setupHostLane(undefined, { typert: true })
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
    lane = await setupHostLane({ writeEnabled: true }, { typert: true })
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
    lane = await setupHostLane(undefined, { typert: true })
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
    // Strict codecs carry a lazy factory (TypertCodec.create).
    expect(typeof (status?.result as { create?: unknown } | undefined)?.create).toBe('function')
  })

  it('materializes the host status schema through create()', () => {
    const status = TYPERT_MANIFEST.invocations.find((invocation) => invocation.method === 'status')
    const result = status?.result as
      { create: () => { parse: (value: unknown) => unknown } } | undefined
    expect(result).toBeDefined()
    const schema = result!.create()
    const valid = schema.parse({
      providerId: 'local',
      connected: true,
      diagnosis: 'ok',
    })
    expect(valid).toMatchObject({ providerId: 'local', connected: true, diagnosis: 'ok' })
    expect(() => schema.parse({ providerId: 'local', connected: 'yes', diagnosis: 'ok' })).toThrow()
  })

  it('carries no live schema beside create', () => {
    // Single-arm strict codec: the host materializes through `create()` and
    // carries no live `schema` property.
    const status = TYPERT_MANIFEST.invocations.find((invocation) => invocation.method === 'status')
    const result = status?.result as { schema?: unknown; create?: unknown } | undefined
    expect(typeof result?.create).toBe('function')
    expect(result).not.toHaveProperty('schema')
  })

  it('matches the client contribution structural identity exactly', async () => {
    const { ZOTERO_REMOTE } = await import('../../src/client/remote.ts')
    const { TYPERT_MANIFEST: host } = await import('../../src/typert.ts')
    const hostStatus = host.invocations.find((invocation) => invocation.method === 'status')
    const clientStatus = ZOTERO_REMOTE.descriptors.find(
      (invocation) => invocation.method === 'status',
    )
    expect(clientStatus).toBeDefined()
    expect(clientStatus).toMatchObject({
      id: hostStatus?.id,
      service: hostStatus?.service,
      namespace: hostStatus?.namespace,
      method: hostStatus?.method,
      invocation: hostStatus?.invocation,
      parameters: [],
    })
    const clientResult = clientStatus?.result as { mode?: string; typeSymbol?: string } | undefined
    expect(clientResult).toMatchObject({
      mode: hostStatus?.result && 'mode' in hostStatus.result ? hostStatus.result.mode : undefined,
      typeSymbol:
        hostStatus?.result && 'typeSymbol' in hostStatus.result
          ? hostStatus.result.typeSymbol
          : undefined,
    })
  })

  it('refuses browser-side materialization of the host-owned status codec', async () => {
    const { ZOTERO_REMOTE } = await import('../../src/client/remote.ts')
    const { HOST_OWNED_CODEC_MESSAGE } = await import('../../src/client/status-codec.ts')
    const status = ZOTERO_REMOTE.descriptors.find((invocation) => invocation.method === 'status')
    const result = status?.result as { create?: () => unknown } | undefined
    expect(typeof result?.create).toBe('function')
    expect(() => result!.create!()).toThrow(HOST_OWNED_CODEC_MESSAGE)
  })

  it('claims the wire endpoint through the typert registry when one composes', async () => {
    lane = await setupHostLane({ baseUrl: 'http://127.0.0.1:23119/api' }, { typert: true })
    for (const invocation of TYPERT_MANIFEST.invocations) {
      // The registry keys endpoints as `<namespace>/<method>`.
      expect(lane.ctx.typert.local.get(`zotero/${invocation.method}`)).toMatchObject({
        namespace: 'zotero',
        method: invocation.method,
      })
    }
    const record = lane.ctx.typert.getPackage('dsh-zotero')
    expect(record?.model.services[0]?.key).toBe(ZOTERO_STATUS_SERVICE_KEY)
  })
})
