/**
 * The MinerU host table: only the fixed API host is statically allowed, and
 * the endpoint builders address it.
 * @module tests/unit/enrichment-hosts
 */

import { describe, expect, it } from 'vitest'
import {
  MINERU_API_ORIGIN,
  MINERU_ENDPOINTS,
  PRO_MODEL_VERSION,
  isMineruApiHost,
} from '../../src/enrichment/hosts.ts'

describe('MinerU hosts', () => {
  it('accepts only the exact API host, not a lookalike or a subdomain', () => {
    expect(isMineruApiHost('mineru.net')).toBe(true)
    expect(isMineruApiHost('MINERU.NET')).toBe(true)
    expect(isMineruApiHost('api.mineru.net')).toBe(false)
    expect(isMineruApiHost('mineru.net.evil.example')).toBe(false)
  })

  it('builds submit and poll endpoints on the API origin', () => {
    expect(MINERU_API_ORIGIN).toBe('https://mineru.net')
    expect(MINERU_ENDPOINTS.free.submit).toBe('https://mineru.net/api/v1/agent/parse/file')
    expect(MINERU_ENDPOINTS.free.poll('t 1')).toBe('https://mineru.net/api/v1/agent/parse/t%201')
    expect(MINERU_ENDPOINTS.pro.submit).toBe('https://mineru.net/api/v4/file-urls/batch')
    expect(MINERU_ENDPOINTS.pro.poll('b/1')).toBe(
      'https://mineru.net/api/v4/extract-results/batch/b%2F1',
    )
    expect(PRO_MODEL_VERSION).toBe('vlm')
  })
})
