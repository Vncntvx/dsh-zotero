/**
 * The shared browser-face stub is the one typed fixture: it satisfies the
 * complete live face, clears the notice it publishes, and honours overrides.
 * @module tests/client/helpers/zotero-client
 */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { ZoteroClientFace } from '../../../src/client/actions/client-face.ts'
import { zoteroClientStub } from './zotero-client.ts'

describe('zoteroClientStub', () => {
  it('satisfies the complete five-member client face', () => {
    const face = zoteroClientStub()
    expectTypeOf(face).toEqualTypeOf<ZoteroClientFace>()
    expect(Object.keys(face).sort()).toEqual([
      'dismissProtocolNotice',
      'openProtocol',
      'protocolNotice',
      'reportClientError',
      'resolveAttachment',
    ])
  })

  it('clears a preset protocol notice through the dismisser', () => {
    const face = zoteroClientStub({}, { seq: 7 })
    expect(face.protocolNotice.getSnapshot()).toEqual({ seq: 7 })
    face.dismissProtocolNotice()
    expect(face.protocolNotice.getSnapshot()).toBeNull()
  })

  it('clears an overridden protocol notice through the default dismisser', () => {
    const notice = createSnapshotStore<{ seq: number } | null>({ seq: 3 })
    const face = zoteroClientStub({ protocolNotice: notice })
    face.dismissProtocolNotice()
    expect(notice.getSnapshot()).toBeNull()
  })

  it('resolves an attachment and uses the members an overriding spec supplies', async () => {
    const reportClientError = vi.fn(async () => {})
    const face = zoteroClientStub({ reportClientError })
    expect(face.reportClientError).toBe(reportClientError)
    await expect(face.resolveAttachment('zotero://user/0/item/ABCD1234')).resolves.toMatchObject({
      ok: true,
      value: { kind: 'file' },
    })
  })
})
