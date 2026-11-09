/**
 * The MinerU token resolver: fail-closed. A configured reference that does not
 * resolve is a configuration failure, never a silent anonymous request.
 * @module tests/scholarly/parsing-credentials
 */

import { Context } from '@deepseek-ai/cordis'
import type {
  CredentialInfo,
  CredentialProvider,
  CredentialRef,
  ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import { describe, expect, it, vi } from 'vitest'
import { resolveMineruToken } from '../../src/parsing/credentials.ts'
import { ZOTERO_PARSING_CREDENTIAL_UNRESOLVED } from '../../src/errors.ts'

function withCredentials(
  resolve: (ref: CredentialRef) => Promise<ResolvedCredential | undefined>,
): Context {
  const ctx = new Context()
  const provider = {
    resolve,
    describe: async (_ref: CredentialRef): Promise<CredentialInfo> => ({
      configured: true,
      writable: true,
    }),
  } as unknown as CredentialProvider
  ctx.provide('credentials', provider)
  return ctx
}

describe('resolveMineruToken', () => {
  it('returns the trimmed token for a resolvable reference', async () => {
    const ctx = withCredentials(async (ref) => ({ value: ` ${ref}-value `, source: 'test' }))
    await expect(resolveMineruToken(ctx, 'MINERU_API_TOKEN')).resolves.toBe(
      'MINERU_API_TOKEN-value',
    )
  })

  it('fails closed when the reference names no value', async () => {
    const ctx = withCredentials(async () => undefined)
    await expect(resolveMineruToken(ctx, 'MINERU_API_TOKEN')).rejects.toMatchObject({
      code: ZOTERO_PARSING_CREDENTIAL_UNRESOLVED,
      message: expect.stringContaining('has no value'),
    })
  })

  it('fails closed on an empty value', async () => {
    const ctx = withCredentials(async () => ({ value: '   ', source: 'test' }))
    await expect(resolveMineruToken(ctx, 'MINERU_API_TOKEN')).rejects.toMatchObject({
      code: ZOTERO_PARSING_CREDENTIAL_UNRESOLVED,
    })
  })

  it('fails closed when the credentials seam is absent', async () => {
    const ctx = new Context()
    await expect(resolveMineruToken(ctx, 'MINERU_API_TOKEN')).rejects.toMatchObject({
      code: ZOTERO_PARSING_CREDENTIAL_UNRESOLVED,
      message: expect.stringContaining('not composed'),
    })
  })

  it('fails closed for an invalid reference spelling, without resolving', async () => {
    const resolve = vi.fn(async () => ({ value: 'x', source: 'test' }))
    const ctx = withCredentials(resolve)
    await expect(resolveMineruToken(ctx, 'not a ref')).rejects.toMatchObject({
      code: ZOTERO_PARSING_CREDENTIAL_UNRESOLVED,
      message: expect.stringContaining('not a valid environment-variable name'),
    })
    expect(resolve).not.toHaveBeenCalled()
  })
})
