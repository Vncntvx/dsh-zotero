/**
 * The zoteroLibrary subcomponent host service: remote endpoint forwarding,
 * configuration resolution, and write delegation through the library write pipeline.
 * @module tests/library-service
 */

import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZoteroLibraryService } from '../../src/library/service.js'
import { LibraryConfigSchema } from '../../src/library/config.js'
import { ZOTERO_CAPABILITY_UNAVAILABLE } from '../../src/errors.js'
import { type HostLane, setupHostLane } from '../helpers/lanes/host-lane.js'
import {
  browseRequestOf,
  childPageRequestOf,
  itemRequestOf,
  searchOptionsOf,
  searchRequestOf,
} from '../../src/library-views.js'
import type { ZoteroChildPage } from '../../src/types.js'
import { browseResult, searchResult } from '../helpers/library-fixtures.js'
import type { ZoteroItemDetail } from '../../src/types.js'

const LIVE_SIGNAL = new AbortController().signal

let lane: HostLane | undefined

afterEach(async () => {
  await lane?.ctx.fiber.dispose()
  await lane?.teardown()
  lane = undefined
  vi.restoreAllMocks()
})

describe('the zoteroLibrary host service', () => {
  it('throws when the zotero service is not composed', async () => {
    const context = new Context()
    await context.plugin(TypertRegistry)
    new ZoteroLibraryService(context, {})
    const runtime = context.get('zoteroLibrary') as ZoteroLibraryService
    await expect(
      runtime.browse(
        {
          library: { type: 'user', id: 0 },
          kind: 'collections',
          offset: 0,
          limit: 10,
        },
        LIVE_SIGNAL,
      ),
    ).rejects.toThrow('The Zotero service is not composed.')
    await expect(
      runtime.search(
        {
          library: { type: 'user', id: 0 },
          scope: { kind: 'library' },
          sort: 'dateModified',
          direction: 'desc',
          offset: 0,
          limit: 10,
        },
        LIVE_SIGNAL,
      ),
    ).rejects.toThrow('The Zotero service is not composed.')
    await expect(
      runtime.item(
        {
          ref: 'zotero://user/0/item/ITEMKEY1',
          include: [],
        },
        LIVE_SIGNAL,
      ),
    ).rejects.toThrow('The Zotero service is not composed.')
    await context.fiber.dispose()
  })

  it('mounts on Context with the row-config schema', async () => {
    lane = await setupHostLane()
    await lane.ctx.plugin(ZoteroLibraryService, {})

    const service = lane.ctx.get('zoteroLibrary') as ZoteroLibraryService
    expect(service).toBeInstanceOf(ZoteroLibraryService)
    // The service's Config is the schema the loader validates the shipped row
    // config against; the panel's switches live in the browser's settings
    // form, so the host reads no field itself.
    expect(ZoteroLibraryService.Config).toBe(LibraryConfigSchema)
  })

  it('forwards browse requests to ctx.zotero.browse', async () => {
    lane = await setupHostLane()
    await lane.ctx.plugin(ZoteroLibraryService, {})

    const service = lane.ctx.get('zoteroLibrary') as ZoteroLibraryService
    const browseSpy = vi.spyOn(lane.ctx.zotero, 'browse').mockResolvedValueOnce(browseResult())

    const request = {
      library: { type: 'user' as const, id: 0 as const },
      kind: 'collections' as const,
      offset: 0,
      limit: 10,
    }
    const result = await service.browse(request, LIVE_SIGNAL)

    expect(browseSpy).toHaveBeenCalledWith(browseRequestOf(request), LIVE_SIGNAL)
    expect(result).toEqual({
      kind: 'collections',
      items: [],
      total: 0,
      offset: 0,
      returned: 0,
      limit: 10,
    })
  })

  it('forwards search requests to ctx.zotero.search', async () => {
    lane = await setupHostLane()
    await lane.ctx.plugin(ZoteroLibraryService, {})

    const service = lane.ctx.get('zoteroLibrary') as ZoteroLibraryService
    const searchSpy = vi.spyOn(lane.ctx.zotero, 'search').mockResolvedValueOnce(searchResult())

    const request = {
      scope: { kind: 'library' as const },
      library: { type: 'user' as const, id: 0 as const },
      sort: 'dateModified' as const,
      direction: 'desc' as const,
      offset: 0,
      limit: 10,
      q: 'attention',
    }
    const result = await service.search(request, LIVE_SIGNAL)

    expect(searchSpy).toHaveBeenCalledWith(
      searchRequestOf(request),
      LIVE_SIGNAL,
      searchOptionsOf(request),
    )
    expect(result).toEqual({
      scope: { kind: 'library', library: { type: 'user', id: 0 } },
      items: [],
      total: 0,
      offset: 0,
      returned: 0,
      limit: 10,
    })
  })

  it('clamps browse pages to maxBrowseResults and echoes the effective limit', async () => {
    lane = await setupHostLane()
    await lane.ctx.plugin(ZoteroLibraryService, {})

    const service = lane.ctx.get('zoteroLibrary') as ZoteroLibraryService
    const browseSpy = vi
      .spyOn(lane.ctx.zotero, 'browse')
      .mockResolvedValueOnce(browseResult({ total: 3 }))

    const result = await service.browse(
      {
        library: { type: 'user', id: 0 },
        kind: 'collections',
        offset: 0,
        limit: 10_000,
      },
      LIVE_SIGNAL,
    )

    const forwarded = browseSpy.mock.calls[0]?.[0]
    // maxBrowseResults defaults to 50: the oversized page comes back clamped.
    expect(forwarded.limit).toBe(50)
    expect(result.limit).toBe(50)
    expect(result.total).toBe(3)
  })

  it('clamps search pages to maxSearchResults and echoes the effective limit', async () => {
    lane = await setupHostLane()
    await lane.ctx.plugin(ZoteroLibraryService, {})

    const service = lane.ctx.get('zoteroLibrary') as ZoteroLibraryService
    const searchSpy = vi
      .spyOn(lane.ctx.zotero, 'search')
      .mockResolvedValueOnce(searchResult({ total: 1 }))

    const result = await service.search(
      {
        scope: { kind: 'library' },
        library: { type: 'user', id: 0 },
        sort: 'dateModified',
        direction: 'desc',
        offset: 0,
        limit: 50,
        q: 'attention',
      },
      LIVE_SIGNAL,
    )

    const forwarded = searchSpy.mock.calls[0]?.[0]
    // maxSearchResults defaults to 20: the panel's 50-row ask pages at 20.
    expect(forwarded.limit).toBe(20)
    expect(result.limit).toBe(20)
    // The panel's search policy rides the options argument, not the request.
    expect(searchSpy.mock.calls[0]?.[2]).toEqual({ includeSupplemental: false })
    expect(forwarded.query).toBe('attention')
  })

  it('forwards item requests to ctx.zotero.get', async () => {
    lane = await setupHostLane()
    await lane.ctx.plugin(ZoteroLibraryService, {})

    const service = lane.ctx.get('zoteroLibrary') as ZoteroLibraryService
    const mockDetail: ZoteroItemDetail = {
      ref: 'zotero://user/0/item/ABCD1234',
      itemType: 'journalArticle',
      title: 'Paper 1',
      creators: [],
      abstractTruncated: false,
      tags: [],
      collections: [],
      relations: [],
      children: { total: 0 },
      bestAttachment: undefined,
    }
    const getSpy = vi.spyOn(lane.ctx.zotero, 'get').mockResolvedValueOnce(mockDetail)

    const request = {
      ref: 'zotero://user/0/item/ABCD1234',
      include: [] as const,
    }
    const result = await service.item(request, LIVE_SIGNAL)

    expect(getSpy).toHaveBeenCalledWith(itemRequestOf(request), LIVE_SIGNAL)
    expect(result.ref).toBe('zotero://user/0/item/ABCD1234')
    expect(result.title).toBe('Paper 1')
    expect(result.itemType).toBe('journalArticle')
  })

  it('forwards child-page requests to ctx.zotero.childPage and maps the view back', async () => {
    lane = await setupHostLane()
    await lane.ctx.plugin(ZoteroLibraryService, {})

    const service = lane.ctx.get('zoteroLibrary') as ZoteroLibraryService
    const mockPage: ZoteroChildPage = {
      kind: 'notes',
      page: {
        total: 1,
        returned: 1,
        offset: 0,
        limit: 50,
        items: [{ ref: 'zotero://user/0/item/NOTE0001', text: 'Note', truncated: false }],
      },
    }
    const childPageSpy = vi.spyOn(lane.ctx.zotero, 'childPage').mockResolvedValueOnce(mockPage)

    const request = {
      ref: 'zotero://user/0/item/ABCD1234',
      kind: 'notes' as const,
      offset: 0,
      limit: 50,
    }
    const result = await service.childPage(request, LIVE_SIGNAL)

    expect(childPageSpy).toHaveBeenCalledWith(childPageRequestOf(request), LIVE_SIGNAL)
    expect(result).toEqual({
      kind: 'notes',
      page: {
        total: 1,
        returned: 1,
        offset: 0,
        limit: 50,
        items: [{ ref: 'zotero://user/0/item/NOTE0001', text: 'Note', truncated: false }],
      },
    })
    // The remaining view arms map their own row shapes.
    childPageSpy.mockResolvedValueOnce({
      kind: 'attachments',
      page: {
        total: 1,
        returned: 1,
        offset: 0,
        limit: 50,
        items: [
          {
            ref: 'zotero://user/0/item/ATTA0001',
            title: 'paper.pdf',
            contentType: 'application/pdf',
          },
        ],
      },
    })
    const attachments = await service.childPage(
      { ref: 'zotero://user/0/item/ABCD1234', kind: 'attachments', offset: 0, limit: 50 },
      LIVE_SIGNAL,
    )
    expect(attachments).toEqual({
      kind: 'attachments',
      page: {
        total: 1,
        returned: 1,
        offset: 0,
        limit: 50,
        items: [
          {
            ref: 'zotero://user/0/item/ATTA0001',
            title: 'paper.pdf',
            contentType: 'application/pdf',
          },
        ],
      },
    })
    childPageSpy.mockResolvedValueOnce({
      kind: 'annotations',
      page: {
        total: 1,
        returned: 1,
        offset: 0,
        limit: 50,
        items: [
          {
            ref: 'zotero://user/0/item/ANNO0001',
            type: 'highlight',
            text: 'x',
            comment: 'c',
            color: '#fff',
            pageLabel: '7',
            parentRef: 'zotero://user/0/item/ATTA0001',
          },
        ],
      },
    })
    const annotations = await service.childPage(
      { ref: 'zotero://user/0/item/ABCD1234', kind: 'annotations', offset: 0, limit: 50 },
      LIVE_SIGNAL,
    )
    expect(annotations.page.items[0]).toEqual({
      ref: 'zotero://user/0/item/ANNO0001',
      type: 'highlight',
      text: 'x',
      comment: 'c',
      color: '#fff',
      pageLabel: '7',
      parentRef: 'zotero://user/0/item/ATTA0001',
    })
  })

  it('suppresses the schema-generated settings page on the library namespace', async () => {
    lane = await setupHostLane()
    await lane.ctx.plugin(ZoteroLibraryService, {})
    expect(lane.configureCalls).toContainEqual({ auto: false })
  })

  it('childPage: rejects a ref that does not parse before any service call', async () => {
    lane = await setupHostLane()
    await lane.ctx.plugin(ZoteroLibraryService, {})
    let calls = 0
    const zotero = lane.ctx.get('zotero')!
    const origChildPage = zotero.childPage?.bind(zotero)
    try {
      zotero.childPage = async () => {
        calls += 1
        throw new Error('unreachable')
      }
      const service = lane.ctx.get('zoteroLibrary') as ZoteroLibraryService
      await expect(
        service.childPage(
          { ref: 'not-a-zotero-ref', kind: 'notes', offset: 0, limit: 50 },
          LIVE_SIGNAL,
        ),
      ).rejects.toThrow()
      expect(calls).toBe(0)
    } finally {
      if (origChildPage !== undefined) zotero.childPage = origChildPage
    }
  })

  it('item: rejects a ref that does not parse before any service call', async () => {
    lane = await setupHostLane()
    await lane.ctx.plugin(ZoteroLibraryService, {})
    let calls = 0
    const zotero = lane.ctx.get('zotero')!
    const origGet = zotero.get.bind(zotero)
    try {
      zotero.get = async () => {
        calls += 1
        throw new Error('unreachable')
      }
      const service = lane.ctx.get('zoteroLibrary') as ZoteroLibraryService
      await expect(
        service.item({ ref: 'not-a-zotero-ref', include: [] }, LIVE_SIGNAL),
      ).rejects.toThrow()
      expect(calls).toBe(0)
    } finally {
      zotero.get = origGet
    }
  })

  it('delegates write requests to executeLibraryWrite with capability gating', async () => {
    lane = await setupHostLane({ writeEnabled: false })
    await lane.ctx.plugin(ZoteroLibraryService, {})

    const service = lane.ctx.get('zoteroLibrary') as ZoteroLibraryService
    const writeRequest = {
      sessionId: 'test-session',
      operation: 'createNote' as const,
      args: { markdown: 'test note' },
    }

    await expect(service.write(writeRequest, LIVE_SIGNAL)).rejects.toMatchObject({
      details: { code: ZOTERO_CAPABILITY_UNAVAILABLE },
    })
  })
})
