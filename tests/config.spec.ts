import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.js'

describe('resolveConfig', () => {
  it('applies schema defaults for an empty config', () => {
    expect(resolveConfig({})).toEqual({
      baseUrl: 'http://127.0.0.1:23119/api',
      provider: 'local',
      timeoutMs: 5000,
      maxSearchResults: 20,
      maxEvidenceChars: 6000,
      maxEvidencePassages: 4,
      maxDetailChars: 3000,
      maxResponseBytes: 16 * 1024 * 1024,
      maxExportChars: 1_000_000,
      defaultStyle: 'apa',
      defaultLocale: 'en-US',
    })
  })

  it('honors explicit values', () => {
    expect(resolveConfig({ timeoutMs: 900, maxExportChars: 42, defaultStyle: 'chicago-note-bibliography' }))
      .toMatchObject({ timeoutMs: 900, maxExportChars: 42, defaultStyle: 'chicago-note-bibliography' })
  })

  it('accepts loopback base URLs over http', () => {
    expect(resolveConfig({ baseUrl: 'http://127.0.0.1:23119/api' }).baseUrl).toBe('http://127.0.0.1:23119/api')
    expect(resolveConfig({ baseUrl: 'http://localhost:1234/api' }).baseUrl).toBe('http://localhost:1234/api')
    expect(resolveConfig({ baseUrl: 'http://[::1]:23119/api' }).baseUrl).toBe('http://[::1]:23119/api')
  })

  it('rejects base URLs that cannot parse', () => {
    expect(() => resolveConfig({ baseUrl: 'not a url' })).toThrowError(/baseUrl/)
  })

  it('rejects https base URLs (the Local API is plain loopback HTTP)', () => {
    expect(() => resolveConfig({ baseUrl: 'https://127.0.0.1:23119/api' })).toThrowError(/http:/)
  })

  it('rejects non-loopback hosts so the plugin cannot SSRF internal hosts', () => {
    expect(() => resolveConfig({ baseUrl: 'http://evil.example.com/api' })).toThrowError(/loopback/)
    expect(() => resolveConfig({ baseUrl: 'http://10.0.0.7:23119/api' })).toThrowError(/loopback/)
    expect(() => resolveConfig({ baseUrl: 'http://169.254.169.254/latest' })).toThrowError(/loopback/)
  })

  it('rejects non-positive timeouts', () => {
    expect(() => resolveConfig({ timeoutMs: 0 })).toThrowError(/timeoutMs/)
    expect(() => resolveConfig({ timeoutMs: -1 })).toThrowError(/timeoutMs/)
    expect(() => resolveConfig({ timeoutMs: Number.NaN })).toThrowError(/timeoutMs/)
  })

  it('rejects non-finite or non-integer limits', () => {
    expect(() => resolveConfig({ maxSearchResults: 0 })).toThrowError(/maxSearchResults/)
    expect(() => resolveConfig({ maxEvidenceChars: 1.5 })).toThrowError(/maxEvidenceChars/)
    expect(() => resolveConfig({ maxResponseBytes: -3 })).toThrowError(/maxResponseBytes/)
    expect(() => resolveConfig({ maxExportChars: Number.NaN })).toThrowError(/maxExportChars/)
  })

  it('rejects empty provider and style strings', () => {
    expect(() => resolveConfig({ provider: '' })).toThrowError(/provider/)
    expect(() => resolveConfig({ defaultStyle: '  ' })).toThrowError(/defaultStyle/)
  })
})
