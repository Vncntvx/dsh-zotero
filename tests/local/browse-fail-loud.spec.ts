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

/**
 * A server-paged listing that answers an in-range page with zero rows has
 * contradicted the `Total-Results` it just sent. Terminating silently there
 * would report a truncated listing as a complete one, which the caller cannot
 * detect; the three server-paged kinds must fail loud instead. `libraries`,
 * `itemTypes`, and `itemFields` are sliced client-side and are unaffected —
 * a request past the end of a list already in hand is a legitimate empty page.
 */
describe('browse: empty pages with range left fail loud', () => {
  it('refuses an empty collections page that still has range left', async () => {
    mock.route('GET', '/api/users/0/collections/top', (_req, res, helpers) => {
      helpers.json([], { 'Total-Results': '5', 'Zotero-Server-ID': 'srv-1' })
    })
    await zoteroError(
      provider.browse({ kind: 'collections', offset: 2, limit: 10 }),
      ZOTERO_UNEXPECTED,
      'empty page for collections',
    )
  })

  it('refuses an empty savedSearches page that still has range left', async () => {
    mock.route('GET', '/api/users/0/searches', (_req, res, helpers) => {
      helpers.json([], { 'Total-Results': '5', 'Zotero-Server-ID': 'srv-1' })
    })
    await zoteroError(
      provider.browse({ kind: 'savedSearches', offset: 2, limit: 10 }),
      ZOTERO_UNEXPECTED,
      'empty page for saved searches',
    )
  })

  it('refuses an empty tags page that still has range left', async () => {
    mock.route('GET', '/api/users/0/tags', (_req, res, helpers) => {
      helpers.json([], { 'Total-Results': '5', 'Zotero-Server-ID': 'srv-1' })
    })
    await zoteroError(
      provider.browse({ kind: 'tags', offset: 2, limit: 10 }),
      ZOTERO_UNEXPECTED,
      'empty page for tags',
    )
  })

  it('still ends a server-paged listing whose page is past the reported total', async () => {
    // The offset is beyond the total, so the empty body agrees with the
    // header: this is the end of the listing, not a breach.
    mock.route('GET', '/api/users/0/tags', (_req, res, helpers) => {
      helpers.json([], { 'Total-Results': '2', 'Zotero-Server-ID': 'srv-1' })
    })
    const page = await provider.browse({ kind: 'tags', offset: 2, limit: 10 })
    expect(page.returned).toBe(0)
    expect(page.nextOffset).toBeUndefined()
  })

  it('still serves an empty client-sliced page past the end of the list', async () => {
    // itemTypes is sliced from a list already in hand; asking past its end is
    // an ordinary empty page and must not be reported as a breach.
    serveJson(mock, '/api/itemTypes', [{ itemType: 'journalArticle' }])
    const page = await provider.browse({ kind: 'itemTypes', offset: 9, limit: 10 })
    expect(page.returned).toBe(0)
    expect(page.nextOffset).toBeUndefined()
  })
})
