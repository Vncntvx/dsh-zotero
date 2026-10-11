/**
 * The bounds of the `zotero_search` note-body scan: the configured record cap,
 * the truncation verdict an exact-cap library must not earn, and the batched
 * pagination that walks a library larger than one page. The matching and
 * filtering subjects live in `search-scan.spec.ts`; these tests are only about
 * where the scan stops and what it honestly reports about stopping.
 * @module tests/local/search-scan-bounds
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalApiProvider } from '../../src/local/provider.js'
import { MockZotero } from '../helpers/mock-zotero.js'
import {
  request,
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../helpers/provider-harness.js'
import { expectRequestCount } from '../helpers/server/assert.js'
import { SERVER_ID } from '../helpers/server/keys.js'
import { attachment, noteRow, searchHit } from '../helpers/server/objects.js'
import { makeProvider } from './search-helpers.js'

let mock: MockZotero
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

describe('search scan bounds', () => {
  it('stops the scan at the configured record cap', async () => {
    const capped = makeProvider(mock, { maxNoteScanRecords: 2 })
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note')
        helpers.json([
          noteRow({ data: { note: 'cascade one' } }),
          noteRow({ key: 'NOTE2222', data: { note: 'cascade two' } }),
          noteRow({ key: 'NOTE3333', data: { note: 'cascade three' } }),
        ])
      else helpers.json([], { 'Total-Results': '0' })
    })
    const result = await capped.search(request({ query: 'cascade' }))
    expect(result.items).toEqual([])
    expect(result.supplemental?.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/NOTE1111',
      'zotero://user/0/item/NOTE2222',
    ])
    expect(result.supplemental?.scanned).toBe(2)
    expect(result.supplemental?.truncated).toBe(true)
    expect(mock.requests[1]!.search.get('limit')).toBe('2')
  })

  it('reads an exact-cap library as complete, not truncated', async () => {
    // The bug this pins: a library whose note count divides the cap ends the
    // scan on a full page, so EOF was never observed. The one-row probe must
    // decide, and a scan that consumed the whole library must not read as
    // truncated.
    const capped = makeProvider(mock, { maxNoteScanRecords: 2 })
    const library = [
      noteRow({ data: { note: 'cascade one' } }),
      noteRow({ key: 'NOTE2222', data: { note: 'cascade two' } }),
    ]
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') {
        const start = Number(search.get('start') ?? '0')
        const limit = Number(search.get('limit') ?? '0')
        helpers.json(library.slice(start, start + limit))
      } else helpers.json([], { 'Total-Results': '0' })
    })
    const result = await capped.search(request({ query: 'cascade' }))
    expect(result.items).toEqual([])
    expect(result.supplemental?.scanned).toBe(2)
    expect(result.supplemental?.truncated).toBe(false)
    const scanRequests = mock.requests.filter((entry) => entry.search.get('itemType') === 'note')
    expect(scanRequests).toHaveLength(2)
    expect(scanRequests[1]!.search.get('start')).toBe('2')
    expect(scanRequests[1]!.search.get('limit')).toBe('1')
  })

  it('reports truncated when the probe finds notes beyond the cap', async () => {
    const capped = makeProvider(mock, { maxNoteScanRecords: 2 })
    const library = [
      noteRow({ data: { note: 'cascade one' } }),
      noteRow({ key: 'NOTE2222', data: { note: 'cascade two' } }),
      noteRow({ key: 'NOTE3333', data: { note: 'cascade three' } }),
    ]
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') {
        const start = Number(search.get('start') ?? '0')
        const limit = Number(search.get('limit') ?? '0')
        helpers.json(library.slice(start, start + limit))
      } else helpers.json([], { 'Total-Results': '0' })
    })
    const result = await capped.search(request({ query: 'cascade' }))
    expect(result.supplemental?.scanned).toBe(2)
    expect(result.supplemental?.truncated).toBe(true)
    const scanRequests = mock.requests.filter((entry) => entry.search.get('itemType') === 'note')
    // One full page plus the one-row probe that proved more notes exist.
    expect(scanRequests).toHaveLength(2)
    expect(scanRequests[1]!.search.get('start')).toBe('2')
    expect(scanRequests[1]!.search.get('limit')).toBe('1')
  })

  it('does not probe when a short page already ended the scan', async () => {
    const library = [
      noteRow({ data: { note: 'cascade one' } }),
      noteRow({ key: 'NOTE2222', data: { note: 'cascade two' } }),
      noteRow({ key: 'NOTE3333', data: { note: 'cascade three' } }),
    ]
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') {
        const start = Number(search.get('start') ?? '0')
        const limit = Number(search.get('limit') ?? '0')
        helpers.json(library.slice(start, start + limit))
      } else helpers.json([], { 'Total-Results': '0' })
    })
    const result = await provider.search(request({ query: 'cascade' }))
    expect(result.supplemental?.scanned).toBe(3)
    expect(result.supplemental?.truncated).toBe(false)
    // A short page is EOF on its own: no probe request may follow it.
    expect(mock.requests.filter((entry) => entry.search.get('itemType') === 'note')).toHaveLength(1)
  })

  it('treats an empty scan response as no note matches', async () => {
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') helpers.json([])
      else helpers.json([searchHit()], { 'Total-Results': '1', 'Zotero-Server-ID': SERVER_ID })
    })
    const result = await provider.search(request({ query: 'cascade' }))
    expect(result.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/ABCD1234?server=S1',
    ])
    expect(result.total).toBe(1)
  })

  it('skips non-note scan rows, tagless notes, and partial term matches', async () => {
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note')
        helpers.json([
          attachment({
            key: 'ATTACH1X',
            data: { note: 'cascade infrastructure note', tags: [{ tag: 'reviewed' }] },
          }),
          noteRow({ key: 'NOTE4444', data: { note: 'cascade without the second term' } }),
        ])
      else helpers.json([searchHit()], { 'Total-Results': '1', 'Zotero-Server-ID': SERVER_ID })
    })
    const result = await provider.search(
      request({ query: 'cascade infrastructure', tags: ['reviewed'] }),
    )
    expect(result.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/ABCD1234?server=S1',
    ])
  })

  it('pages the scan in batches up to the cap', async () => {
    const capped = makeProvider(mock, { maxNoteScanRecords: 150 })
    const batch = (count: number) =>
      Array.from({ length: count }, (_, i) =>
        noteRow({
          key: `NOTE${String(i).padStart(4, '0')}`,
          data: { note: 'unrelated note body' },
        }),
      )
    let scanPage = 0
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers, search) => {
      if (search.get('itemType') === 'note') {
        scanPage += 1
        helpers.json(scanPage === 1 ? batch(100) : batch(30))
      } else {
        helpers.json([searchHit()], { 'Total-Results': '1', 'Zotero-Server-ID': SERVER_ID })
      }
    })
    const result = await capped.search(request({ query: 'cascade' }))
    expect(result.items.map((entry) => entry.ref)).toEqual([
      'zotero://user/0/item/ABCD1234?server=S1',
    ])
    expect(mock.requests[1]!.search.get('limit')).toBe('100')
    expect(mock.requests[2]!.search.get('start')).toBe('100')
    expect(mock.requests[2]!.search.get('limit')).toBe('50')
    expectRequestCount(mock, 3)
  })
})
