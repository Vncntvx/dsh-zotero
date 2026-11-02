/** Metadata request budgets, bounded file resolution, and identity/error propagation. */
import { afterEach, beforeEach, expect, it } from 'vitest'
import {
  setupProvider,
  teardownProvider,
  getRequest,
  type ProviderHarness,
} from '../helpers/provider-harness.ts'
import { attachment, item, versionHeaders } from '../helpers/server/objects.ts'
import { serveItemGraph, serveJson } from '../helpers/server/serve.ts'
import { deferred } from '../helpers/sync.ts'
let harness: ProviderHarness
beforeEach(async () => {
  harness = await setupProvider({ graphConcurrency: 4 })
})
afterEach(async () => {
  await teardownProvider(harness)
})
it.each([false, true])(
  'uses exactly 2 metadata or 52 file requests for 50 attachments (locations=%s)',
  async (resolve) => {
    const rows = Array.from({ length: 50 }, (_, index) =>
      attachment({ key: `FILE${String(index).padStart(4, '0')}` }),
    )
    serveItemGraph(harness.mock, { parent: item(), children: rows })
    let active = 0,
      peak = 0
    const saturated = deferred<void>(),
      release = deferred<void>()
    for (const row of rows)
      harness.mock.route(
        'GET',
        `/api/users/0/items/${row.key}/file/view/url`,
        (_req, _res, helpers) => {
          peak = Math.max(peak, ++active)
          if (active === 4) saturated.resolve()
          void release.promise.then(() => {
            helpers.text(import.meta.url, versionHeaders())
            active--
          })
        },
      )
    const reading = harness.provider.getItem({
      ...getRequest(['attachments']),
      locations: resolve ? 'included' : 'none',
    })
    if (resolve) {
      await saturated.promise
      expect(peak).toBe(4)
    }
    release.resolve()
    const result = await reading
    expect(result.attachments?.returned).toBe(50)
    expect(harness.mock.requests).toHaveLength(resolve ? 52 : 2)
    expect(peak).toBeLessThanOrEqual(4)
  },
)
it('keeps the first instance identity when a file resolver observes another instance', async () => {
  serveJson(harness.mock, '/api/users/0/items/WXYZ6789', attachment(), versionHeaders())
  harness.mock.route('GET', '/api/users/0/items/WXYZ6789/file/view/url', (_req, _res, helpers) =>
    helpers.text(import.meta.url, { 'Zotero-Server-ID': 'another' }),
  )
  await expect(
    harness.provider.getItem({
      ...getRequest(),
      ref: { ...getRequest().ref, key: 'WXYZ6789', kind: 'attachment' },
      locations: 'best',
    }),
  ).rejects.toMatchObject({ code: 'ZOTERO_SERVER_MISMATCH' })
})
it('propagates cancellation after metadata rather than returning a partial successful location', async () => {
  serveJson(harness.mock, '/api/users/0/items/WXYZ6789', attachment(), versionHeaders())
  const started = deferred<void>()
  harness.mock.route('GET', '/api/users/0/items/WXYZ6789/file/view/url', () => {
    started.resolve()
  })
  const controller = new AbortController()
  const reading = harness.provider.getItem(
    {
      ...getRequest(),
      ref: { ...getRequest().ref, key: 'WXYZ6789', kind: 'attachment' },
      locations: 'best',
    },
    controller.signal,
  )
  await started.promise
  controller.abort()
  await expect(reading).rejects.toThrow()
})
