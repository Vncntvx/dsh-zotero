/**
 * Attachment location resolver singleton tests.
 * @module tests/client/actions/attachment-resolver
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  getAttachmentResolver,
  setAttachmentResolver,
  type AttachmentResolver,
} from '../../../src/client/actions/attachment-resolver.ts'

afterEach(() => {
  setAttachmentResolver(undefined)
})

describe('attachment-resolver singleton', () => {
  it('defaults to undefined', () => {
    expect(getAttachmentResolver()).toBeUndefined()
  })

  it('stores and retrieves the active resolver', () => {
    const fakeResolver: AttachmentResolver = async (ref) => ({
      ok: true,
      value: {
        ref,
        kind: 'file',
        title: 'sample.pdf',
        contentType: 'application/pdf',
        path: '/tmp/sample.pdf',
      },
    })

    setAttachmentResolver(fakeResolver)
    expect(getAttachmentResolver()).toBe(fakeResolver)
  })

  it('can be cleared back to undefined', () => {
    const fakeResolver: AttachmentResolver = async (ref) => ({
      ok: true,
      value: {
        ref,
        kind: 'url',
        title: 'web.pdf',
        contentType: 'application/pdf',
        url: 'https://example.com/web.pdf',
      },
    })

    setAttachmentResolver(fakeResolver)
    expect(getAttachmentResolver()).toBe(fakeResolver)

    setAttachmentResolver(undefined)
    expect(getAttachmentResolver()).toBeUndefined()
  })
})
