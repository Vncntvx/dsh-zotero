/**
 * The `zotero_export` provider contract: per-ref citations reordered to the
 * requested order, joined bibliography and translator formats, and the never
 * mid-truncated output limit.
 * @module tests/provider/export
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ZOTERO_NOT_FOUND,
  ZOTERO_OUTPUT_TOO_LARGE,
  ZOTERO_SERVER_MISMATCH,
  ZOTERO_UNEXPECTED,
} from '../../src/errors.js'
import { type LocalApiLimits, type LocalApiProvider } from '../../src/provider-local.js'
import { parseRef } from '../../src/refs.js'
import { MockZotero } from '../helpers/mock-zotero.js'
import {
  createProvider,
  exportRequest,
  setupProvider,
  teardownProvider,
  zoteroError,
  type ProviderHarness,
} from '../helpers/provider-harness.js'

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

function makeProvider(limits: Partial<LocalApiLimits> = {}): LocalApiProvider {
  return createProvider(mock, limits)
}

describe('export', () => {
  it('pairs per-item citations with requested refs in one request', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.json([
        { key: 'BBBB1234', citation: '<span>B, 2021</span>' },
        { key: 'ABCD1234', citation: '<span>A, 2023</span>' },
      ]),
    )
    const result = await provider.export(
      exportRequest({ style: 'chicago-note-bibliography', locale: 'fr-FR' }),
    )
    const sent = mock.requests[0]!
    expect(sent.pathname).toBe('/api/users/0/items')
    expect(sent.search.get('itemKey')).toBe('ABCD1234,BBBB1234')
    expect(sent.search.get('include')).toBe('citation')
    expect(sent.search.get('style')).toBe('chicago-note-bibliography')
    expect(sent.search.get('locale')).toBe('fr-FR')
    expect(result).toEqual({
      format: 'citation',
      style: 'chicago-note-bibliography',
      locale: 'fr-FR',
      citations: [
        { ref: 'zotero://user/0/item/ABCD1234', text: '<span>A, 2023</span>' },
        { ref: 'zotero://user/0/item/BBBB1234', text: '<span>B, 2021</span>' },
      ],
    })
  })

  it('applies the configured defaults for style and locale', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.json([
        { key: 'ABCD1234', citation: 'x' },
        { key: 'BBBB1234', citation: 'y' },
      ]),
    )
    const result = await provider.export(exportRequest())
    const sent = mock.requests[0]!
    expect(sent.search.get('style')).toBe('apa')
    expect(sent.search.get('locale')).toBe('en-US')
    if (result.format !== 'citation') throw new Error('unreachable')
    expect(result.style).toBe('apa')
    expect(result.locale).toBe('en-US')
  })

  it('fails with NOT_FOUND when a requested key is missing from the citation response', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.json([{ key: 'ABCD1234', citation: 'x' }]),
    )
    await zoteroError(provider.export(exportRequest()), ZOTERO_NOT_FOUND, 'BBBB1234')
  })

  it('fetches a joined bibliography with format=bib', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.text('<div class="csl-entry">A</div>\n<div class="csl-entry">B</div>'),
    )
    const result = await provider.export(exportRequest({ format: 'bibliography' }))
    const sent = mock.requests[0]!
    expect(sent.search.get('format')).toBe('bib')
    expect(sent.search.get('style')).toBe('apa')
    expect(sent.search.get('locale')).toBe('en-US')
    expect(result).toEqual({
      format: 'bibliography',
      style: 'apa',
      locale: 'en-US',
      text: '<div class="csl-entry">A</div>\n<div class="csl-entry">B</div>',
    })
  })

  it('passes translator export bodies through and itemizes every ref', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers, search) => {
      const keys = (search.get('itemKey') ?? '').split(',')
      if (keys.length > 1) {
        helpers.text(`exported-as-${search.get('format')}`)
        return
      }
      helpers.text(`entry-of-${search.get('format')}-${keys[0]}`)
    })
    for (const format of ['bibtex', 'biblatex', 'ris', 'csljson'] as const) {
      const before = mock.requests.length
      const result = await provider.export(exportRequest({ format }))
      if (result.format !== format) throw new Error('unreachable')
      expect(result.text).toBe(`exported-as-${format}`)
      // A body without parseable entries leaves every item unlocated, but
      // the per-ref itemization itself is always present.
      expect(result.items).toEqual([
        { ref: 'zotero://user/0/item/ABCD1234' },
        { ref: 'zotero://user/0/item/BBBB1234' },
      ])
      const perItem = mock.requests.slice(before + 1)
      expect(perItem).toHaveLength(2)
      expect(new Set(perItem.map((entry) => entry.search.get('itemKey')))).toEqual(
        new Set(['ABCD1234', 'BBBB1234']),
      )
      expect(perItem.every((entry) => entry.search.get('format') === format)).toBe(true)
    }
  })

  it('pairs each translator document with its batch entry and projects the span', async () => {
    const batchText =
      '@article{batchPan2022,\n  title = {Carbon price forecasting},\n}\n\n' +
      '@article{batchZheng2025,\n  title = {Insight into heterogeneous risks},\n}\n'
    const secondStart = batchText.indexOf('@article{batchZheng2025,')
    mock.route('GET', '/api/users/0/items', (req, res, helpers, search) => {
      const keys = (search.get('itemKey') ?? '').split(',')
      if (keys.length > 1) {
        helpers.text(batchText)
        return
      }
      // The single-item context generates different citation keys; the
      // mapping must still pair the entries by their content.
      helpers.text(
        keys[0] === 'ABCD1234'
          ? '@article{singlePan2022,\n  title = {Carbon price forecasting},\n}\n'
          : '@article{singleZheng2025,\n  title = {Insight into heterogeneous risks},\n}\n',
      )
    })
    const result = await provider.export(exportRequest({ format: 'bibtex' }))
    if (result.format !== 'bibtex') throw new Error('unreachable')
    expect(result.text).toBe(batchText)
    // The batch body's own citation keys win over the single-item context's.
    expect(result.items).toEqual([
      {
        ref: 'zotero://user/0/item/ABCD1234',
        key: 'batchPan2022',
        title: 'Carbon price forecasting',
        start: 0,
        end: secondStart,
      },
      {
        ref: 'zotero://user/0/item/BBBB1234',
        key: 'batchZheng2025',
        title: 'Insight into heterogeneous risks',
        start: secondStart,
        end: batchText.length,
      },
    ])
    // The merged body stays one batch request; each ref then gets its own
    // single-key request, so the pairing never indexes the batch's order.
    expect(mock.requests).toHaveLength(3)
    expect(mock.requests[0]!.search.get('itemKey')).toBe('ABCD1234,BBBB1234')
    expect(mock.requests[0]!.search.get('format')).toBe('bibtex')
    const perItem = mock.requests.slice(1)
    expect(new Set(perItem.map((entry) => entry.search.get('itemKey')))).toEqual(
      new Set(['ABCD1234', 'BBBB1234']),
    )
    expect(perItem.every((entry) => entry.search.get('format') === 'bibtex')).toBe(true)
  })

  it('fails with NOT_FOUND when a single-item export comes back empty', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers, search) => {
      const keys = (search.get('itemKey') ?? '').split(',')
      if (keys.length > 1) {
        helpers.text('@article{a1}\n@article{b1}\n')
        return
      }
      helpers.text(keys[0] === 'ABCD1234' ? '@article{a1,\n  title = {A},\n}' : '')
    })
    await zoteroError(
      provider.export(exportRequest({ format: 'bibtex' })),
      ZOTERO_NOT_FOUND,
      'BBBB1234',
    )
  })

  it('fails with OUTPUT_TOO_LARGE instead of truncating oversized exports', async () => {
    const narrow = makeProvider({ maxExportChars: 10 })
    mock.route('GET', '/api/users/0/items', (req, res, helpers) => helpers.text('01234567890'))
    await zoteroError(
      narrow.export(exportRequest({ format: 'bibtex' })),
      'ZOTERO_OUTPUT_TOO_LARGE',
      'exceeds',
    )
  })

  it('applies the output cap to citation pairs too', async () => {
    const narrow = makeProvider({ maxExportChars: 10 })
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.json([
        { key: 'ABCD1234', citation: '01234567890' },
        { key: 'BBBB1234', citation: 'short' },
      ]),
    )
    await zoteroError(narrow.export(exportRequest()), 'ZOTERO_OUTPUT_TOO_LARGE')
  })

  it('accepts citation output that lands exactly on the output cap', async () => {
    const narrow = makeProvider({ maxExportChars: 10 })
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.json([
        { key: 'ABCD1234', citation: '12345' },
        { key: 'BBBB1234', citation: '67890' },
      ]),
    )
    // Export text is never mid-truncated, so an output that fits the cap
    // exactly must pass; an off-by-one (>=) would reject it.
    const result = await narrow.export(exportRequest())
    expect(result).toEqual({
      format: 'citation',
      style: 'apa',
      locale: 'en-US',
      citations: [
        { ref: 'zotero://user/0/item/ABCD1234', text: '12345' },
        { ref: 'zotero://user/0/item/BBBB1234', text: '67890' },
      ],
    })
  })

  it('accepts a raw export body that lands exactly on the output cap', async () => {
    const narrow = makeProvider({ maxExportChars: 10 })
    mock.route('GET', '/api/users/0/items', (req, res, helpers, search) => {
      const keys = (search.get('itemKey') ?? '').split(',')
      if (keys.length > 1) {
        helpers.text('0123456789')
        return
      }
      helpers.text('12345')
    })
    const result = await narrow.export(exportRequest({ format: 'bibtex' }))
    expect(result).toEqual({
      format: 'bibtex',
      text: '0123456789',
      items: [{ ref: 'zotero://user/0/item/ABCD1234' }, { ref: 'zotero://user/0/item/BBBB1234' }],
    })
  })

  it("sends the first ref's server provenance on the export request", async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.json([
        { key: 'ABCD1234', citation: 'x' },
        { key: 'BBBB1234', citation: 'y' },
      ]),
    )
    await provider.export(
      exportRequest({
        refs: [
          parseRef('zotero://user/0/item/ABCD1234?server=S1'),
          parseRef('zotero://user/0/item/BBBB1234'),
        ],
      }),
    )
    expect(mock.requests[0]!.headers['zotero-server-id']).toBe('S1')
  })

  it('rejects non-item and group refs before any request happens', async () => {
    await zoteroError(
      provider.export(exportRequest({ refs: [parseRef('zotero://user/0/attachment/WXYZ6789')] })),
      'ZOTERO_INVALID_REF',
      'Expected a item reference',
    )
    await zoteroError(
      provider.export(exportRequest({ refs: [parseRef('zotero://group/42/item/ABCD1234')] })),
      'ZOTERO_INVALID_REF',
      'Group library references are not supported',
    )
    expect(mock.requests).toEqual([])
  })

  it('batches citation requests at the API key cap and merges in request order', async () => {
    const refs = Array.from({ length: 51 }, (_, i) =>
      parseRef(`zotero://user/0/item/${String(i).padStart(4, '0')}ABCD`),
    )
    mock.route('GET', '/api/users/0/items', (req, res, helpers, search) =>
      helpers.json(
        (search.get('itemKey') ?? '').split(',').map((key) => ({ key, citation: `c-${key}` })),
      ),
    )
    const result = await provider.export(exportRequest({ refs, format: 'citation' }))
    const batchRequests = mock.requests.filter((entry) => entry.pathname === '/api/users/0/items')
    expect(batchRequests).toHaveLength(2)
    expect(batchRequests[0]!.search.get('itemKey')!.split(',')).toHaveLength(50)
    expect(batchRequests[1]!.search.get('itemKey')!.split(',')).toHaveLength(1)
    if (result.format !== 'citation') throw new Error('unreachable')
    // Merging keeps the requested order across batches; no citation is lost.
    expect(result.citations.map((entry) => entry.ref)).toEqual(
      refs.map((ref) => `zotero://user/0/item/${ref.key}`),
    )
  })

  it('keeps exactly the API key cap in a single citation request', async () => {
    const refs = Array.from({ length: 50 }, (_, i) =>
      parseRef(`zotero://user/0/item/${String(i).padStart(4, '0')}ABCD`),
    )
    mock.route('GET', '/api/users/0/items', (req, res, helpers, search) =>
      helpers.json((search.get('itemKey') ?? '').split(',').map((key) => ({ key, citation: 'c' }))),
    )
    const result = await provider.export(exportRequest({ refs, format: 'citation' }))
    expect(mock.requests).toHaveLength(1)
    if (result.format !== 'citation') throw new Error('unreachable')
    expect(result.citations).toHaveLength(50)
  })

  it('refuses batch-breaking formats above the API key cap without a request', async () => {
    const refs = Array.from({ length: 51 }, (_, i) =>
      parseRef(`zotero://user/0/item/${String(i).padStart(4, '0')}ABCD`),
    )
    for (const format of ['bibliography', 'bibtex', 'biblatex', 'ris', 'csljson'] as const) {
      await zoteroError(
        provider.export(exportRequest({ refs, format })),
        'ZOTERO_INVALID_ARGUMENT',
        '50',
      )
    }
    expect(mock.requests).toEqual([])
  })

  it('counts unique items against the batch-breaking cap', async () => {
    const refs = Array.from({ length: 50 }, (_, i) =>
      parseRef(`zotero://user/0/item/${String(i).padStart(4, '0')}ABCD`),
    )
    refs.push(refs[0]!)
    mock.route('GET', '/api/users/0/items', (req, res, helpers, search) => {
      const keys = (search.get('itemKey') ?? '').split(',')
      if (keys.length > 1) {
        helpers.text(keys.map((key) => `TY  - JOUR\nID  - ${key}\nER  -\n`).join('\n'))
        return
      }
      helpers.text(`TY  - JOUR\nID  - ${keys[0]}\nER  -\n`)
    })
    // 51 refs with one duplicate are 50 unique items, so the export proceeds.
    const result = await provider.export(exportRequest({ refs, format: 'ris' }))
    if (result.format !== 'ris') throw new Error('unreachable')
    expect(mock.requests).toHaveLength(51)
    expect(result.items).toHaveLength(50)
  })

  it('fetches each unique item once when refs repeat', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers, search) => {
      const keys = (search.get('itemKey') ?? '').split(',')
      if (keys.length > 1) {
        helpers.text(
          keys.map((key) => `TY  - JOUR\nTI  - ${key}\nID  - ${key}\nER  -\n`).join('\n'),
        )
        return
      }
      helpers.text(`TY  - JOUR\nTI  - ${keys[0]}\nID  - ${keys[0]}\nER  -\n`)
    })
    const result = await provider.export(
      exportRequest({
        format: 'ris',
        refs: [
          parseRef('zotero://user/0/item/ABCD1234'),
          parseRef('zotero://user/0/item/BBBB1234'),
          parseRef('zotero://user/0/item/ABCD1234'),
        ],
      }),
    )
    if (result.format !== 'ris') throw new Error('unreachable')
    // The batch request carries the deduplicated keys, and each unique item
    // is fetched once — the repeated ref never becomes a second request.
    expect(mock.requests).toHaveLength(3)
    expect(mock.requests[0]!.search.get('itemKey')).toBe('ABCD1234,BBBB1234')
    const perItem = mock.requests.slice(1)
    expect(new Set(perItem.map((entry) => entry.search.get('itemKey')))).toEqual(
      new Set(['ABCD1234', 'BBBB1234']),
    )
    expect(result.items).toHaveLength(2)
  })

  it('itemizes a full 50-ref translator export through the bounded pool', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers, search) => {
      const keys = (search.get('itemKey') ?? '').split(',')
      if (keys.length > 1) {
        helpers.text(keys.map((key) => `TY  - JOUR\nID  - ${key}\nER  -\n`).join('\n'))
        return
      }
      helpers.text(`TY  - JOUR\nID  - ${keys[0]}\nER  -\n`)
    })
    const refs = Array.from({ length: 50 }, (_, i) =>
      parseRef(`zotero://user/0/item/${String(i).padStart(4, '0')}ABCD`),
    )
    const result = await provider.export(exportRequest({ refs, format: 'ris' }))
    if (result.format !== 'ris') throw new Error('unreachable')
    expect(mock.requests).toHaveLength(51)
    expect(result.items).toHaveLength(50)
    // Every item locates its batch record, in the requested ref order.
    expect(result.items.every((item) => item.start !== undefined && item.end !== undefined)).toBe(
      true,
    )
    expect(result.items.map((item) => item.ref)).toEqual(
      refs.map((ref) => `zotero://user/0/item/${ref.key}`),
    )
  })

  it('limits the single-item requests to a bounded concurrency', async () => {
    let inFlight = 0
    let maxInFlight = 0
    mock.route('GET', '/api/users/0/items', async (req, res, helpers, search) => {
      const keys = (search.get('itemKey') ?? '').split(',')
      if (keys.length > 1) {
        helpers.text('batch')
        return
      }
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 30))
      inFlight -= 1
      helpers.text(`entry-of-${keys[0]}`)
    })
    const refs = Array.from({ length: 8 }, (_, i) =>
      parseRef(`zotero://user/0/item/${String(i).padStart(4, '0')}ABCD`),
    )
    await provider.export(exportRequest({ refs, format: 'ris' }))
    // The pool keeps the concurrent single-item requests at its bound; a
    // bare Promise.all would have put all eight in flight at once.
    expect(maxInFlight).toBe(4)
  })

  it('stops the pool when one single-item export fails', async () => {
    mock.route('GET', '/api/users/0/items', async (req, res, helpers, search) => {
      const keys = (search.get('itemKey') ?? '').split(',')
      if (keys.length > 1) {
        helpers.text('batch')
        return
      }
      if (keys[0] === '0002ABCD') {
        helpers.text('')
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 30))
      if (res.destroyed || res.writableEnded) return
      helpers.text(`entry-of-${keys[0]}`)
    })
    const refs = Array.from({ length: 8 }, (_, i) =>
      parseRef(`zotero://user/0/item/${String(i).padStart(4, '0')}ABCD`),
    )
    await zoteroError(
      provider.export(exportRequest({ refs, format: 'ris' })),
      ZOTERO_NOT_FOUND,
      '0002ABCD',
    )
    // Let the in-flight workers finish their delayed responses: the failure
    // must stop the pool from starting further items even as those complete.
    await new Promise((resolve) => setTimeout(resolve, 60))
    const requestedKeys = new Set(
      mock.requests
        .map((entry) => entry.search.get('itemKey'))
        .filter((key): key is string => key !== null && key.split(',').length === 1),
    )
    for (const ref of refs.slice(4)) {
      expect(requestedKeys.has(ref.key)).toBe(false)
    }
  })

  it('applies the output cap to the per-document exports too', async () => {
    const narrow = makeProvider({ maxExportChars: 20 })
    mock.route('GET', '/api/users/0/items', (req, res, helpers, search) => {
      const keys = (search.get('itemKey') ?? '').split(',')
      if (keys.length > 1) {
        helpers.text('small batch body')
        return
      }
      helpers.text('x'.repeat(12))
    })
    // The batch body fits the cap, but the two single-item bodies together
    // exceed it — the cumulative per-document budget fails the call closed.
    await zoteroError(
      narrow.export(exportRequest({ format: 'ris' })),
      ZOTERO_OUTPUT_TOO_LARGE,
      'Per-document',
    )
  })

  it('propagates an abort while the per-document requests are in flight', async () => {
    mock.route('GET', '/api/users/0/items', async (req, res, helpers, search) => {
      const keys = (search.get('itemKey') ?? '').split(',')
      if (keys.length > 1) {
        helpers.text('batch')
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
      if (res.destroyed || res.writableEnded) return
      helpers.text(`entry-of-${keys[0]}`)
    })
    const controller = new AbortController()
    const call = provider.export(exportRequest({ format: 'ris' }), controller.signal)
    setTimeout(() => controller.abort(), 20)
    await expect(call).rejects.toThrow()
  })

  it('applies the output cap across citation batches', async () => {
    const narrow = makeProvider({ maxExportChars: 5 })
    const refs = Array.from({ length: 51 }, (_, i) =>
      parseRef(`zotero://user/0/item/${String(i).padStart(4, '0')}ABCD`),
    )
    mock.route('GET', '/api/users/0/items', (req, res, helpers, search) =>
      helpers.json(
        (search.get('itemKey') ?? '').split(',').map((key) => ({ key, citation: 'xx' })),
      ),
    )
    await zoteroError(
      narrow.export(exportRequest({ refs, format: 'citation' })),
      'ZOTERO_OUTPUT_TOO_LARGE',
    )
  })

  it('fails closed when export refs mix Zotero instances', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.json([{ key: 'ABCD1234', citation: 'x' }]),
    )
    await zoteroError(
      provider.export(
        exportRequest({
          refs: [
            parseRef('zotero://user/0/item/ABCD1234?server=S1'),
            parseRef('zotero://user/0/item/BBBB1234?server=S2'),
          ],
        }),
      ),
      ZOTERO_SERVER_MISMATCH,
    )
    expect(mock.requests).toEqual([])
  })
})

describe('export tolerances', () => {
  it('treats a non-array citation response as missing items', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.json({ key: 'ABCD1234' }),
    )
    await zoteroError(provider.export(exportRequest()), ZOTERO_NOT_FOUND, 'ABCD1234')
  })

  it('fails loud on a citation row without a valid key', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.json([{ citation: 'x' }]),
    )
    await zoteroError(
      provider.export(exportRequest()),
      ZOTERO_UNEXPECTED,
      'without a valid object key',
    )
  })

  it('tolerates rows without a citation string', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers) =>
      helpers.json([{ key: 'ABCD1234' }, { key: 'BBBB1234', citation: 'y' }]),
    )
    const result = await provider.export(exportRequest())
    expect(result).toEqual({
      format: 'citation',
      style: 'apa',
      locale: 'en-US',
      citations: [
        { ref: 'zotero://user/0/item/ABCD1234', text: '' },
        { ref: 'zotero://user/0/item/BBBB1234', text: 'y' },
      ],
    })
  })
})
