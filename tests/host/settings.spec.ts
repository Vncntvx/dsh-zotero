/**
 * Live configuration: the entry applies at boot, violating commits are
 * vetoed before they land, and volatile commits rebuild the structural
 * surface without remounting.
 *
 * Every schema field is `volatile`, so the settings page edits the running
 * fiber's references: `internal/config` vetoes a commit the schema alone
 * cannot refuse (loopback-only baseUrl, positive limits), and
 * `loader/volatile-update` rebuilds transport and reconciles the write tools
 * on the same service instance. The tests drive that contract the way the
 * loader does — committed references plus the update event — through public
 * seams only (`fiber.config` references, cosmokit's volatile helpers, and
 * cordis waterfall/emit).
 * @module tests/host/settings
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createVolatile, updateVolatile, volatileEntries } from '@deepseek-ai/cosmokit'
import { ZOTERO_PROVIDER_UNAVAILABLE } from '../../src/errors.js'
import { intRangeArgumentMessage } from '../../src/tools/validate.js'
import { expectValue, type HostLane, setupHostLane } from '../helpers/lanes/host-lane.js'

/** The lane the current test booted; `afterEach` releases it. */
let lane: HostLane | undefined

afterEach(async () => {
  await lane?.ctx.fiber.dispose()
  await lane?.teardown()
  lane = undefined
})

/**
 * Commit one live edit the way the loader does: write the fiber's volatile
 * references, then dispatch the update event the service reacts to. Values
 * are already validated at this point (the veto test below covers the
 * refusal path), exactly as a landed commit is.
 * @param patch - top-level field values to commit.
 */
async function commitLive(patch: Record<string, unknown>): Promise<void> {
  const { zoteroFiber } = lane as HostLane
  const refs = new Map(
    volatileEntries(zoteroFiber.config).map(({ path, ref }) => [path.join('.'), ref]),
  )
  for (const [field, value] of Object.entries(patch)) {
    const ref = refs.get(field)
    if (ref === undefined) throw new Error(`no volatile reference for ${field}`)
    updateVolatile(ref, createVolatile(value))
  }
  await zoteroFiber.ctx.emit(
    'loader/volatile-update',
    Object.keys(patch).map((field) => [field]),
  )
}

describe('live configuration', () => {
  it('applies the composition entry at boot', async () => {
    lane = await setupHostLane({ baseUrl: 'http://127.0.0.1:1/api' })
    const scope = lane.ctx.zotero
    expect(scope.config.baseUrl).toBe('http://127.0.0.1:1/api')
    expect(scope.config.timeoutMs).toBe(5000)
    expect(scope.config.maxSearchResults).toBe(20)
  })

  it('vetoes a commit that violates the config constraints', async () => {
    lane = await setupHostLane({ baseUrl: 'http://127.0.0.1:1/api' })
    const { zoteroFiber } = lane
    // The waterfall runs on the owning fiber's context — the same object the
    // service registered its veto on — so the candidate reaches the hook.
    expect(() =>
      zoteroFiber.ctx.waterfall(
        zoteroFiber,
        'internal/config',
        { baseUrl: 'http://example.com/api' },
        () => ({
          baseUrl: 'http://example.com/api',
        }),
      ),
    ).toThrow(/loopback/)
    expect(lane.ctx.zotero.config.baseUrl).toBe('http://127.0.0.1:1/api')
  })

  it('passes a valid commit through the veto untouched', async () => {
    lane = await setupHostLane({ baseUrl: 'http://127.0.0.1:1/api' })
    const { zoteroFiber } = lane
    const raw = { baseUrl: 'http://127.0.0.1:1/api', timeoutMs: 7000 }
    expect(zoteroFiber.ctx.waterfall(zoteroFiber, 'internal/config', raw, () => raw)).toBe(raw)
  })

  it('live-applies a baseUrl edit by rebuilding the transport', async () => {
    lane = await setupHostLane({ baseUrl: 'http://127.0.0.1:1/api' })
    lane.mock.route('GET', '/api/', (req, res, helpers) =>
      helpers.json({}, { 'Zotero-Server-ID': 'S1', 'Zotero-API-Version': '3' }),
    )
    const { ctx, mock } = lane
    expect((await ctx.zotero.status()).connected).toBe(false)
    await commitLive({ baseUrl: mock.baseUrl })
    expect(ctx.zotero.config.baseUrl).toBe(mock.baseUrl)
    const status = await ctx.zotero.status()
    expect(status.connected).toBe(true)
    expect(status.serverId).toBe('S1')
    expect(mock.requests.length).toBeGreaterThan(0)
  })

  it('keeps the recovery gate identity across transport rebuilds', async () => {
    // Volatile commits rebuild transport on the same ZoteroService; recovery
    // is a service-lifetime dedupe gate, not config-generation state. A new
    // gate here would fork concurrent connectivity asks into stacked cards.
    lane = await setupHostLane({ baseUrl: 'http://127.0.0.1:1/api' })
    const recovery = lane.ctx.zotero.recovery
    await commitLive({ timeoutMs: 7000, maxSearchResults: 5 })
    expect(lane.ctx.zotero.config.timeoutMs).toBe(7000)
    expect(lane.ctx.zotero.config.maxSearchResults).toBe(5)
    expect(lane.ctx.zotero.recovery).toBe(recovery)
  })

  it('live-applies a provider selection change without rebuilding the transport', async () => {
    lane = await setupHostLane()
    // `provider` is a live lookup in `resolveProvider()`; it is not a
    // transport key, so the edit must land through the entry read alone.
    await commitLive({ provider: 'missing' })
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
    await commitLive({ provider: 'local' })
    expect(lane.ctx.zotero.config.provider).toBe('local')
  })

  it('live-applies writePersistKey without rebuilding the transport', async () => {
    lane = await setupHostLane({ writeEnabled: true })
    const recovery = lane.ctx.zotero.recovery
    await commitLive({ writePersistKey: false })
    expect(lane.ctx.zotero.config.writePersistKey).toBe(false)
    // Recovery is service-lifetime state and is never swapped on rebuild;
    // its identity is also the cheap "same instance" probe here.
    expect(lane.ctx.zotero.recovery).toBe(recovery)
    expect(lane.tool('zotero_create_note')).toBeDefined()
  })

  it('live-applies a tool validation limit', async () => {
    lane = await setupHostLane({ baseUrl: 'http://127.0.0.1:1/api' })
    await commitLive({ maxSearchResults: 5 })
    const result = await lane.runTool('zotero_search', { query: 'x', limit: 10 })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect((result.content[0] as { text: string }).text).toContain(
      intRangeArgumentMessage('limit', 10, 1, 5),
    )
  })

  it('registers and retires the write tools as writeEnabled flips', async () => {
    lane = await setupHostLane()
    expect(lane.tool('zotero_create_note')).toBeUndefined()
    await commitLive({ writeEnabled: true })
    expect(lane.tool('zotero_create_note')).toBeDefined()
    expect(lane.tool('zotero_add_tags')).toBeDefined()
    expect(lane.tool('zotero_add_to_collection')).toBeDefined()
    await commitLive({ writeEnabled: false })
    expect(lane.tool('zotero_create_note')).toBeUndefined()
  })

  it('live-applies provider limits to LocalApiProvider without rebuilding transport', async () => {
    lane = await setupHostLane({ maxDetailChars: 100 })
    lane.mock.route('GET', '/api/', (req, res, helpers) =>
      helpers.json({}, { 'Zotero-Server-ID': 'S1', 'Zotero-API-Version': '3' }),
    )
    lane.mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(
        {
          key: 'ABCD1234',
          version: 1,
          links: {
            self: {
              href: `${lane?.mock.baseUrl}/users/0/items/ABCD1234`,
              type: 'application/json',
            },
          },
          data: {
            itemType: 'journalArticle',
            title: 'Paper Title',
            abstractNote: 'A'.repeat(200),
          },
        },
        { 'Zotero-Server-ID': 'S1' },
      ),
    )

    const initial = expectValue(
      await lane.runTool('zotero_get', { ref: 'zotero://user/0/item/ABCD1234' }),
      'zotero_get',
    )
    expect(initial.value).toMatchObject({
      abstract: 'A'.repeat(100),
      abstractTruncated: true,
    })

    await commitLive({ maxDetailChars: 500 })
    expect(lane.ctx.zotero.config.maxDetailChars).toBe(500)

    const updated = expectValue(
      await lane.runTool('zotero_get', { ref: 'zotero://user/0/item/ABCD1234' }),
      'zotero_get',
    )
    expect(updated.value).toMatchObject({
      abstract: 'A'.repeat(200),
      abstractTruncated: false,
    })
  })
})
