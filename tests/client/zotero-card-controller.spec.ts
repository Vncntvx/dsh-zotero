/**
 * The Zotero card controller: field projection over the `zotero` namespace
 * and the inject face it hands to the slot registration.
 * @module tests/client/zotero-card-controller
 */

import { describe, expect, it } from 'vitest'
import { ZoteroCardController } from '../../src/client/zotero-card-controller.ts'
import { fakeScope } from './helpers/fake-scope.ts'

describe('ZoteroCardController', () => {
  it('projects every Config field from the namespace section', () => {
    const scope = fakeScope({
      value: {
        baseUrl: 'http://127.0.0.1:23119/api',
        provider: 'local',
        timeoutMs: 5000,
        maxSearchResults: 20,
        defaultStyle: 'apa',
      },
      base: { baseUrl: 'http://127.0.0.1:23119/api' },
    })
    const controller = new ZoteroCardController(scope)
    const state = controller.inject().hooks.zoteroCard.getSnapshot()
    expect(state.baseUrl.text).toBe('http://127.0.0.1:23119/api')
    expect(state.baseUrl.overridden).toBe(false)
    expect(state.provider.text).toBe('local')
    expect(state.timeoutMs.text).toBe('5000')
    expect(state.maxSearchResults.text).toBe('20')
    expect(state.defaultStyle.text).toBe('apa')
    // Fields the section does not carry render empty rather than a fake value.
    expect(state.maxExportRefs.text).toBe('')
    expect(state.available).toBe(true)
  })

  it('marks user-layer presence as overridden, not value equality', () => {
    const scope = fakeScope({
      value: { timeoutMs: 5000 },
      user: { timeoutMs: 5000 },
    })
    const controller = new ZoteroCardController(scope)
    const state = controller.inject().hooks.zoteroCard.getSnapshot()
    expect(state.timeoutMs.overridden).toBe(true)
  })

  it('publishes a fresh projection when the scope changes', () => {
    const scope = fakeScope({ value: { timeoutMs: 5000 } })
    const controller = new ZoteroCardController(scope)
    const store = controller.inject().hooks.zoteroCard
    const before = store.getSnapshot()
    void scope.set('timeoutMs', 7000)
    expect(store.getSnapshot()).not.toBe(before)
    expect(store.getSnapshot().timeoutMs.text).toBe('7000')
  })

  it('exposes the write actions the card binds', () => {
    const scope = fakeScope({ value: {} })
    const controller = new ZoteroCardController(scope)
    const face = controller.inject()
    expect(typeof face.edit).toBe('function')
    expect(typeof face.resetField).toBe('function')
    expect(typeof face.save).toBe('function')
    expect(typeof face.discard).toBe('function')
    expect(typeof face.hooks.zoteroCard.getSnapshot).toBe('function')
    expect(typeof face.hooks.zoteroCard.subscribe).toBe('function')
  })

  it('reports an unavailable namespace through the shell', () => {
    const controller = new ZoteroCardController(fakeScope({ status: 'unavailable' }))
    const state = controller.inject().hooks.zoteroCard.getSnapshot()
    expect(state.available).toBe(false)
  })
})
