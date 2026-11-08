/** Panel preferences commit through the production Loader without restarting the component. */
import { afterEach, expect, it } from 'vitest'
import { setupCompositionLane, type CompositionLane } from '../../helpers/lanes/composition-lane.js'
import { resolveLibraryConfig } from '../../../src/library/config.js'
let lane: CompositionLane | undefined
afterEach(async () => {
  await lane?.dispose()
  lane = undefined
})
it('accepts every panel preference through a live entry update', async () => {
  lane = await setupCompositionLane()
  const entry = [...lane.context.loader.entries()].find((row) => row.options.id === 'library')!
  const config = lane.context.zoteroLibrary.config
  const changes = {
    rightSidebarEnabled: false,
    listDensity: 'compact',
    titleLines: 1,
    detailExpandedSections: [],
    localPdfOpenTarget: 'float',
    urlPdfOpenTarget: 'float',
    allowUrlPdfRead: true,
    reopenBehavior: 'allItems',
    scopeChangeBehavior: 'clear',
    defaultCopyFormat: 'csv',
    chatInsertContent: 'referenceAndAbstract',
  } as const
  await entry.update({ config: changes })
  expect(lane.context.zoteroLibrary.config).toBe(config)
  expect(resolveLibraryConfig(config)).toEqual(changes)
})
it('keeps the accepted settings after a duplicate disclosure is rejected', async () => {
  lane = await setupCompositionLane()
  const entry = [...lane.context.loader.entries()].find((row) => row.options.id === 'library')!
  await entry.update({ config: { listDensity: 'compact' } })
  await entry.update({
    config: { listDensity: 'comfortable', detailExpandedSections: ['notes', 'notes'] },
  })
  expect(resolveLibraryConfig(lane.context.zoteroLibrary.config).listDensity).toBe('compact')
  await entry.update({ config: { listDensity: 'comfortable', detailExpandedSections: [] } })
  expect(resolveLibraryConfig(lane.context.zoteroLibrary.config).detailExpandedSections).toEqual([])
})
