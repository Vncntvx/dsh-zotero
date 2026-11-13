// @vitest-environment jsdom
/**
 * Each component disclosure's acknowledgement against real `localStorage`: the
 * dismissal survives a reload while the component stays on, clearing the store
 * re-opens the notice, turning the component off revokes the acknowledgement so
 * the next enable asks again, the two components keep separate keys, and a
 * storage that refuses reads, writes, or removal still honours the enable-period
 * contract for the rest of the session.
 * @module tests/client/enable-notice-storage
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EnableNoticeArbiter,
  EnableNoticeController,
  ENRICHMENT_EGRESS_ACK_KEY,
  SCHOLARLY_RETRIEVAL_ACK_KEY,
  clientAcknowledgement,
  type EnableNoticeHookName,
  type NamespaceStatus,
} from '../../src/client/enable-notice.ts'
import { namespaceStatusSourceOf } from './helpers/namespace-status-source.ts'

/** One controller over the real browser acknowledgement for its key. */
function noticeOf<Hook extends EnableNoticeHookName>(
  hook: Hook,
  key: string,
  status: NamespaceStatus = 'ready',
) {
  const source = namespaceStatusSourceOf(status)
  const controller = new EnableNoticeController(
    source,
    hook,
    clientAcknowledgement(key),
    new EnableNoticeArbiter(),
  )
  return {
    controller,
    source,
    open: () => controller.inject().hooks[hook].getSnapshot().open,
  }
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('the egress acknowledgement', () => {
  it('persists a dismissal across a reload while the component stays on', () => {
    const first = noticeOf('enrichmentEnableNotice', ENRICHMENT_EGRESS_ACK_KEY)
    expect(first.open()).toBe(true)
    first.controller.dismiss()
    expect(first.open()).toBe(false)
    expect(localStorage.getItem(ENRICHMENT_EGRESS_ACK_KEY)).toBe('1')
    first.controller.dispose()

    const second = noticeOf('enrichmentEnableNotice', ENRICHMENT_EGRESS_ACK_KEY)
    expect(second.open()).toBe(false)
    second.controller.dispose()
  })

  it('revokes the acknowledgement when the component is turned off', () => {
    const notice = noticeOf('enrichmentEnableNotice', ENRICHMENT_EGRESS_ACK_KEY)
    notice.controller.dismiss()
    expect(localStorage.getItem(ENRICHMENT_EGRESS_ACK_KEY)).toBe('1')

    notice.source.publish('unavailable')
    expect(notice.open()).toBe(false)
    expect(localStorage.getItem(ENRICHMENT_EGRESS_ACK_KEY)).toBeNull()

    // Turning it back on is a new authorization: the disclosure is owed again.
    notice.source.publish('ready')
    expect(notice.open()).toBe(true)
    notice.controller.dispose()
  })

  it('drops a stored acknowledgement when the client first sees the component off', () => {
    localStorage.setItem(SCHOLARLY_RETRIEVAL_ACK_KEY, '1')

    const notice = noticeOf('scholarlyEnableNotice', SCHOLARLY_RETRIEVAL_ACK_KEY, 'unavailable')
    expect(localStorage.getItem(SCHOLARLY_RETRIEVAL_ACK_KEY)).toBeNull()

    notice.source.publish('ready')
    expect(notice.open()).toBe(true)
    notice.controller.dispose()
  })

  it('re-opens the notice after the acknowledgement is cleared', () => {
    const first = noticeOf('scholarlyEnableNotice', SCHOLARLY_RETRIEVAL_ACK_KEY)
    first.controller.dismiss()
    first.controller.dispose()
    localStorage.clear()

    const second = noticeOf('scholarlyEnableNotice', SCHOLARLY_RETRIEVAL_ACK_KEY)
    expect(second.open()).toBe(true)
    second.controller.dispose()
  })

  it('keeps the scholarly acknowledgement from covering the enrichment disclosure', () => {
    const scholarly = noticeOf('scholarlyEnableNotice', SCHOLARLY_RETRIEVAL_ACK_KEY)
    scholarly.controller.dismiss()
    scholarly.controller.dispose()
    expect(localStorage.getItem(SCHOLARLY_RETRIEVAL_ACK_KEY)).toBe('1')
    expect(localStorage.getItem(ENRICHMENT_EGRESS_ACK_KEY)).toBeNull()

    // The enrichment component's disclosure is still owed in this browser.
    const enrichment = noticeOf('enrichmentEnableNotice', ENRICHMENT_EGRESS_ACK_KEY)
    expect(enrichment.open()).toBe(true)
    enrichment.controller.dispose()
  })

  it('keeps the disclosure owed when storage refuses a read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    const controller = noticeOf('enrichmentEnableNotice', ENRICHMENT_EGRESS_ACK_KEY)
    expect(controller.open()).toBe(true)
    controller.controller.dispose()
  })

  it('closes for this enable even when storage refuses a write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    const notice = noticeOf('enrichmentEnableNotice', ENRICHMENT_EGRESS_ACK_KEY)
    notice.controller.dismiss()
    expect(notice.open()).toBe(false)

    // The same controller must not re-open on the next form publish.
    notice.source.publish('ready')
    expect(notice.open()).toBe(false)
    notice.controller.dispose()

    // A fresh controller (a reload) still owes the disclosure: storage never
    // received the acknowledgement.
    const second = noticeOf('enrichmentEnableNotice', ENRICHMENT_EGRESS_ACK_KEY)
    expect(second.open()).toBe(true)
    second.controller.dispose()
  })

  it('revokes for a later enable even when storage refuses the removal', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    const notice = noticeOf('enrichmentEnableNotice', ENRICHMENT_EGRESS_ACK_KEY)
    notice.controller.dismiss()
    notice.source.publish('unavailable')
    expect(notice.open()).toBe(false)

    // The session-level revocation wins over the stale stored key.
    notice.source.publish('ready')
    expect(notice.open()).toBe(true)
    notice.controller.dispose()
  })
})
