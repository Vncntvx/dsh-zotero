/**
 * The zotero Remote service: the web tab's live surface. The configuration
 * plane reads and writes the namespace through the shared configuration form,
 * so the Remote carries the facts and actions the settings plane cannot take
 * itself: the connectivity probe, attachment resolution, diagnostics,
 * protocol wake-up, and write-grant revocation.
 * @module tests/remote
 */

import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnrichmentService } from '../../src/enrichment/index.ts'
import { executeOpenProtocol, type ProtocolLauncher, ZoteroRuntime } from '../../src/remote.js'
import type { ZoteroDiagnosticEntry } from '../../src/contract.js'
import { type HostLane, setupHostLane } from '../helpers/lanes/host-lane.js'
import { rejectionOf } from './support/open-protocol.js'
import { statusView } from '../helpers/status-view.ts'

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
    // The authority actually dialled is the mock server's own host:port, not
    // the configured default. The card's live refresh replaces the parsed
    // command text with this view, so an endpoint dropped here would blank
    // the row the user just refreshed.
    expect(status).toEqual(
      statusView({
        endpoint: new URL(lane.mock.baseUrl).host,
        apiVersion: '3',
        schemaVersion: '37',
        serverId: 'S1',
      }),
    )
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
    await expect(context.get('zoteroRemote')!.status(LIVE_SIGNAL)).resolves.toEqual(
      statusView({ connected: false, diagnosis: 'The Zotero service is not composed.' }),
    )
    await context.fiber.dispose()
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

describe('the zotero openProtocol endpoint', () => {
  it.each(['darwin', 'linux'] as const)('awaits the %s launcher', async (platform) => {
    const launcher = vi.fn<ProtocolLauncher>(async () => {})
    expect(
      await executeOpenProtocol('zotero://select/library/items/ABC12345', {
        platform,
        launcher,
        env: { PATH: '/usr/bin' },
      }),
    ).toEqual({ success: true })
    expect(launcher).toHaveBeenCalledWith(
      platform === 'darwin' ? 'open' : 'xdg-open',
      ['zotero://select/library/items/ABC12345'],
      { signal: undefined, env: { PATH: '/usr/bin' } },
    )
  })

  it('passes the complete Windows URL only through the environment', async () => {
    const launcher = vi.fn<ProtocolLauncher>(async () => {})
    const url = 'zotero://open-pdf/groups/123/items/ABC12345?page=12&annotation=ABCD1234'
    expect(
      await executeOpenProtocol(url, {
        platform: 'win32',
        launcher,
        env: { PATH: '/usr/bin', OPENAI_API_KEY: 'sk-live' },
      }),
    ).toEqual({
      success: true,
    })
    const [command, args, options] = launcher.mock.calls[0]!
    expect(command).toBe('powershell.exe')
    expect(options.env?.DSH_ZOTERO_PROTOCOL_URL).toBe(url)
    expect(options.env?.PATH).toBe('/usr/bin')
    expect(options.env).not.toHaveProperty('OPENAI_API_KEY')
    const script = Buffer.from(args[3]!, 'base64').toString('utf16le')
    expect(script).toContain('UseShellExecute = $true')
    expect(script).not.toContain(url)
    expect(script).not.toContain('Invoke-Expression')
  })

  it('launches via powershell.exe when running in WSL and forwards WSLENV', async () => {
    const launcher = vi.fn<ProtocolLauncher>(async () => {})
    const url = 'zotero://select/library/items/ABC12345'
    expect(
      await executeOpenProtocol(url, {
        platform: 'linux',
        launcher,
        env: { WSL_DISTRO_NAME: 'Ubuntu', MINERU_TOKEN: 'token' },
      }),
    ).toEqual({ success: true })
    const [command, args, options] = launcher.mock.calls[0]!
    expect(command).toBe('powershell.exe')
    expect(options.env?.DSH_ZOTERO_PROTOCOL_URL).toBe(url)
    expect(options.env?.WSLENV).toContain('DSH_ZOTERO_PROTOCOL_URL')
    expect(options.env).not.toHaveProperty('MINERU_TOKEN')
    const script = Buffer.from(args[3]!, 'base64').toString('utf16le')
    expect(script).toContain('UseShellExecute = $true')
  })

  it('drops undefined entries from a caller-supplied environment', async () => {
    const launcher = vi.fn<ProtocolLauncher>(async () => {})
    const url = 'zotero://select/library/items/ABC12345'
    expect(
      await executeOpenProtocol(url, {
        platform: 'linux',
        launcher,
        env: { PATH: '/usr/bin', HOLE: undefined, DSH_SECRET: 'internal' },
      }),
    ).toEqual({ success: true })
    const [, args, options] = launcher.mock.calls[0]!
    expect(args).toEqual([url])
    expect(options.env).toEqual({ PATH: '/usr/bin' })
  })

  it('surfaces launcher failure when powershell.exe fails in WSL', async () => {
    const launcher = vi.fn<ProtocolLauncher>(async (cmd) => {
      if (cmd === 'powershell.exe') throw new Error('powershell failed')
    })
    const url = 'zotero://select/library/items/ABC12345'
    const failure = await rejectionOf(url, {
      platform: 'linux',
      launcher,
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
    })
    expect(failure).toMatchObject({
      code: 'zotero/protocol-failed',
      details: { url, reason: 'powershell failed' },
    })
    expect(launcher).toHaveBeenCalledOnce()
    expect(launcher).toHaveBeenCalledWith('powershell.exe', expect.anything(), expect.anything())
  })
  it.each([
    'https://evil.com',
    'zotero://select/&calc.exe',
    'zotero://select/library/items/ABC12345/extra',
    'zotero://open-pdf/library/items/ABC12345?page=1&page=2',
    'zotero://open-pdf/library/items/ABC12345?annotation=%ZZ',
    'zotero://open-pdf/library/items/ABC12345?page=1&evil=x',
  ])('refuses invalid target %s before launching', async (url) => {
    const launcher = vi.fn<ProtocolLauncher>(async () => {})
    const failure = await rejectionOf(url, { platform: 'win32', launcher })
    expect(failure).toMatchObject({
      code: 'zotero/protocol-failed',
      details: { url, reason: expect.any(String) },
    })
    expect(launcher).not.toHaveBeenCalled()
  })
  it.each([false, true])('reports launcher failure (async=%s)', async (asyncFailure) => {
    const launcher: ProtocolLauncher = () => {
      if (asyncFailure) return Promise.reject(new Error('ENOENT'))
      throw new Error('ENOENT')
    }
    const url = 'zotero://select/'
    const failure = await rejectionOf(url, { platform: 'linux', launcher })
    expect(failure).toMatchObject({
      code: 'zotero/protocol-failed',
      details: { url, reason: 'ENOENT' },
    })
    expect(failure.cause).toBeInstanceOf(Error)
  })

  it('rejects cancellation before dispatch with the caller reason, not a protocol failure', async () => {
    const controller = new AbortController()
    const reason = new Error('caller cancelled the open')
    controller.abort(reason)
    const launcher = vi.fn<ProtocolLauncher>(async () => {})
    const url = 'zotero://select/'
    // A cancelled open is the caller's own verdict: reporting it as
    // protocol-failed would claim the launcher failed for a request that
    // never ran.
    await expect(
      executeOpenProtocol(url, {
        platform: 'linux',
        launcher,
        signal: controller.signal,
      }),
    ).rejects.toBe(reason)
    expect(launcher).not.toHaveBeenCalled()
  })
})

describe('the enrichment model endpoints', () => {
  it('no longer answers on the core runtime', async () => {
    lane = await setupHostLane(undefined, { typert: true })
    const runtime = lane.ctx.get('zoteroRemote') as ZoteroRuntime
    const face = runtime as unknown as Record<string, unknown>
    expect(face.semanticModelStatus).toBeUndefined()
    expect(face.downloadSemanticModel).toBeUndefined()
    expect(face.cancelSemanticModelDownload).toBeUndefined()
    expect(face.deleteSemanticModel).toBeUndefined()
    expect(face.verifySemanticModel).toBeUndefined()
    // And the component is not composed, so nothing answers at all.
    expect(lane.ctx.get('enrichment')).toBeUndefined()
  })

  it('answers from the enrichment service while it is composed', async () => {
    lane = await setupHostLane(undefined, { typert: true })
    const modelDir = await mkdtemp(join(tmpdir(), 'dsh-model-endpoints-'))
    const service = new EnrichmentService(
      lane.ctx,
      { semanticModelDir: modelDir },
      {
        client: {} as never,
      },
    )
    const status = await service.semanticModelStatus({ model: 'balanced' }, LIVE_SIGNAL)
    expect(status.model).toBe('balanced')
    expect(status.downloading).toBe(false)
    expect(status.path).toContain('qwen3-0.6b')
    expect(await service.cancelSemanticModelDownload({ model: 'balanced' }, LIVE_SIGNAL)).toEqual({
      cancelled: false,
    })
    // An unknown model is refused at the wire boundary, not deep in the
    // downloader.
    await expect(
      service.semanticModelStatus({ model: 'nope' as never }, LIVE_SIGNAL),
    ).rejects.toThrow()
  })
})
