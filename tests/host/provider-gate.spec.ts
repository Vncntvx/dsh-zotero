import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import ZoteroService, { type ZoteroService as ZoteroServiceType } from '../../src/index.js'
import { ZOTERO_CAPABILITY_UNAVAILABLE, ZOTERO_PROVIDER_UNAVAILABLE } from '../../src/errors.js'
import type { ZoteroProvider, ZoteroSearchResult } from '../../src/types.js'
import { MockZotero } from '../helpers/mock-zotero.js'
import { zoteroError } from '../helpers/provider-harness.js'
import { parseRef } from '../../src/refs.js'

let mock: MockZotero | undefined
let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  await mock?.close()
  mock = undefined
})

function searchResult(): ZoteroSearchResult {
  return {
    scope: { kind: 'library', library: { type: 'user', id: 0 } },
    items: [],
    total: 0,
    offset: 0,
    returned: 0,
  }
}

async function boot(providerId: string): Promise<ZoteroServiceType> {
  mock = await MockZotero.start()
  ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, {})
  await ctx.plugin(ZoteroService, { baseUrl: mock.baseUrl, provider: providerId })
  return ctx.zotero
}

describe('provider seam double gate', () => {
  it('serves a partial provider without stubs', async () => {
    const service = await boot('stub')
    const stub: ZoteroProvider = {
      id: 'stub',
      capabilities: new Set(['search']),
      status: async () => ({
        providerId: 'stub',
        endpoint: '127.0.0.1:23119',
        connected: true,
        diagnosis: 'ok',
      }),
      search: async () => searchResult(),
    }
    service.registerProvider(stub)
    const result = await service.search({
      scope: { kind: 'library' },
      mode: 'metadata',
      sort: 'dateModified',
      direction: 'desc',
      offset: 0,
      limit: 10,
    })
    expect(result.total).toBe(0)
  })

  it('fails with CAPABILITY_UNAVAILABLE when the capability is not declared', async () => {
    const service = await boot('stub')
    service.registerProvider({
      id: 'stub',
      capabilities: new Set(['search']),
      status: async () => ({
        providerId: 'stub',
        endpoint: '127.0.0.1:23119',
        connected: true,
        diagnosis: 'ok',
      }),
      search: async () => searchResult(),
    })
    await zoteroError(
      service.get({ ref: parseRef('zotero://user/0/item/ABCD1234'), include: new Set() }),
      ZOTERO_CAPABILITY_UNAVAILABLE,
    )
  })

  it('fails with PROVIDER_UNAVAILABLE when the capability is declared but the method is missing', async () => {
    const service = await boot('stub')
    service.registerProvider({
      id: 'stub',
      capabilities: new Set(['metadata']),
      status: async () => ({
        providerId: 'stub',
        endpoint: '127.0.0.1:23119',
        connected: true,
        diagnosis: 'ok',
      }),
    })
    await zoteroError(
      service.get({ ref: parseRef('zotero://user/0/item/ABCD1234'), include: new Set() }),
      ZOTERO_PROVIDER_UNAVAILABLE,
      'getItem',
    )
  })

  it('preserves class-method this across the gate', async () => {
    const service = await boot('stub')
    class CountingProvider implements ZoteroProvider {
      readonly id = 'stub'
      readonly capabilities = new Set(['search'] as const) as ReadonlySet<'search'>
      calls = 0
      async status() {
        return {
          providerId: 'stub',
          endpoint: '127.0.0.1:23119',
          connected: true as const,
          diagnosis: 'ok',
        }
      }
      async search() {
        this.calls += 1
        return searchResult()
      }
    }
    const counting = new CountingProvider()
    service.registerProvider(counting)
    await service.search({
      scope: { kind: 'library' },
      mode: 'metadata',
      sort: 'dateModified',
      direction: 'desc',
      offset: 0,
      limit: 10,
    })
    expect(counting.calls).toBe(1)
  })
})
