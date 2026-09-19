/**
 * Settings-namespace behavior: the `zotero` section registers against the
 * settings seam with the composition entry as its base, and every committed
 * edit live-applies — the transport rebuilds, provider selection and tool
 * limits follow, and a write that violates the config constraints is refused
 * before it reaches storage.
 * @module tests/settings
 */

import { afterEach, describe, expect, it } from 'vitest'
import { ZOTERO_PROVIDER_UNAVAILABLE } from '../../src/errors.js'
import { intRangeArgumentMessage } from '../../src/tools/validate.js'
import { ZOTERO_SETTINGS_NAMESPACE } from '../../src/settings-namespace.js'
import { type HostLane, setupHostLane } from '../helpers/lanes/host-lane.js'

/** The lane the current test booted; `afterEach` releases it. */
let lane: HostLane | undefined

afterEach(async () => {
  await lane?.ctx.fiber.dispose()
  await lane?.teardown()
  lane = undefined
})

/**
 * Commit one settings edit and return once the service has applied it. The
 * write promise is the observation point: the seam swaps the namespace's
 * resolved value and runs its watch callbacks — for this plugin the rebuild
 * that applies the section, and the source swap the tools read per request —
 * before that promise settles (sequenced this way by the seam's own suite:
 * packages/settings/settings/tests/settings.spec.ts, `commits, notifies
 * watchers, and emits with source update`). Nothing here waits for a duration,
 * so the state asserted below is the state the write produced.
 * @param patch - the user-layer patch to commit.
 */
async function applySettings(patch: Record<string, unknown>): Promise<void> {
  // The lane is booted before any test calls this.
  const { ctx } = lane as HostLane
  await ctx.settings.update(ZOTERO_SETTINGS_NAMESPACE, patch)
}

describe('the zotero settings namespace', () => {
  it('registers with the Config schema and the composition entry as its base', async () => {
    lane = await setupHostLane({ baseUrl: 'http://127.0.0.1:1/api' }, { settings: {} })
    const { ctx } = lane
    const resolved = ctx.settings.get(ZOTERO_SETTINGS_NAMESPACE) as Record<string, unknown>
    expect(resolved.baseUrl).toBe('http://127.0.0.1:1/api')
    expect(resolved.timeoutMs).toBe(5000)
    expect(resolved.maxSearchResults).toBe(20)
    const scope = ctx.zotero
    expect(scope.config.baseUrl).toBe('http://127.0.0.1:1/api')
    expect(scope.config.timeoutMs).toBe(5000)
  })

  it('honors a stored section from the settings document at boot', async () => {
    lane = await setupHostLane(
      { baseUrl: 'http://127.0.0.1:1/api' },
      { settings: { zotero: { timeoutMs: 7000, maxSearchResults: 5 } } },
    )
    expect(lane.ctx.zotero.config.timeoutMs).toBe(7000)
    expect(lane.ctx.zotero.config.maxSearchResults).toBe(5)
  })

  it('live-applies a baseUrl edit by rebuilding the transport', async () => {
    lane = await setupHostLane({ baseUrl: 'http://127.0.0.1:1/api' }, { settings: {} })
    lane.mock.route('GET', '/api/', (req, res, helpers) =>
      helpers.json({}, { 'Zotero-Server-ID': 'S1', 'Zotero-API-Version': '3' }),
    )
    const { ctx, mock } = lane
    expect((await ctx.zotero.status()).connected).toBe(false)
    await applySettings({ baseUrl: mock.baseUrl })
    const status = await ctx.zotero.status()
    expect(status.connected).toBe(true)
    expect(status.serverId).toBe('S1')
    expect(mock.requests.length).toBeGreaterThan(0)
  })

  it('keeps the recovery gate identity across settings rebuilds', async () => {
    // Settings commits rebuild transport on the same ZoteroService; recovery
    // is a service-lifetime dedupe gate, not config-generation state. A new
    // gate here would fork concurrent connectivity asks into stacked cards.
    lane = await setupHostLane({ baseUrl: 'http://127.0.0.1:1/api' }, { settings: {} })
    const recovery = lane.ctx.zotero.recovery
    await applySettings({ timeoutMs: 7000, maxSearchResults: 5 })
    expect(lane.ctx.zotero.config.timeoutMs).toBe(7000)
    expect(lane.ctx.zotero.config.maxSearchResults).toBe(5)
    expect(lane.ctx.zotero.recovery).toBe(recovery)
  })

  it('refuses a write that violates the config constraints', async () => {
    lane = await setupHostLane({ baseUrl: 'http://127.0.0.1:1/api' }, { settings: {} })
    await expect(
      lane.ctx.settings.update(ZOTERO_SETTINGS_NAMESPACE, { baseUrl: 'http://example.com/api' }),
    ).rejects.toThrow(/loopback/)
    expect(lane.ctx.zotero.config.baseUrl).toBe('http://127.0.0.1:1/api')
  })

  it('live-applies a provider selection change', async () => {
    lane = await setupHostLane(undefined, { settings: {} })
    await applySettings({ provider: 'missing' })
    await expect(
      lane.ctx.zotero.search({
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
    lane = await setupHostLane({ baseUrl: 'http://127.0.0.1:1/api' }, { settings: {} })
    await applySettings({ maxSearchResults: 5 })
    const result = await lane.runTool('zotero_search', { query: 'x', limit: 10 })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect((result.content[0] as { text: string }).text).toContain(
      intRangeArgumentMessage('limit', 10, 1, 5),
    )
  })
})
