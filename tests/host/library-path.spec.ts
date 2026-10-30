import { collectionRow } from '../helpers/server/objects.js'
import { afterEach, expect, it, vi } from 'vitest'
import { ZoteroLibraryService } from '../../src/library/service.js'
import { setupHostLane, type HostLane } from '../helpers/lanes/host-lane.js'
let lane: HostLane | undefined
const LIVE_SIGNAL = new AbortController().signal
afterEach(async () => {
  await lane?.ctx.fiber.dispose()
  await lane?.teardown()
  lane = undefined
  vi.restoreAllMocks()
})
it('routes collectionPath through the core browse capability and provider with cancellation', async () => {
  lane = await setupHostLane()
  await lane.ctx.plugin(ZoteroLibraryService, {})
  const service = lane.ctx.get('zoteroLibrary') as ZoteroLibraryService
  const request = {
    library: { type: 'user', id: 0 } as const,
    ref: 'zotero://user/0/collection/COLL0001',
    libraryVersion: 1,
  }
  const core = vi
    .spyOn(lane.ctx.zotero, 'collectionPath')
    .mockResolvedValue({ library: request.library, libraryVersion: 1, path: [] })
  await expect(service.collectionPath(request, LIVE_SIGNAL)).resolves.toEqual({
    library: request.library,
    libraryVersion: 1,
    path: [],
  })
  expect(core).toHaveBeenCalledWith(request, LIVE_SIGNAL)
})

it('reads collectionPath through the core and Local Provider rather than a panel transport', async () => {
  lane = await setupHostLane()
  await lane.ctx.plugin(ZoteroLibraryService, {})
  lane.mock.route('GET', '/api/users/0/collections/COLL0001', (_req, _res, helpers) =>
    helpers.json(
      collectionRow({ key: 'COLL0001', data: { name: 'Root', parentCollection: false } }),
      { 'Zotero-Server-ID': 'S1' },
    ),
  )
  lane.mock.route('GET', '/api/users/0/collections/top', (_req, _res, helpers) =>
    helpers.json([], {
      'Last-Modified-Version': '1',
      'Total-Results': '0',
      'Zotero-Server-ID': 'S1',
    }),
  )
  const service = lane.ctx.get('zoteroLibrary') as ZoteroLibraryService
  const result = await service.collectionPath(
    {
      library: { type: 'user', id: 0 },
      ref: 'zotero://user/0/collection/COLL0001?server=S1',
      libraryVersion: 1,
    },
    LIVE_SIGNAL,
  )
  expect(result.path).toMatchObject([{ name: 'Root', path: ['Root'] }])
  await expect(
    service.browse(
      { kind: 'collections', library: { type: 'user', id: 0 }, offset: 0, limit: 1 },
      LIVE_SIGNAL,
    ),
  ).resolves.toMatchObject({ libraryVersion: 1 })
})
