/** Duplicate reference inputs share candidate I/O while preserving independent reconciliation. */
import { expect, it, vi } from 'vitest'
import { matchReferences } from '../../src/local/match-references-domain.js'
import type { ZoteroHttpClient } from '../../src/http-client.js'
import { PROVIDER_LIMITS } from '../helpers/provider-harness.js'

it('shares one query across all inputs and honors a smaller configured search limit', async () => {
  const search = vi.fn(async () => ({
    items: [],
    scope: { kind: 'library' as const, library: { type: 'user' as const, id: 0 as const } },
    total: 0,
    returned: 0,
    offset: 0,
  }))
  const result = await matchReferences(
    { search, client: {} as ZoteroHttpClient, limits: { ...PROVIDER_LIMITS, maxSearchResults: 3 } },
    {
      references: Array.from({ length: 50 }, (_unused, index) => ({
        inputId: `input-${index}`,
        title: 'Same title',
      })),
    },
  )
  expect(search).toHaveBeenCalledTimes(1)
  expect(search).toHaveBeenCalledWith(
    expect.objectContaining({ query: 'Same title', limit: 3 }),
    expect.any(AbortSignal),
  )
  expect(result.items.map((item) => item.inputId)).toEqual(
    Array.from({ length: 50 }, (_unused, index) => `input-${index}`),
  )
  expect(result.items.every((item) => item.status === 'notFound')).toBe(true)
})
