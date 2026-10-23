/**
 * The zotero Remote service: the dedicated web tab's connectivity probe. The
 * configuration surface reads and writes the namespace through the shared
 * configuration form instead, so the Remote carries only `status`: the one
 * fact the settings plane does not.
 * @module tests/remote
 */

import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { afterEach, describe, expect, it } from 'vitest'
import { ZoteroRuntime } from '../../src/remote.js'
import { ZOTERO_STATUS_SERVICE_KEY, type ZoteroDiagnosticEntry } from '../../src/contract.js'
import { TYPERT_MANIFEST } from '../../src/typert.js'
import { type HostLane, setupHostLane } from '../helpers/lanes/host-lane.js'

/** A signal that never aborts: direct calls pass the carrier signal the gateway would inject. */
const LIVE_SIGNAL = new AbortController().signal

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
    const status = await runtime.status(LIVE_SIGNAL)
    expect(status).toEqual({
      providerId: 'local',
      // The authority actually dialled, the mock server's own host:port, not
      // the configured default. The card's live refresh replaces the parsed
      // command text with this view, so an endpoint dropped here would blank
      // the row the user just refreshed.
      endpoint: new URL(lane.mock.baseUrl).host,
      connected: true,
      apiVersion: '3',
      schemaVersion: '37',
      serverId: 'S1',
    })
    // A connected probe has nothing to diagnose: the `ZOTERO_DIAGNOSIS_OK`
    // sentinel the host status carries is stripped at the wire, so the card
    // never renders a diagnosis box for a healthy service.
    expect(status.diagnosis).toBeUndefined()
    // A provider that wires no write capability reports no write block; the
    // Remote must not invent one.
    expect(status.write).toBeUndefined()
  })

  it('honors a pre-aborted carrier signal instead of doing the work', async () => {
    // The endpoints opt into cooperative cancellation: the transport injects
    // the carrier signal as the final parameter, and an already-aborted call
    // must stop before the probe or the snapshot runs.
    lane = await setupHostLane(undefined, { typert: true })
    const runtime = lane.ctx.get('zoteroRemote') as ZoteroRuntime
    const controller = new AbortController()
    controller.abort()
    await expect(runtime.status(controller.signal)).rejects.toThrow()
    await expect(runtime.diagnostics(controller.signal)).rejects.toThrow()
    expect(lane.mock.requests).toHaveLength(0)
  })

  it('reports the dialled endpoint even when the probe failed', async () => {
    lane = await setupHostLane(undefined, { typert: true })
    const endpoint = new URL(lane.mock.baseUrl).host
    // A refused connection is the ordinary offline case: the address that did
    // not answer is the fact a user needs next, so the failure arm carries it.
    await lane.mock.close()
    const runtime = lane.ctx.get('zoteroRemote') as ZoteroRuntime
    const status = await runtime.status(LIVE_SIGNAL)
    expect(status.connected).toBe(false)
    expect(status.endpoint).toBe(endpoint)
  })

  it('forwards the provider write state the web tab status strip renders', async () => {
    lane = await setupHostLane({ writeEnabled: true }, { typert: true })
    lane.mock.route('GET', '/api/', (_req, _res, helpers) =>
      helpers.json({}, { 'Zotero-Server-ID': 'S-write' }),
    )
    const runtime = lane.ctx.get('zoteroRemote') as ZoteroRuntime
    await expect(runtime.status(LIVE_SIGNAL)).resolves.toMatchObject({
      providerId: 'local',
      connected: true,
      serverId: 'S-write',
      // The capability is wired; no grant is stored yet.
      write: { enabled: true, authorized: false },
    })
  })

  it('strips absent optional facts and converges failures into the view', async () => {
    lane = await setupHostLane(undefined, { typert: true })
    lane.mock.route('GET', '/api/', (_req, _res, helpers) => helpers.raw(503, {}, 'down'))
    const runtime = lane.ctx.get('zoteroRemote') as ZoteroRuntime
    const status = await runtime.status(LIVE_SIGNAL)
    expect(status.connected).toBe(false)
    expect(status.apiVersion).toBeUndefined()
    expect(status.serverId).toBeUndefined()
    expect(status.schemaVersion).toBeUndefined()
    expect(status.diagnosis).not.toBe('')
  })

  it('serves an empty diagnostics view without the zotero service composed', async () => {
    const context = new Context()
    await context.plugin(TypertRegistry)
    new ZoteroRuntime(context)
    await expect(context.get('zoteroRemote')!.diagnostics(LIVE_SIGNAL)).resolves.toEqual({
      entries: [],
      total: 0,
      truncated: false,
      debug: false,
    })
    await context.fiber.dispose()
  })

  it('accepts a minimal client error report without optional stacks', async () => {
    lane = await setupHostLane(undefined, { typert: true })
    const receipt = await lane.ctx.get('zoteroRemote')!.reportClientError(
      {
        surface: 'detail',
        message: 'boom',
      },
      LIVE_SIGNAL,
    )
    expect(receipt.seq).toBeGreaterThan(0)
    const view = await lane.ctx.get('zoteroRemote')!.diagnostics(LIVE_SIGNAL)
    const entry = (view.entries as ZoteroDiagnosticEntry[]).find(
      (candidate) => candidate.event === 'client.render',
    )
    expect(entry?.message).toBe('detail: boom')
    // Both optional stacks absent: the entry carries no detail at all.
    expect(entry?.detail).toBeUndefined()
  })

  it('refuses the client error report without the zotero service composed', async () => {
    const context = new Context()
    await context.plugin(TypertRegistry)
    new ZoteroRuntime(context)
    await expect(
      context
        .get('zoteroRemote')!
        .reportClientError({ surface: 'sources', message: 'boom' }, LIVE_SIGNAL),
    ).rejects.toThrow('The Zotero service is not composed.')
    await context.fiber.dispose()
  })

  it('reports unavailable without the zotero service composed', async () => {
    // Deliberately hand-built rather than a lane: the service being absent is
    // the composition under test, so no lane can boot it.
    const context = new Context()
    await context.plugin(TypertRegistry)
    new ZoteroRuntime(context)
    await expect(context.get('zoteroRemote')!.status(LIVE_SIGNAL)).resolves.toEqual({
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
    expect(TYPERT_MANIFEST.invocations.map((invocation) => invocation.method)).toEqual([
      'status',
      'resolveAttachment',
      'diagnostics',
      'reportClientError',
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
    // Strict codecs carry a lazy factory (TypertCodec.create).
    expect(typeof (status?.result as { create?: unknown } | undefined)?.create).toBe('function')
  })

  it('declares exactly the methods the client contribution mounts', async () => {
    // The host manifest and the browser contribution are two spellings of one
    // endpoint set. Each method is cross-checked below by identity, but that
    // per-method shape would still pass if a method were added to only one
    // side: the set itself is asserted here.
    const { ZOTERO_REMOTE } = await import('../../src/client/remote.ts')
    const hostMethods = TYPERT_MANIFEST.invocations.map((invocation) => invocation.method)
    const clientMethods = ZOTERO_REMOTE.descriptors.map((descriptor) => descriptor.method)
    expect(clientMethods).toEqual(hostMethods)
  })

  it('materializes the host status schema through create()', () => {
    const status = TYPERT_MANIFEST.invocations.find((invocation) => invocation.method === 'status')
    const result = status?.result as
      { create: () => { parse: (value: unknown) => unknown } } | undefined
    expect(result).toBeDefined()
    const schema = result!.create()
    // `diagnosis` is optional on the wire: a connected view carries none, and
    // absence must parse rather than fall over the strict object.
    const valid = schema.parse({ providerId: 'local', connected: true })
    expect(valid).toEqual({ providerId: 'local', connected: true })
    // A failure view keeps its code-bearing string.
    const failed = schema.parse({
      providerId: 'local',
      connected: false,
      diagnosis: 'ZOTERO_NOT_RUNNING: down',
    })
    expect(failed).toMatchObject({ diagnosis: 'ZOTERO_NOT_RUNNING: down' })
    expect(() => schema.parse({ providerId: 'local', connected: 'yes' })).toThrow()
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

  it('materializes browser-side status codec', async () => {
    const { ZOTERO_REMOTE } = await import('../../src/client/remote.ts')
    const status = ZOTERO_REMOTE.descriptors.find((invocation) => invocation.method === 'status')
    const result = status?.result as
      { create?: () => { parse: (v: unknown) => unknown } } | undefined
    expect(typeof result?.create).toBe('function')
    const schema = result!.create!()
    expect(schema.parse({ providerId: 'local', connected: true })).toMatchObject({
      providerId: 'local',
      connected: true,
    })
    expect(() => schema.parse({ connected: 'not-a-bool' })).toThrow()
  })

  it('materializes and validates the host resolveAttachment codecs', () => {
    const resolve = TYPERT_MANIFEST.invocations.find((inv) => inv.method === 'resolveAttachment')
    expect(resolve).toBeDefined()
    const paramResult = resolve!.parameters[0]?.codec as {
      create: () => { parse: (v: unknown) => unknown }
    }
    const resultResult = resolve!.result as { create: () => { parse: (v: unknown) => unknown } }
    const paramSchema = paramResult.create()
    expect(paramSchema.parse('zotero://user/0/items/ABCD1234')).toBe(
      'zotero://user/0/items/ABCD1234',
    )
    expect(() => paramSchema.parse('')).toThrow()

    const resSchema = resultResult.create()
    const valid = resSchema.parse({
      ref: 'zotero://user/0/items/ABCD1234',
      kind: 'file',
      title: 'test.pdf',
      contentType: 'application/pdf',
      path: '/path/to/test.pdf',
    })
    expect(valid).toMatchObject({ kind: 'file', path: '/path/to/test.pdf' })
    expect(() => resSchema.parse({ ref: 'a', kind: 'other' })).toThrow()
  })

  it('materializes browser-side resolveAttachment codecs', async () => {
    const { ZOTERO_REMOTE } = await import('../../src/client/remote.ts')
    const resolve = ZOTERO_REMOTE.descriptors.find((inv) => inv.method === 'resolveAttachment')
    expect(resolve).toBeDefined()
    const paramCodec = resolve!.parameters[0]?.codec as {
      create?: () => { parse: (v: unknown) => unknown }
    }
    const resultCodec = resolve!.result as {
      create?: () => { parse: (v: unknown) => unknown }
    }
    expect(paramCodec.create!().parse('zotero://user/0/items/ABCD1234')).toBe(
      'zotero://user/0/items/ABCD1234',
    )
    expect(() => paramCodec.create!().parse('')).toThrow()
    expect(
      resultCodec.create!().parse({
        ref: 'zotero://user/0/items/ABCD1234',
        kind: 'file',
        title: 'test.pdf',
        contentType: 'application/pdf',
        path: '/path/to/test.pdf',
      }),
    ).toMatchObject({ kind: 'file', path: '/path/to/test.pdf' })
    expect(() => resultCodec.create!().parse({ ref: 'a', kind: 'other' })).toThrow()
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

describe('the zotero resolveAttachment endpoint', () => {
  it('throws an error when the zotero service is not composed', async () => {
    const context = new Context()
    await context.plugin(TypertRegistry)
    new ZoteroRuntime(context)
    await expect(
      context.get('zoteroRemote')!.resolveAttachment('zotero://user/0/items/ITEMKEY1', LIVE_SIGNAL),
    ).rejects.toThrow('The Zotero service is not composed.')
    await context.fiber.dispose()
  })

  it('delegates to the zotero service for file and url attachments', async () => {
    lane = await setupHostLane(undefined, { typert: true })
    const zotero = lane.ctx.get('zotero')!
    const origAttachment = zotero.attachment.bind(zotero)
    try {
      zotero.attachment = async () => ({
        ref: 'zotero://user/0/item/ITEMKEY1',
        kind: 'file',
        title: 'paper.pdf',
        contentType: 'application/pdf',
        path: '/storage/paper.pdf',
      })
      const runtime = lane.ctx.get('zoteroRemote') as ZoteroRuntime
      const fileRes = await runtime.resolveAttachment('zotero://user/0/item/ITEMKEY1', LIVE_SIGNAL)
      expect(fileRes).toEqual({
        ref: 'zotero://user/0/item/ITEMKEY1',
        kind: 'file',
        title: 'paper.pdf',
        contentType: 'application/pdf',
        path: '/storage/paper.pdf',
      })

      zotero.attachment = async () => ({
        ref: 'zotero://user/0/item/ITEMKEY1',
        kind: 'url',
        title: 'web.pdf',
        contentType: 'application/pdf',
        url: 'https://arxiv.org/abs/1234',
      })
      const urlRes = await runtime.resolveAttachment('zotero://user/0/item/ITEMKEY1', LIVE_SIGNAL)
      expect(urlRes).toEqual({
        ref: 'zotero://user/0/item/ITEMKEY1',
        kind: 'url',
        title: 'web.pdf',
        contentType: 'application/pdf',
        url: 'https://arxiv.org/abs/1234',
      })
    } finally {
      zotero.attachment = origAttachment
    }
  })
})
