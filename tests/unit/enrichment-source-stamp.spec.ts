/**
 * The source-index stamp comparison: local file stamps compare size and mtime,
 * URL stamps require common freshness validators, and byte stamps compare
 * fingerprints. Source identities are canonical and independent of parse mode.
 * @module tests/unit/enrichment-source-stamp
 */

import { describe, expect, it } from 'vitest'
import { sourceKeyOf, stampMatches } from '../../src/enrichment/source-stamp.ts'
import {
  ATTACHMENT_KEY,
  GROUP_LIBRARY,
  SECOND_ITEM_KEY,
  attachmentRef,
  itemRef,
  refOf,
} from '../helpers/server/keys.ts'

describe('sourceKeyOf', () => {
  it('is a stable digest of one attachment identity', () => {
    const key = sourceKeyOf(attachmentRef())
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(sourceKeyOf(attachmentRef())).toBe(key)
    expect(sourceKeyOf(attachmentRef(SECOND_ITEM_KEY))).not.toBe(key)
    expect(sourceKeyOf(refOf('attachment', ATTACHMENT_KEY, GROUP_LIBRARY))).not.toBe(key)
  })

  it('canonicalizes URL host and default port before hashing', () => {
    expect(sourceKeyOf('HTTPS://EXAMPLE.ORG:443/paper.pdf')).toBe(
      sourceKeyOf('https://example.org/paper.pdf'),
    )
  })

  it('ignores URL fragments that do not select different source bytes', () => {
    const url = 'https://example.org/paper.pdf?download=1'
    expect(sourceKeyOf(`${url}#page=1`)).toBe(sourceKeyOf(url))
    expect(sourceKeyOf(`${url}#page=2`)).toBe(sourceKeyOf(url))
  })

  it('retains URL queries that may select different source bytes', () => {
    const url = 'https://example.org/paper.pdf'
    expect(sourceKeyOf(`${url}?version=1`)).not.toBe(sourceKeyOf(`${url}?version=2`))
    expect(sourceKeyOf(`${url}?version=1`)).not.toBe(sourceKeyOf(url))
  })

  it.each([itemRef(), `${attachmentRef()}#page=1`])(
    'rejects an identity that is not an exact attachment ref: %s',
    (identity) => {
      expect(() => sourceKeyOf(identity)).toThrow()
    },
  )
})

describe('stampMatches', () => {
  it('compares local file size and modification time', () => {
    expect(
      stampMatches({ kind: 'file', size: 1, mtimeMs: 2 }, { kind: 'file', size: 1, mtimeMs: 2 }),
    ).toBe(true)
    expect(
      stampMatches({ kind: 'file', size: 1, mtimeMs: 2 }, { kind: 'file', size: 1, mtimeMs: 3 }),
    ).toBe(false)
    expect(
      stampMatches({ kind: 'file', size: 1, mtimeMs: 2 }, { kind: 'file', size: 9, mtimeMs: 2 }),
    ).toBe(false)
  })

  it('compares byte fingerprints', () => {
    expect(
      stampMatches({ kind: 'bytes', fingerprint: 'a' }, { kind: 'bytes', fingerprint: 'a' }),
    ).toBe(true)
    expect(
      stampMatches({ kind: 'bytes', fingerprint: 'a' }, { kind: 'bytes', fingerprint: 'b' }),
    ).toBe(false)
  })

  it('refuses a changed URL or a changed shared validator', () => {
    const url = 'https://example.org/a.pdf'
    expect(
      stampMatches({ kind: 'url', url, etag: '"v1"' }, { kind: 'url', url, etag: '"v2"' }),
    ).toBe(false)
    expect(
      stampMatches(
        { kind: 'url', url, lastModified: 'Mon' },
        { kind: 'url', url, lastModified: 'Tue' },
      ),
    ).toBe(false)
    expect(
      stampMatches({ kind: 'url', url }, { kind: 'url', url: 'https://example.org/b.pdf' }),
    ).toBe(false)
  })

  it('refuses a URL without a common freshness validator', () => {
    const url = 'https://example.org/a.pdf'
    expect(stampMatches({ kind: 'url', url }, { kind: 'url', url })).toBe(false)
    // A HEAD that failed has no validators; the stored URL still identifies it.
    expect(stampMatches({ kind: 'url', url, etag: '"v1"' }, { kind: 'url', url })).toBe(false)
  })

  it('does not treat a matching Content-Length as a freshness validator', () => {
    const url = 'https://example.org/a.pdf'
    expect(
      stampMatches(
        { kind: 'url', url, contentLength: 10 },
        { kind: 'url', url, contentLength: 10 },
      ),
    ).toBe(false)
    expect(
      stampMatches(
        { kind: 'url', url, contentLength: 10 },
        { kind: 'url', url, contentLength: 11 },
      ),
    ).toBe(false)
  })

  it('refuses different stamp kinds', () => {
    expect(
      stampMatches(
        { kind: 'file', size: 1, mtimeMs: 1 },
        { kind: 'url', url: 'https://example.org/a.pdf' },
      ),
    ).toBe(false)
  })
})
