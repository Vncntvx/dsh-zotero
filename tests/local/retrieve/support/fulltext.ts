import { afterEach, vi } from 'vitest'
import { LocalApiProvider } from '../../../../src/local/provider.js'
import type {
  FulltextEnhancer,
  FulltextLookupResult,
} from '../../../../src/local/fulltext-enhancer.js'

import { MockZotero } from '../../../helpers/mock-zotero.js'
import { testHttpClient } from '../../../helpers/test-clients.js'
import { PROVIDER_LIMITS } from '../../../helpers/provider-harness.js'

import { attachmentRef } from '../../../helpers/server/keys.js'

import { serveItemGraph } from '../../../helpers/server/serve.js'

import {
  RETRIEVE_ATTACHMENT,
  RETRIEVE_ATTACHMENT_CHILDREN,
  RETRIEVE_CHILDREN,
  RETRIEVE_PARENT,
  fulltextHit,
} from '../../../helpers/retrieve-fixtures.js'

let mock: MockZotero | undefined

afterEach(async () => {
  await mock?.close()
  mock = undefined
})

export const WINDOW_CHARS = 8

export function providerOf(
  server: MockZotero,
  enhancer?: FulltextEnhancer,
  limits: Partial<typeof PROVIDER_LIMITS> = {},
): LocalApiProvider {
  return new LocalApiProvider({
    client: testHttpClient(server.baseUrl),
    limits: () => ({ ...PROVIDER_LIMITS, ...limits }),
    fulltextEnhancer: () => enhancer,
  })
}

export async function boot(serveDefaults = true): Promise<MockZotero> {
  mock = await MockZotero.start()
  if (serveDefaults)
    serveItemGraph(mock, {
      parent: RETRIEVE_PARENT,
      children: RETRIEVE_CHILDREN,
      annotations: RETRIEVE_ATTACHMENT_CHILDREN,
      attachmentItem: RETRIEVE_ATTACHMENT,
      serverId: null,
    })
  return mock
}

export function hit(text: string): Extract<FulltextLookupResult, { kind: 'hit' }> {
  return fulltextHit(text, attachmentRef(RETRIEVE_ATTACHMENT.key))
}

export function enhancerOf(
  result: FulltextLookupResult | (() => FulltextLookupResult),
): FulltextEnhancer {
  const resolve = async () => (typeof result === 'function' ? result() : result)
  return {
    lookup: vi.fn(resolve),
    lookupArtifact: vi.fn(resolve),
  }
}

export const markdown = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
