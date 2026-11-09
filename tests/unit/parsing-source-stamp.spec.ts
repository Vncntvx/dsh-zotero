/**
 * The source-index stamp comparison: local file stamps compare size and mtime,
 * URL stamps compare a shared validator and fall back to URL identity when
 * neither side has one, and byte stamps compare fingerprints.
 * @module tests/unit/parsing-source-stamp
 */

import { describe, expect, it } from 'vitest'
import { sourceKeyOf, stampMatches } from '../../src/parsing/source-stamp.ts'

describe('sourceKeyOf', () => {
  it('changes with identity or mode and is a stable digest', () => {
    const a = sourceKeyOf('zotero://user/0/attachment/ABCD', 'free')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(sourceKeyOf('zotero://user/0/attachment/ABCD', 'free')).toBe(a)
    expect(sourceKeyOf('zotero://user/0/attachment/ABCD', 'pro')).not.toBe(a)
    expect(sourceKeyOf('zotero://user/0/attachment/OTHER', 'free')).not.toBe(a)
  })
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

  it('falls back to URL identity when neither side has a validator', () => {
    const url = 'https://example.org/a.pdf'
    expect(stampMatches({ kind: 'url', url }, { kind: 'url', url })).toBe(true)
    // A HEAD that failed has no validators; the stored URL still identifies it.
    expect(stampMatches({ kind: 'url', url, etag: '"v1"' }, { kind: 'url', url })).toBe(true)
  })

  it('compares Content-Length when no stronger validator is shared', () => {
    const url = 'https://example.org/a.pdf'
    expect(
      stampMatches(
        { kind: 'url', url, contentLength: 10 },
        { kind: 'url', url, contentLength: 10 },
      ),
    ).toBe(true)
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
