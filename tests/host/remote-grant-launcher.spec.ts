/** The launcher environment scrub and the write-grant revocation without a write transport. */
/**
 * The zotero Remote service: the web tab's live surface. The configuration
 * plane reads and writes the namespace through the shared configuration form,
 * so the Remote carries the facts and actions the settings plane cannot take
 * itself: the connectivity probe, attachment resolution, diagnostics,
 * protocol wake-up, and write-grant revocation.
 * @module tests/remote
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeOpenProtocol, type ProtocolLauncher, ZoteroRuntime } from '../../src/remote.js'
import { WRITE_KEY_RECORD } from '../../src/write-auth.js'
import { MemoryCredentials, writeGrantRecord } from '../helpers/credential-seam.js'
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

describe('launcher environment and write grant', () => {
  it('drops credential-shaped and harness-owned variables from every launcher child', async () => {
    // The launcher needs PATH (and WSLENV under WSL), never the API keys the
    // host was started with: inheriting `process.env` handed them to a second
    // process just to open a URL. The rule matches the harness canonical
    // scrub: substring credential names and every DSH_* name.
    const launcher = vi.fn<ProtocolLauncher>(async () => {})
    const env = {
      PATH: '/usr/bin:/bin',
      WSLENV: 'USERPROFILE/p',
      HOME: '/home/u',
      OPENAI_API_KEY: 'sk-live',
      MINERU_TOKEN: 'token',
      ZOTERO_PASSWORD: 'hunter2',
      CLIENT_SECRET: 'shh',
      SECRET_STORE: '/run/secrets',
      TOKEN_FILE: '/tmp/token',
      KEY_ID: 'kid',
      DSH_HOME: '/home/u/.dsh',
      dsh_lowercase: 'still-harness',
    }
    await executeOpenProtocol('zotero://select/library/items/ABC12345', {
      platform: 'darwin',
      launcher,
      env,
    })
    const [, , options] = launcher.mock.calls[0]!
    expect(options.env).toEqual({
      PATH: '/usr/bin:/bin',
      WSLENV: 'USERPROFILE/p',
      HOME: '/home/u',
    })
  })

  it('deletes a stored grant while writes are disabled', async () => {
    // Revoking is not a write capability: turning the write surface off leaves
    // the persisted key in place, so the settings row must still be able to
    // delete it.
    let credentials: MemoryCredentials | undefined
    lane = await setupHostLane(undefined, {
      typert: true,
      compose: async (ctx) => {
        await ctx.plugin(MemoryCredentials)
        credentials = ctx.get('credentials') as MemoryCredentials
        credentials.records.set(String(WRITE_KEY_RECORD), writeGrantRecord('stored-key-01', 'S1'))
      },
    })
    const runtime = lane.ctx.get('zoteroRemote') as ZoteroRuntime
    await expect(runtime.revokeWriteGrant(LIVE_SIGNAL)).resolves.toEqual({ removed: true })
    expect(credentials?.records.size).toBe(0)
    expect(credentials?.deletions).toEqual([String(WRITE_KEY_RECORD)])
  })

  it('reports no removed record while writes are disabled and none is stored', async () => {
    lane = await setupHostLane(undefined, { typert: true })
    const runtime = lane.ctx.get('zoteroRemote') as ZoteroRuntime
    await expect(runtime.revokeWriteGrant(LIVE_SIGNAL)).resolves.toEqual({ removed: false })
  })

  describe('the zotero revokeWriteGrant endpoint', () => {
    it('reports no removed record when writes are enabled without a credentials seam', async () => {
      lane = await setupHostLane({ writeEnabled: true }, { typert: true })
      const runtime = lane.ctx.get('zoteroRemote') as ZoteroRuntime
      await expect(runtime.revokeWriteGrant(LIVE_SIGNAL)).resolves.toEqual({ removed: false })
    })

    it('honors a pre-aborted carrier signal', async () => {
      lane = await setupHostLane({ writeEnabled: true }, { typert: true })
      const runtime = lane.ctx.get('zoteroRemote') as ZoteroRuntime
      const controller = new AbortController()
      controller.abort()
      await expect(runtime.revokeWriteGrant(controller.signal)).rejects.toThrow()
    })
  })
})
