/**
 * The library view store: whole-record session writes with an LRU bound, the
 * pre-probe read, per-instance isolation, the occurrence memories, and the
 * dispose that ends every entry.
 *
 * The store replaced a module-scoped cache, so its ownership is part of the
 * contract: nothing here survives `dispose`, and two Zotero instances never
 * answer each other's reads.
 * @module tests/client/library/library-view-store
 */

import { describe, expect, it, vi } from 'vitest'
import type { ZoteroStatusView } from '../../../src/client/remote.ts'
import { statusView } from '../../helpers/status-view.ts'
import {
  createLibraryViewStore,
  SCROLL_SAVE_DELAY_MS,
  type LibraryViewStore,
} from '../../../src/client/components/library/library-view-store.ts'

/** A connected probe snapshot naming its instance. */
const probeOf = (serverId: string): ZoteroStatusView => statusView({ serverId })

/** A fresh store per case: the cache used to be module-scoped. */
const storeOf = (): LibraryViewStore => createLibraryViewStore()

describe('the library view store session cache', () => {
  it('replaces the whole record instead of merging fields', () => {
    const store = storeOf()
    store.writeSessionView('S1', 's1', { lastProbeData: probeOf('S1') })
    store.writeSessionView('S1', 's1', { inspector: { phase: 'error', message: 'gone' } })

    const view = store.sessionView('S1', 's1')
    expect(view?.inspector).toEqual({ phase: 'error', message: 'gone' })
    expect(view?.lastProbeData).toBeUndefined()
  })

  it('keeps at most eight sessions and drops the least recent', () => {
    const store = storeOf()
    for (let index = 0; index < 9; index += 1) {
      store.writeSessionView(`S${index}`, `s${index}`, { lastProbeData: probeOf(`S${index}`) })
    }

    expect(store.sessionView('S0', 's0')).toBeUndefined()
    // An intermediate entry survives: the bound is eight, not merely "the
    // oldest went away".
    expect(store.sessionView('S1', 's1')).toBeDefined()
    expect(store.sessionView('S8', 's8')?.lastProbeData?.serverId).toBe('S8')
  })

  it('counts a rewrite as recent, so the rewritten session survives the next eviction', () => {
    const store = storeOf()
    for (let index = 0; index < 8; index += 1) {
      store.writeSessionView(`S${index}`, `s${index}`, { lastProbeData: probeOf(`S${index}`) })
    }
    store.writeSessionView('S0', 's0', { lastProbeData: probeOf('S0-again') })
    store.writeSessionView('S8', 's8', { lastProbeData: probeOf('S8') })

    expect(store.sessionView('S0', 's0')?.lastProbeData?.serverId).toBe('S0-again')
    expect(store.sessionView('S1', 's1')).toBeUndefined()
    expect(store.sessionView('S2', 's2')).toBeDefined()
  })

  it('clears one session or every session', () => {
    const store = storeOf()
    store.writeSessionView('S1', 's1', { lastProbeData: probeOf('S1') })
    store.writeSessionView('S1', 's2', { lastProbeData: probeOf('S2') })

    store.clearSessionView('S1', 's1')
    expect(store.sessionView('S1', 's1')).toBeUndefined()
    expect(store.sessionView('S1', 's2')).toBeDefined()

    store.clearSessionView()
    expect(store.sessionView('S1', 's2')).toBeUndefined()
  })
})

describe('the library view store instance isolation', () => {
  it('never answers one instance with another instance’s payload', () => {
    // The cache used to be keyed by session id alone, so switching the
    // connected Zotero handed the old item payload to the new inspector.
    const store = storeOf()
    store.writeSessionView('S1', 's1', { lastProbeData: probeOf('S1') })
    store.writeSessionView('S2', 's1', { lastProbeData: probeOf('S2') })

    expect(store.sessionView('S1', 's1')?.lastProbeData?.serverId).toBe('S1')
    expect(store.sessionView('S2', 's1')?.lastProbeData?.serverId).toBe('S2')
  })

  it('answers the pre-probe read only when the session is unambiguous', () => {
    const store = storeOf()
    store.writeSessionView('S1', 's1', { lastProbeData: probeOf('S1') })
    // One candidate: the panel may paint before the probe names the instance.
    expect(store.sessionView(undefined, 's1')?.lastProbeData?.serverId).toBe('S1')

    // Two instances: the pre-probe read answers nothing rather than guessing.
    store.writeSessionView('S2', 's1', { lastProbeData: probeOf('S2') })
    expect(store.sessionView(undefined, 's1')).toBeUndefined()
    expect(store.sessionView('S2', 's1')?.lastProbeData?.serverId).toBe('S2')
  })

  it('drops every entry on dispose and refuses later writes', () => {
    const store = storeOf()
    store.writeSessionView('S1', 's1', { lastProbeData: probeOf('S1') })
    const signal = new AbortController()
    store.viewMemory(signal.signal, 'S1', 's1')

    store.dispose()
    expect(store.sessionView('S1', 's1')).toBeUndefined()
    expect(store.sessionView(undefined, 's1')).toBeUndefined()
    // A disposed store keeps answering structurally but remembers nothing.
    store.writeSessionView('S1', 's1', { lastProbeData: probeOf('S1') })
    expect(store.sessionView('S1', 's1')).toBeUndefined()
  })
})

describe('the library view store occurrence memory', () => {
  it('keeps one memory per tab occurrence and instance', () => {
    const store = storeOf()
    const tab = new AbortController()
    const first = store.viewMemory(tab.signal, 'S1', 's1')
    expect(store.viewMemory(tab.signal, 'S1', 's1')).toBe(first)
    const other = store.viewMemory(tab.signal, 'S2', 's1')
    expect(other).not.toBe(first)
  })

  it('clears a view in place, so a live body keeps its object and resets', () => {
    const store = storeOf()
    const tab = new AbortController()
    const memory = store.viewMemory(tab.signal, 'S1', 's1')
    memory.scroll.list = 70
    memory.childPages = { ref: 'ref', offsets: { notes: 20 } }

    store.clearView('S1', 's1')
    expect(memory.scroll).toEqual({})
    expect(memory.childPages).toBeUndefined()
    expect(memory.resetPending).toBe(true)
  })

  it('clears every instance of one conversation, and only that conversation', () => {
    const store = storeOf()
    const tab = new AbortController()
    const one = store.viewMemory(tab.signal, 'S1', 's1')
    const two = store.viewMemory(tab.signal, 'S2', 's1')
    const other = store.viewMemory(tab.signal, 'S1', 's2')

    store.clearConversation('s1')
    expect(one.resetPending).toBe(true)
    expect(two.resetPending).toBe(true)
    expect(other.resetPending).toBeUndefined()
  })

  it('saves a closing tab’s scroll once when the tab owned the position', () => {
    vi.useFakeTimers()
    try {
      const store = storeOf()
      const tab = new AbortController()
      const memory = store.viewMemory(tab.signal, 'S1', 's1')
      const saved = vi.fn()
      memory.saveScroll = saved
      memory.saveScrollKey = JSON.stringify(['S1', 's1'])
      memory.scheduleScrollSave()
      tab.abort()
      // The pending timer is flushed by the abort, not left behind.
      vi.advanceTimersByTime(SCROLL_SAVE_DELAY_MS * 2)
      expect(saved).toHaveBeenCalledTimes(1)
      expect(saved).toHaveBeenCalledWith(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops a superseded mount’s pending scroll write instead of trampling the newer one', () => {
    vi.useFakeTimers()
    try {
      const store = storeOf()
      const tab = new AbortController()
      const memory = store.viewMemory(tab.signal, 'S1', 's1')
      const saved = vi.fn()
      memory.saveScroll = saved
      // The feed rewrote the owner to another key after this mount scheduled.
      memory.saveScrollKey = JSON.stringify(['S1', 's2'])
      memory.scheduleScrollSave()
      tab.abort()
      vi.advanceTimersByTime(SCROLL_SAVE_DELAY_MS * 2)
      expect(saved).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
