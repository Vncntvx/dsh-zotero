/**
 * The `zoteroLibrary.export` host endpoint: the live `maxExportRefs` gate,
 * the omitted style/locale hand-off to the export domain's configured
 * defaults, the domain→wire mapping, and domain error passthrough. The panel
 * never dispatches `zotero_export`; this endpoint is its only export path and
 * it serves the provider's text arm (`service.exportText`), so the wire view
 * never carries per-document itemization.
 * @module tests/library-export-service
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZoteroLibraryService } from '../../src/library/service.js'
import type { Options } from '../../src/config.js'
import { exportRefsOverCapMessage } from '../../src/export-limits.js'
import {
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_INVALID_REF,
  ZOTERO_NOT_FOUND,
  ZoteroError,
} from '../../src/errors.js'
import type { ZoteroExportTextResult } from '../../src/types.js'
import { type HostLane, setupHostLane } from '../helpers/lanes/host-lane.js'

const LIVE_SIGNAL = new AbortController().signal
const ITEM_REF = 'zotero://user/0/item/ITEMKEY1'
/** `ITEM_REF` in domain form: the ref the export request must carry. */
const DOMAIN_ITEM_REF = {
  library: { type: 'user', id: 0 },
  kind: 'item',
  key: 'ITEMKEY1',
} as const

let lane: HostLane | undefined

afterEach(async () => {
  await lane?.ctx.fiber.dispose()
  await lane?.teardown()
  lane = undefined
  vi.restoreAllMocks()
})

/** Boot the lane with the library service and return the endpoint under test. */
async function setupExportService(
  config: Options = {},
): Promise<{ lane: HostLane; service: ZoteroLibraryService }> {
  lane = await setupHostLane(config)
  await lane.ctx.plugin(ZoteroLibraryService, {})
  return { lane, service: lane.ctx.get('zoteroLibrary') as ZoteroLibraryService }
}

describe('the zoteroLibrary export endpoint', () => {
  it('forwards one item ref and maps a translator export back to the wire view', async () => {
    const { lane, service } = await setupExportService()
    const domainResult: ZoteroExportTextResult = {
      format: 'bibtex',
      text: '  @article{doe2020,\n    title = {Paper 1}\n  }\n',
    }
    const exportSpy = vi.spyOn(lane.ctx.zotero, 'exportText').mockResolvedValueOnce(domainResult)

    const view = await service.export({ refs: [ITEM_REF], format: 'bibtex' }, LIVE_SIGNAL)

    expect(exportSpy).toHaveBeenCalledWith(
      { refs: [DOMAIN_ITEM_REF], format: 'bibtex' },
      LIVE_SIGNAL,
    )
    // The panel renders the opaque body only: no per-document itemization.
    expect(view).toEqual(domainResult)
    expect('items' in view).toBe(false)
  })

  it('maps a translator result without inventing optional fields', async () => {
    const { lane, service } = await setupExportService()
    // RIS has no key of its own; the panel never receives located entries, so
    // the strict codec sees only the format and the body.
    const exportSpy = vi
      .spyOn(lane.ctx.zotero, 'exportText')
      .mockResolvedValueOnce({ format: 'ris', text: 'TY  - JOUR\n' })

    const view = await service.export({ refs: [ITEM_REF], format: 'ris' }, LIVE_SIGNAL)

    expect(exportSpy).toHaveBeenCalledWith({ refs: [DOMAIN_ITEM_REF], format: 'ris' }, LIVE_SIGNAL)
    expect(view).toStrictEqual({
      format: 'ris',
      text: 'TY  - JOUR\n',
    })
  })

  it('rejects a ref list past the live maxExportRefs cap before calling the domain', async () => {
    const { lane, service } = await setupExportService({ maxExportRefs: 2 })
    const exportSpy = vi.spyOn(lane.ctx.zotero, 'exportText')
    const refs = Array.from({ length: 3 }, (_, index) => `zotero://user/0/item/ABC0000${index}`)

    await expect(service.export({ refs, format: 'citation' }, LIVE_SIGNAL)).rejects.toMatchObject({
      details: { code: ZOTERO_INVALID_ARGUMENT },
      // The tool and the endpoint refuse with one shared message.
      message: exportRefsOverCapMessage(2, 3),
    })
    expect(exportSpy).not.toHaveBeenCalled()
  })

  it('leaves omitted style/locale to the host defaults and forwards supplied ones', async () => {
    const { lane, service } = await setupExportService()
    const exportSpy = vi.spyOn(lane.ctx.zotero, 'exportText')
    // The domain answers with the resolved CSL facts; the wire view carries
    // them so the panel shows the same style/locale the tool used.
    exportSpy.mockResolvedValueOnce({
      format: 'bibliography',
      style: 'vancouver',
      locale: 'en-US',
      text: '[1] Doe. Paper 1.',
    })

    const defaultsView = await service.export(
      { refs: [ITEM_REF], format: 'bibliography' },
      LIVE_SIGNAL,
    )
    expect(exportSpy.mock.calls[0]?.[0]).toEqual({
      refs: [DOMAIN_ITEM_REF],
      format: 'bibliography',
    })
    expect(defaultsView).toMatchObject({ style: 'vancouver', locale: 'en-US' })

    exportSpy.mockResolvedValueOnce({
      format: 'citation',
      style: 'apa',
      locale: 'de-DE',
      citations: [{ ref: ITEM_REF, text: '(Doe, 2020)' }],
    })
    const explicitView = await service.export(
      { refs: [ITEM_REF], format: 'citation', style: 'apa', locale: 'de-DE' },
      LIVE_SIGNAL,
    )
    expect(exportSpy.mock.calls[1]?.[0]).toEqual({
      refs: [DOMAIN_ITEM_REF],
      format: 'citation',
      style: 'apa',
      locale: 'de-DE',
    })
    expect(explicitView).toEqual({
      format: 'citation',
      style: 'apa',
      locale: 'de-DE',
      citations: [{ ref: ITEM_REF, text: '(Doe, 2020)' }],
    })
  })

  it('surfaces a domain failure as the zotero/domain error with its stable code', async () => {
    const { lane, service } = await setupExportService()
    vi.spyOn(lane.ctx.zotero, 'exportText').mockRejectedValueOnce(
      new ZoteroError('Zotero did not return an item for the ref.', ZOTERO_NOT_FOUND),
    )

    await expect(
      service.export({ refs: [ITEM_REF], format: 'citation' }, LIVE_SIGNAL),
    ).rejects.toMatchObject({
      code: 'zotero/domain',
      message: 'Zotero did not return an item for the ref.',
      details: { code: ZOTERO_NOT_FOUND },
    })
  })

  it('rejects a ref the grammar cannot parse before calling the domain', async () => {
    const { lane, service } = await setupExportService()
    const exportSpy = vi.spyOn(lane.ctx.zotero, 'exportText')

    // Shape-valid on the wire (a non-empty string) but outside the ref
    // grammar; the shared parser owns the refusal.
    await expect(
      service.export({ refs: ['not-a-zotero-ref'], format: 'bibtex' }, LIVE_SIGNAL),
    ).rejects.toMatchObject({ details: { code: ZOTERO_INVALID_REF } })
    expect(exportSpy).not.toHaveBeenCalled()
  })
})
