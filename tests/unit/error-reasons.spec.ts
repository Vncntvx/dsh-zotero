/**
 * Every stable domain code crosses the gateway as its own declared wire
 * reason, with the exact code carried in typed details. The collapsed
 * `zotero/domain` carrier is gone, so this table is the contract a client
 * branches on.
 */
import { describe, expect, it } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import {
  ZOTERO_ERROR_CODES,
  ZOTERO_REMOTE_REASON,
  ZOTERO_UNEXPECTED,
  ZoteroError,
  ZoteroWriteCommitUnknownError,
  domainCall,
} from '../../src/errors.js'

async function remoteFailureOf(call: () => Promise<unknown>): Promise<RemoteError> {
  const failure = await domainCall(call).catch((error: unknown) => error)
  expect(failure).toBeInstanceOf(RemoteError)
  return failure as RemoteError
}

describe('domainCall wire reasons', () => {
  it('declares a reason for every stable code', () => {
    for (const code of ZOTERO_ERROR_CODES) {
      expect(ZOTERO_REMOTE_REASON[code], code).toBeTypeOf('string')
    }
  })

  it.each(ZOTERO_ERROR_CODES)('maps %s to its declared reason', async (code) => {
    const failure = await remoteFailureOf(async () => {
      throw new ZoteroError('domain failure', code)
    })
    expect(failure.code).toBe(ZOTERO_REMOTE_REASON[code])
    expect(failure.code).not.toBe('zotero/domain')
    expect(failure.details).toEqual({ code })
    expect(failure.cause).toBeInstanceOf(ZoteroError)
    expect(failure.message).toBe('domain failure')
  })

  it('keeps a commit-unknown failure addressable by its stable code', async () => {
    const failure = await remoteFailureOf(async () => {
      throw new ZoteroWriteCommitUnknownError('commit state unknown', 'ZOTERO_WRITE_CONFLICT')
    })
    expect(failure.code).toBe('zotero/write')
    expect(failure.details).toEqual({ code: 'ZOTERO_WRITE_CONFLICT' })
  })

  it('classifies an unknown commit code as unexpected instead of inventing a reason', async () => {
    const failure = await remoteFailureOf(async () => {
      throw new ZoteroWriteCommitUnknownError('commit state unknown', 'TOOL_ABORTED')
    })
    expect(failure.code).toBe(ZOTERO_REMOTE_REASON[ZOTERO_UNEXPECTED])
    expect(failure.details).toEqual({ code: ZOTERO_UNEXPECTED })
  })

  it('lets a non-domain failure through unchanged', async () => {
    const original = new Error('not a domain failure')
    const failure = await domainCall(async () => {
      throw original
    }).catch((error: unknown) => error)
    expect(failure).toBe(original)
  })
})
