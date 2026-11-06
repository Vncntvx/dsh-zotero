/**
 * The scholarly credential resolver: references are configuration, values are
 * resolved through the host credentials seam before every external call.
 * @module tests/scholarly/credentials
 */

import { Context } from '@deepseek-ai/cordis'
import type {
  CredentialInfo,
  CredentialProvider,
  CredentialRef,
  ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import { describe, expect, it, vi } from 'vitest'
import { resolveScholarlyKeys } from '../../src/scholarly/credentials.ts'
import type { ResolvedScholarlyConfig } from '../../src/scholarly/config.ts'
import {
  ZOTERO_SCHOLARLY_CREDENTIALS_UNAVAILABLE,
  ZOTERO_SCHOLARLY_CREDENTIAL_UNRESOLVED,
} from '../../src/errors.ts'

function config(overrides: Partial<ResolvedScholarlyConfig> = {}): ResolvedScholarlyConfig {
  return {
    email: 'researcher@example.edu',
    maxResults: 20,
    maxContentChars: 12_000,
    enableRunInBackground: false,
    promoteOnTimeout: false,
    foregroundWaitMs: 1_000,
    ...overrides,
  }
}

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

describe('resolveScholarlyKeys', () => {
  it('resolves every configured reference on each call', async () => {
    let generation = 0
    const resolve = vi.fn(async (ref: CredentialRef) => ({
      value: `${ref}-${++generation}`,
      source: 'test',
    }))
    const ctx = withCredentials(resolve)
    const section = config({
      s2ApiKeyEnv: 'S2_API_KEY',
      ncbiApiKeyEnv: 'NCBI_API_KEY',
      openalexApiKeyEnv: 'OPENALEX_API_KEY',
    })

    await expect(resolveScholarlyKeys(ctx, section)).resolves.toEqual({
      email: 'researcher@example.edu',
      s2Key: 'S2_API_KEY-1',
      ncbiKey: 'NCBI_API_KEY-2',
      openalexKey: 'OPENALEX_API_KEY-3',
    })
    await expect(resolveScholarlyKeys(ctx, section)).resolves.toEqual({
      email: 'researcher@example.edu',
      s2Key: 'S2_API_KEY-4',
      ncbiKey: 'NCBI_API_KEY-5',
      openalexKey: 'OPENALEX_API_KEY-6',
    })
    expect(resolve).toHaveBeenCalledTimes(6)
  })

  it('treats an empty reference as no key and does not read the seam', async () => {
    const resolve = vi.fn(async () => undefined)
    const ctx = withCredentials(resolve)
    await expect(resolveScholarlyKeys(ctx, config())).resolves.toEqual({
      email: 'researcher@example.edu',
    })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('trims the resolved value and rejects an empty stored value', async () => {
    const ctx = withCredentials(async () => ({ value: '  key-value  ', source: 'test' }))
    await expect(resolveScholarlyKeys(ctx, config({ s2ApiKeyEnv: 'S2_API_KEY' }))).resolves.toEqual(
      {
        email: 'researcher@example.edu',
        s2Key: 'key-value',
      },
    )

    const empty = withCredentials(async () => ({ value: '   ', source: 'test' }))
    await expect(
      resolveScholarlyKeys(empty, config({ s2ApiKeyEnv: 'S2_API_KEY' })),
    ).rejects.toMatchObject({ code: ZOTERO_SCHOLARLY_CREDENTIAL_UNRESOLVED })
  })

  it('fails closed when a reference is configured but the credentials seam is absent', async () => {
    await expect(
      resolveScholarlyKeys(new Context(), config({ s2ApiKeyEnv: 'S2_API_KEY' })),
    ).rejects.toMatchObject({ code: ZOTERO_SCHOLARLY_CREDENTIALS_UNAVAILABLE })
  })

  it('fails closed when a reference does not resolve', async () => {
    const ctx = withCredentials(async () => undefined)
    await expect(
      resolveScholarlyKeys(ctx, config({ ncbiApiKeyEnv: 'NCBI_API_KEY' })),
    ).rejects.toMatchObject({ code: ZOTERO_SCHOLARLY_CREDENTIAL_UNRESOLVED })
  })

  it('rejects a reference outside the environment-variable grammar', async () => {
    const ctx = withCredentials(async () => ({ value: 'key', source: 'test' }))
    await expect(
      resolveScholarlyKeys(ctx, config({ openalexApiKeyEnv: 'not a reference' })),
    ).rejects.toMatchObject({ code: ZOTERO_SCHOLARLY_CREDENTIAL_UNRESOLVED })
  })
})
