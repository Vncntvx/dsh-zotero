/**
 * A failed parse receipt carries the reason, not only the code.
 *
 * The dialog and the durable record both render `code` + `message`, so a fixed
 * "parsing failed" line leaves a security rejection, a MinerU task error, and
 * a filesystem failure indistinguishable. The reason must survive that
 * boundary bounded and free of addresses and credentials.
 * @module tests/host/enrichment-parse-failure-receipt
 */

import { JobId } from '@deepseek-ai/dsh-jobs'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZoteroError, ZOTERO_ENRICHMENT_TASK_FAILED } from '../../src/errors.ts'
import { PARSE_FAILED_MESSAGE } from '../../src/enrichment/parse-jobs.ts'
import {
  parseJobsFixture,
  parseRequest,
  parseSignal,
  type ParseJobsFixture,
} from './support/enrichment-parse-jobs.ts'

let fixture: ParseJobsFixture | undefined
afterEach(async () => {
  await fixture?.dispose()
  fixture = undefined
  vi.restoreAllMocks()
})
const owner = SessionId('parse-owner')

async function failedReceiptOf(execute: () => Promise<never>) {
  fixture = await parseJobsFixture({ execute })
  const request = parseRequest()
  const started = await fixture.helper.startDocumentParse(request, parseSignal())
  expect((await fixture.ctx.jobs.wait(JobId(started.jobId), 5000, owner)).status).toBe('failed')
  const receipt = await fixture.helper.documentParseReceipt(
    { sessionId: request.sessionId, operationId: request.operationId },
    parseSignal(),
  )
  expect(receipt.kind).toBe('failed')
  if (receipt.kind !== 'failed') throw new Error('a failed job must answer a failed receipt')
  return receipt
}

describe('a failed parse receipt', () => {
  it('keeps the reason the request failed', async () => {
    const reason =
      'Security rejection: "mineru.net" resolves to a non-public address (198.18.2.147). A local DNS proxy (Clash/mihomo TUN) answers with this fake-IP placeholder.'
    await expect(
      failedReceiptOf(async () => {
        throw new ZoteroError(reason, ZOTERO_ENRICHMENT_TASK_FAILED)
      }),
    ).resolves.toEqual({
      kind: 'failed',
      code: ZOTERO_ENRICHMENT_TASK_FAILED,
      message: reason,
    })
  })

  it('reduces addresses and bounds an unowned reason before persisting it', async () => {
    const receipt = await failedReceiptOf(async () => {
      throw new Error(
        `Upload refused by https://oss-mineru.example/x.pdf?sig=private ${'x'.repeat(400)}`,
      )
    })
    expect(receipt).toMatchObject({ kind: 'failed', code: ZOTERO_ENRICHMENT_TASK_FAILED })
    expect(receipt.message).toContain('[url]')
    expect(receipt.message).not.toContain('sig=private')
    expect(receipt.message).toHaveLength(256)
  })

  it('falls back to the fixed line when the failure carries no message', async () => {
    const receipt = await failedReceiptOf(async () => {
      throw new Error('')
    })
    expect(receipt).toMatchObject({
      kind: 'failed',
      code: ZOTERO_ENRICHMENT_TASK_FAILED,
      message: PARSE_FAILED_MESSAGE,
    })
  })
})
