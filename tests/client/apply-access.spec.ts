/**
 * The literature panel's remote-access gating: the Host's access answers
 * decide which surfaces the browser shows, so a Peer without a grant never
 * sees an entry point whose call the Host would refuse.
 * @module tests/client/apply-access
 */

import { describe, expect, it } from 'vitest'
import { applyEntry, fakeWorld } from './helpers/apply-world.ts'

describe('the literature panel access gate', () => {
  it('registers the panel for the owner', async () => {
    const world = fakeWorld()
    await applyEntry(world)

    // The panel and the parsed-document page it opens are one surface group.
    expect(world.sidebarRightTabDefinitions).toHaveLength(2)
    expect(world.contextMenuRegistrations.length).toBeGreaterThan(0)
  })

  it('registers no library surface when the browse grant is missing', async () => {
    const world = fakeWorld()
    world.grantedActions.delete('zotero/browse')
    await applyEntry(world)

    expect(world.sidebarRightTabDefinitions).toEqual([])
    expect(world.contextMenuRegistrations).toEqual([])
  })

  it('keeps the panel when only the write grant is missing', async () => {
    const world = fakeWorld()
    world.grantedActions.delete('zotero/write')
    await applyEntry(world)

    expect(world.sidebarRightTabDefinitions).toHaveLength(2)
  })

  it('declares the access seam the panel reads', async () => {
    const world = fakeWorld()
    await applyEntry(world)

    expect(world.injectDeps).toContainEqual(expect.arrayContaining(['remoteAccess']))
  })
})
