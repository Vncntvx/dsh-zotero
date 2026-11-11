/**
 * Runtime contracts for the MinerU API envelopes and errors.
 * @module tests/unit/enrichment-api
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  freeStatus,
  freeSubmit,
  MineruApiError,
  proStatus,
  proSubmit,
  responseData,
} from '../../src/enrichment/api.ts'

describe('MineruApiError', () => {
  it('identifies retryable error codes', () => {
    const retryable = new MineruApiError('transient failure', -10001)
    expect(retryable.retryable).toBe(true)
    const nonRetryable = new MineruApiError('permanent rejection', 400)
    expect(nonRetryable.retryable).toBe(false)
  })

  it('formats detail with apiCode, traceId, and taskId', () => {
    const error = new MineruApiError('quota exceeded', 403, 'trace-1', 'task-2')
    expect(error.message).toContain('quota exceeded')
    expect(error.message).toContain('(MinerU 403)')
    expect(error.message).toContain('[trace trace-1]')
    expect(error.message).toContain('[task task-2]')
    expect(error.traceId).toBe('trace-1')
    expect(error.taskId).toBe('task-2')
  })
})

describe('responseData', () => {
  const schema = z.object({ ok: z.boolean() })

  it('parses valid envelopes and returns inner data', () => {
    const data = responseData({ code: 0, data: { ok: true } }, schema, 'test-phase')
    expect(data).toEqual({ ok: true })
  })

  it('rejects invalid envelopes', () => {
    expect(() => responseData('not-an-object', schema, 'test-phase')).toThrow(
      /invalid response envelope/,
    )
  })

  it('rejects rejected response codes', () => {
    expect(() => responseData({ code: 500, msg: 'server error' }, schema, 'test-phase')).toThrow(
      /server error/,
    )
  })

  it('rejects payload that violates schema', () => {
    expect(() => responseData({ code: 0, data: { ok: 'not-bool' } }, schema, 'test-phase')).toThrow(
      /invalid response fields/,
    )
  })
})

describe('schemas', () => {
  it('validates freeSubmit and proSubmit', () => {
    expect(
      freeSubmit.safeParse({
        task_id: 'task-1',
        file_url: 'https://example.com/file.pdf',
      }).success,
    ).toBe(true)

    expect(
      proSubmit.safeParse({
        batch_id: 'batch-1',
        file_urls: ['https://example.com/file.pdf'],
      }).success,
    ).toBe(true)

    expect(
      freeSubmit.safeParse({
        task_id: 'task-1',
        file_url: 'http://insecure.com/file.pdf',
      }).success,
    ).toBe(false)
  })

  it('validates freeStatus and proStatus', () => {
    expect(
      freeStatus.safeParse({
        task_id: 'task-1',
        state: 'running',
      }).success,
    ).toBe(true)

    expect(
      proStatus.safeParse({
        batch_id: 'batch-1',
        extract_result: [
          {
            file_name: 'doc.pdf',
            state: 'done',
            full_zip_url: 'https://example.com/full.zip',
          },
        ],
      }).success,
    ).toBe(true)
  })
})
