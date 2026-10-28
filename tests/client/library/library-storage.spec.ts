/**
 * The library view cache: whole-record writes, the per-session LRU bound, and
 * the clear seams the panel and the plugin teardown call.
 * @module tests/client/library/library-storage
 */

import { describe, expect, it } from 'vitest'
import type { ZoteroStatusView } from '../../../src/client/remote.ts'
import {
  clearLibrarySessionMemory,
  readLibrarySessionMemory,
  writeLibrarySessionView,
} from '../../../src/client/components/library/library-storage.ts'

/** A connected probe snapshot naming its instance. */
const probeOf = (serverId: string): ZoteroStatusView => ({
  providerId: 'local',
  connected: true,
  serverId,
})

describe('library session view', () => {
  it('replaces the whole record instead of merging fields', () => {
    writeLibrarySessionView('s1', { lastProbeData: probeOf('S1') })
    writeLibrarySessionView('s1', { inspector: { phase: 'error', message: 'gone' } })

    const view = readLibrarySessionMemory('s1')
    expect(view?.inspector).toEqual({ phase: 'error', message: 'gone' })
    expect(view?.lastProbeData).toBeUndefined()
  })

  it('keeps at most eight sessions and drops the least recent', () => {
    for (let index = 0; index < 9; index += 1) {
      writeLibrarySessionView(`s${index}`, { lastProbeData: probeOf(`S${index}`) })
    }

    expect(readLibrarySessionMemory('s0')).toBeUndefined()
    expect(readLibrarySessionMemory('s8')?.lastProbeData?.serverId).toBe('S8')
  })

  it('counts a rewrite as recent, so the rewritten session survives the next eviction', () => {
    for (let index = 0; index < 8; index += 1) {
      writeLibrarySessionView(`s${index}`, { lastProbeData: probeOf(`S${index}`) })
    }
    writeLibrarySessionView('s0', { lastProbeData: probeOf('S0-again') })
    writeLibrarySessionView('s8', { lastProbeData: probeOf('S8') })

    expect(readLibrarySessionMemory('s0')?.lastProbeData?.serverId).toBe('S0-again')
    expect(readLibrarySessionMemory('s1')).toBeUndefined()
  })

  it('clears one session or every session', () => {
    writeLibrarySessionView('s1', { lastProbeData: probeOf('S1') })
    writeLibrarySessionView('s2', { lastProbeData: probeOf('S2') })

    clearLibrarySessionMemory('s1')
    expect(readLibrarySessionMemory('s1')).toBeUndefined()
    expect(readLibrarySessionMemory('s2')).toBeDefined()

    clearLibrarySessionMemory()
    expect(readLibrarySessionMemory('s2')).toBeUndefined()
  })
})
