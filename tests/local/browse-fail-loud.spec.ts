/**
 * Non-array listing bodies under `zotero_browse` fail loud. A non-array body
 * is a contract breach, not an empty page: folding it to `[]` would tell the
 * model "this library has no item types" and hide the broken response. The
 * `libraries` case also pins that the breach travels through the 404-degrade
 * catch untouched — only a real 404 falls back to personal.
 * @module tests/local/browse-fail-loud
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZOTERO_UNEXPECTED } from '../../src/errors.js'
import { type LocalApiProvider } from '../../src/local/provider.js'
import {
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../helpers/provider-harness.js'
import { zoteroError } from '../helpers/server/assert.js'
import { serveJson } from '../helpers/server/serve.js'

let mock: ProviderHarness['mock']
let provider: LocalApiProvider
let harness: ProviderHarness

beforeEach(async () => {
  harness = await setupProvider()
  mock = harness.mock
  provider = harness.provider
})
afterEach(async () => {
  await teardownProvider(harness)
})

describe('browse: non-array bodies fail loud', () => {
  it('refuses a non-array groups body instead of degrading to personal only', async () => {
    serveJson(mock, '/api/users/0/groups', { unexpected: true })
    await zoteroError(
      provider.browse({ kind: 'libraries', offset: 0, limit: 10 }),
      ZOTERO_UNEXPECTED,
      'non-array body for groups',
    )
  })

  it('refuses a non-array itemTypes body', async () => {
    serveJson(mock, '/api/itemTypes', { unexpected: true })
    await zoteroError(
      provider.browse({ kind: 'itemTypes', offset: 0, limit: 10 }),
      ZOTERO_UNEXPECTED,
      'non-array body for item types',
    )
  })

  it('refuses a non-array fields body while creator types stay valid', async () => {
    serveJson(mock, '/api/itemTypeFields', { unexpected: true })
    serveJson(mock, '/api/itemTypeCreatorTypes', [{ creatorType: 'author' }])
    await zoteroError(
      provider.browse({ kind: 'itemFields', itemType: 'dataset', offset: 0, limit: 10 }),
      ZOTERO_UNEXPECTED,
      'non-array body for item type fields',
    )
  })

  it('refuses a non-array creator-types body while fields stay valid', async () => {
    serveJson(mock, '/api/itemTypeFields', [{ field: 'repository' }])
    serveJson(mock, '/api/itemTypeCreatorTypes', { unexpected: true })
    await zoteroError(
      provider.browse({ kind: 'itemFields', itemType: 'dataset', offset: 0, limit: 10 }),
      ZOTERO_UNEXPECTED,
      'non-array body for creator types',
    )
  })

  it('refuses a tag listing containing a malformed tag row without a tag name', async () => {
    mock.route('GET', '/api/users/0/tags', (_req, res, helpers) => {
      helpers.json([{ data: {} }], {
        'Total-Results': '1',
        'Zotero-Server-ID': 'srv-1',
      })
    })
    await zoteroError(
      provider.browse({ kind: 'tags', offset: 0, limit: 10 }),
      ZOTERO_UNEXPECTED,
      'Zotero returned a malformed tag row without a tag name',
    )
  })
})
