/**
 * `detachUtf16` string semantics plus the persistence-entry sites that must
 * detach: an excerpt kept in durable state (tool/result meta, ledger,
 * checkpoint) has to stop sharing storage with its parent string, or the
 * parent's whole text stays reachable for the session's lifetime.
 * @module tests/unit/json-detach-utf16
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { detachUtf16 } from '../../src/json.js'

describe('detachUtf16 string semantics', () => {
  it('returns equal content for plain ASCII, CJK, and paired text', () => {
    for (const text of ['', 'plain ascii', '标题与摘要', '𝟘𝟙 mixed 𝔸 pairs 👍🏼']) {
      expect(detachUtf16(text)).toBe(text)
    }
  })

  it('keeps paired surrogates byte-identical across the round trip', () => {
    // U+1D7D8 MATHEMATICAL BOLD DIGIT ZERO is one surrogate pair: the decode
    // must not split or replace it, and the window spec's pair-preservation
    // guarantee stays intact for detached windows.
    const paired = 'a𝟘b'
    const detached = detachUtf16(paired)
    expect(detached).toBe(paired)
    expect([...detached]).toHaveLength(3)
    expect(detached.codePointAt(1)).toBe(0x1d7d8)
  })

  it('decodes a lone surrogate to U+FFFD instead of preserving it', () => {
    // A lone surrogate cannot survive the UTF-16 round trip; the replacement
    // character is the honest spelling of "this text was not valid UTF-16".
    const text = 'before\uD800after'
    const detached = detachUtf16(text)
    expect(detached).toBe('before\uFFFDafter')
  })

  it('returns a new empty string for empty input', () => {
    expect(detachUtf16('')).toBe('')
  })
})

describe('durable-state excerpt sites detach', () => {
  const sites = [
    'src/local/retrieve-fulltext.ts',
    'src/evidence.ts',
    'src/presentation-meta.ts',
    'src/normalize-context.ts',
  ]
  it.each(sites)('detaches excerpts in %s', (file) => {
    expect(readFileSync(file, 'utf8')).toContain('detachUtf16(')
  })
})
