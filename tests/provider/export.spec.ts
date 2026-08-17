/**
 * The `zotero_export` provider contract: per-ref citations reordered to the
 * requested order, joined bibliography and translator formats, and the never
 * mid-truncated output limit.
 * @module tests/provider/export
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZOTERO_NOT_FOUND, ZOTERO_OUTPUT_TOO_LARGE, ZOTERO_UNEXPECTED } from '../../src/errors.js'
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

  it('passes translator export bodies through with the format parameter', async () => {
    mock.route('GET', '/api/users/0/items', (req, res, helpers, search) =>
      helpers.text(`exported-as-${search.get('format')}`),
    )
    for (const format of ['bibtex', 'biblatex', 'ris', 'csljson'] as const) {
      const result = await provider.export(exportRequest({ format }))
      expect(mock.requests[mock.requests.length - 1]!.search.get('format')).toBe(format)
      expect(result).toEqual({ format, text: `exported-as-${format}` })
    }
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
    mock.route('GET', '/api/users/0/items', (req, res, helpers) => helpers.text('0123456789'))
    const result = await narrow.export(exportRequest({ format: 'bibtex' }))
    expect(result).toEqual({ format: 'bibtex', text: '0123456789' })
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
