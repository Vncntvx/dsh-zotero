// @vitest-environment jsdom
/**
 * The egress disclosure's per-client acknowledgement against real
 * `localStorage`: a dismissal survives a new controller, clearing the store
 * re-opens the notice, and a storage that refuses reads/writes keeps the
 * disclosure owed.
 * @module tests/client/enrichment/enable-notice-storage
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ENABLE_NOTICE_ACK_KEY,
  EnrichmentEnableNoticeController,
  type EnrichmentNamespaceStatus,
} from '../../../src/client/enrichment/enable-notice.ts'

function sourceOf(status: EnrichmentNamespaceStatus) {
  const listeners = new Set<() => void>()
  let current = status
  return {
    getSnapshot: () => ({ namespaceStatus: current }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

function openOf(controller: EnrichmentEnableNoticeController): boolean {
  const face = controller.inject()
  return face.hooks.enrichmentEnableNotice.getSnapshot().open
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('the egress acknowledgement', () => {
  it('persists a dismissal for the next controller in this browser', () => {
    const source = sourceOf('ready')
    const first = new EnrichmentEnableNoticeController(source)
    expect(openOf(first)).toBe(true)
    first.dismiss()
    expect(openOf(first)).toBe(false)
    expect(localStorage.getItem(ENABLE_NOTICE_ACK_KEY)).toBe('1')
    first.dispose()

    const second = new EnrichmentEnableNoticeController(source)
    expect(openOf(second)).toBe(false)
    second.dispose()
  })

  it('re-opens the notice after the acknowledgement is cleared', () => {
    const source = sourceOf('ready')
    const first = new EnrichmentEnableNoticeController(source)
    first.dismiss()
    first.dispose()
    localStorage.clear()

    const second = new EnrichmentEnableNoticeController(source)
    expect(openOf(second)).toBe(true)
    second.dispose()
  })

  it('keeps the disclosure owed when storage refuses a read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    const controller = new EnrichmentEnableNoticeController(sourceOf('ready'))
    expect(openOf(controller)).toBe(true)
    controller.dispose()
  })

  it('keeps the disclosure owed when storage refuses a write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    const source = sourceOf('ready')
    const first = new EnrichmentEnableNoticeController(source)
    first.dismiss()
    first.dispose()

    const second = new EnrichmentEnableNoticeController(source)
    expect(openOf(second)).toBe(true)
    second.dispose()
  })
})
