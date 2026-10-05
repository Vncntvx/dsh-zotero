/**
 * The `zotero_export` provider contract: per-ref citations reordered to the
 * requested order, joined bibliography and translator formats, and the never
 * mid-truncated output limit.
 * @module tests/provider/export
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_NOT_FOUND,
  ZOTERO_SERVER_MISMATCH,
  ZOTERO_UNEXPECTED,
} from '../../src/errors.js'
import { type LocalApiProvider } from '../../src/local/provider.js'
import type { LocalApiLimits } from '../../src/local/limits.js'
import { ITEM_WITHOUT_KEY_MESSAGE } from '../../src/normalize.js'
import { expectedKindRefMessage, parseRef } from '../../src/refs.js'
import {
  createProvider,
  exportRequest,
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../helpers/provider-harness.js'
import { expectRequestCount, zoteroError } from '../helpers/server/assert.js'
import {
  GROUP_ID,
  ITEM_KEY,
  SECOND_ITEM_KEY,
  apiPath,
  attachmentRef,
  itemRef,
  refOf,
} from '../helpers/server/keys.js'
import { citationRow } from '../helpers/server/objects.js'
import { serveJson, serveText } from '../helpers/server/serve.js'

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

function makeProvider(limits: Partial<LocalApiLimits> = {}): LocalApiProvider {
  return createProvider(mock, limits)
}

describe('export', () => {
  it('pairs per-item citations with requested refs in one request', async () => {
    serveJson(mock, `${apiPath()}/items`, [
      citationRow(SECOND_ITEM_KEY, '<span>B, 2021</span>'),
      citationRow(ITEM_KEY, '<span>A, 2023</span>'),
    ])
    const result = await provider.export(
      exportRequest({ style: 'chicago-note-bibliography', locale: 'fr-FR' }),
    )
    const sent = mock.requests[0]!
    expect(sent.pathname).toBe(`${apiPath()}/items`)
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
    serveJson(mock, `${apiPath()}/items`, [
      citationRow(ITEM_KEY, 'x'),
      citationRow(SECOND_ITEM_KEY, 'y'),
    ])
    const result = await provider.export(exportRequest())
    const sent = mock.requests[0]!
    expect(sent.search.get('style')).toBe('apa')
    expect(sent.search.get('locale')).toBe('en-US')
    if (result.format !== 'citation') throw new Error('unreachable')
    expect(result.style).toBe('apa')
    expect(result.locale).toBe('en-US')
  })

  it('fails with NOT_FOUND when a requested key is missing from the citation response', async () => {
    serveJson(mock, `${apiPath()}/items`, [citationRow(ITEM_KEY, 'x')])
    await zoteroError(provider.export(exportRequest()), ZOTERO_NOT_FOUND, 'BBBB1234')
  })

  it('fetches a joined bibliography with format=bib', async () => {
    serveText(
      mock,
      `${apiPath()}/items`,
      '<div class="csl-entry">A</div>\n<div class="csl-entry">B</div>',
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

  it('passes translator export bodies through and itemizes every ref in a single request', async () => {
    mock.route('GET', `${apiPath()}/items`, (req, res, helpers, search) => {
      helpers.text(`exported-as-${search.get('format')}`)
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
      const expectedRequests = format === 'bibtex' || format === 'biblatex' ? 2 : 1
      const batchRequests = mock.requests.slice(before)
      expect(batchRequests).toHaveLength(expectedRequests)
      expect(batchRequests.some((r) => r.search.get('format') === format)).toBe(true)
      if (format === 'bibtex' || format === 'biblatex') {
        expect(batchRequests.some((r) => r.search.get('format') === null)).toBe(true)
      }
    }
  })

  it('pairs each translator document with its batch entry and projects the span', async () => {
    const batchText =
      '@article{customKeyA,\n  title = {Carbon price forecasting},\n}\n\n' +
      '@article{customKeyB,\n  title = {Insight into heterogeneous risks},\n}\n'
    const secondStart = batchText.indexOf('@article{customKeyB,')
    mock.route('GET', `${apiPath()}/items`, (req, res, helpers, search) => {
      if (search.get('format') === 'bibtex') {
        helpers.text(batchText)
      } else {
        helpers.json([
          { key: 'ABCD1234', data: { key: 'ABCD1234', title: 'Carbon price forecasting' } },
          { key: 'BBBB1234', data: { key: 'BBBB1234', title: 'Insight into heterogeneous risks' } },
        ])
      }
    })
    const result = await provider.export(exportRequest({ format: 'bibtex' }))
    if (result.format !== 'bibtex') throw new Error('unreachable')
    expect(result.text).toBe(batchText)
    expect(result.items).toEqual([
      {
        ref: 'zotero://user/0/item/ABCD1234',
        key: 'customKeyA',
        title: 'Carbon price forecasting',
        start: 0,
        end: secondStart,
      },
      {
        ref: 'zotero://user/0/item/BBBB1234',
        key: 'customKeyB',
        title: 'Insight into heterogeneous risks',
        start: secondStart,
        end: batchText.length,
      },
    ])
    // The export performs 2 batch requests: 1 for bibtex text and 1 for raw metadata
    expectRequestCount(mock, 2)
    expect(mock.requests[0]!.search.get('itemKey')).toBe('ABCD1234,BBBB1234')
    expect(mock.requests[0]!.search.get('format')).toBe('bibtex')
  })

  it('pairs RIS translator documents with requested refs in memory', async () => {
    const risText =
      'TY  - JOUR\nTI  - First Paper\nID  - ABCD1234\nER  -\n\nTY  - JOUR\nTI  - Second Paper\nID  - BBBB1234\nER  -\n'
    serveText(mock, `${apiPath()}/items`, risText)
    const risResult = await provider.export(exportRequest({ format: 'ris' }))
    if (risResult.format !== 'ris') throw new Error('unreachable')
    expect(risResult.items).toHaveLength(2)
    expect(risResult.items[0]!.ref).toBe('zotero://user/0/item/ABCD1234')
    expect(risResult.items[0]!.key).toBe('ABCD1234')
    expect(risResult.items[0]!.title).toBe('First Paper')
    expect(risResult.items[1]!.ref).toBe('zotero://user/0/item/BBBB1234')
    expect(risResult.items[1]!.key).toBe('BBBB1234')
    expect(risResult.items[1]!.title).toBe('Second Paper')
  })

  it('pairs CSL-JSON translator documents with requested refs in memory', async () => {
    const csljsonText = JSON.stringify([
      { id: 'ABCD1234', title: 'Paper A' },
      { id: 'http://zotero.org/users/0/items/BBBB1234', title: 'Paper B' },
    ])
    serveText(mock, `${apiPath()}/items`, csljsonText)
    const cslResult = await provider.export(exportRequest({ format: 'csljson' }))
    if (cslResult.format !== 'csljson') throw new Error('unreachable')
    expect(cslResult.items).toHaveLength(2)
    expect(cslResult.items[0]!.ref).toBe('zotero://user/0/item/ABCD1234')
    expect(cslResult.items[0]!.key).toBe('ABCD1234')
    expect(cslResult.items[0]!.title).toBe('Paper A')
    expect(cslResult.items[1]!.ref).toBe('zotero://user/0/item/BBBB1234')
    expect(cslResult.items[1]!.key).toBe('http://zotero.org/users/0/items/BBBB1234')
    expect(cslResult.items[1]!.title).toBe('Paper B')
  })

  it('fails with OUTPUT_TOO_LARGE instead of truncating oversized exports', async () => {
    const narrow = makeProvider({ maxExportChars: 10 })
    serveText(mock, `${apiPath()}/items`, '01234567890')
    await zoteroError(
      narrow.export(exportRequest({ format: 'bibtex' })),
      'ZOTERO_OUTPUT_TOO_LARGE',
      'exceeds',
    )
  })

  it('applies the output cap to citation pairs too', async () => {
    const narrow = makeProvider({ maxExportChars: 10 })
    serveJson(mock, `${apiPath()}/items`, [
      citationRow(ITEM_KEY, '01234567890'),
      citationRow(SECOND_ITEM_KEY, 'short'),
    ])
    await zoteroError(narrow.export(exportRequest()), 'ZOTERO_OUTPUT_TOO_LARGE')
  })

  it('accepts citation output that lands exactly on the output cap', async () => {
    const narrow = makeProvider({ maxExportChars: 10 })
    serveJson(mock, `${apiPath()}/items`, [
      citationRow(ITEM_KEY, '12345'),
      citationRow(SECOND_ITEM_KEY, '67890'),
    ])
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
    const narrow = makeProvider({ maxExportChars: 20 })
    mock.route('GET', `${apiPath()}/items`, (req, res, helpers, search) => {
      const keys = (search.get('itemKey') ?? '').split(',')
      if (keys.length > 1) {
        helpers.text('0123456789')
        return
      }
      helpers.text('12345')
    })
    // The cap accounts batch + singles (both stay in the result): 10 + 5 + 5
    // lands exactly on 20 and must pass; an off-by-one (>=) would reject it.
    const result = await narrow.export(exportRequest({ format: 'bibtex' }))
    expect(result).toEqual({
      format: 'bibtex',
      text: '0123456789',
      items: [{ ref: 'zotero://user/0/item/ABCD1234' }, { ref: 'zotero://user/0/item/BBBB1234' }],
    })
  })

  it("sends the first ref's server provenance on the export request", async () => {
    serveJson(mock, `${apiPath()}/items`, [
      citationRow(ITEM_KEY, 'x'),
      citationRow(SECOND_ITEM_KEY, 'y'),
    ])
    await provider.export(
      exportRequest({
        refs: [parseRef(`${itemRef()}?server=S1`), parseRef(itemRef(SECOND_ITEM_KEY))],
      }),
    )
    expect(mock.requests[0]!.headers['zotero-server-id']).toBe('S1')
  })

  it('rejects non-item and non-zero user refs before any request happens', async () => {
    await zoteroError(
      provider.export(exportRequest({ refs: [parseRef(attachmentRef())] })),
      'ZOTERO_INVALID_REF',
      expectedKindRefMessage(['item'], 'attachment'),
    )
    await zoteroError(
      provider.export(
        exportRequest({ refs: [parseRef(refOf('item', ITEM_KEY, { type: 'user', id: 123 }))] }),
      ),
      'ZOTERO_INVALID_REF',
      'user/0',
    )
    expectRequestCount(mock, 0)
  })

  it('batches citation requests at the API key cap and merges in request order', async () => {
    const refs = Array.from({ length: 51 }, (_, i) =>
      parseRef(`zotero://user/0/item/${String(i).padStart(4, '0')}ABCD`),
    )
    mock.route('GET', `${apiPath()}/items`, (req, res, helpers, search) =>
      helpers.json(
        (search.get('itemKey') ?? '').split(',').map((key) => ({ key, citation: `c-${key}` })),
      ),
    )
    const result = await provider.export(exportRequest({ refs, format: 'citation' }))
    const batchRequests = mock.requests.filter((entry) => entry.pathname === `${apiPath()}/items`)
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
    mock.route('GET', `${apiPath()}/items`, (req, res, helpers, search) =>
      helpers.json((search.get('itemKey') ?? '').split(',').map((key) => ({ key, citation: 'c' }))),
    )
    const result = await provider.export(exportRequest({ refs, format: 'citation' }))
    expectRequestCount(mock, 1)
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
    expectRequestCount(mock, 0)
  })

  it('counts unique items against the batch-breaking cap in a single request', async () => {
    const refs = Array.from({ length: 50 }, (_, i) =>
      parseRef(`zotero://user/0/item/${String(i).padStart(4, '0')}ABCD`),
    )
    refs.push(refs[0]!)
    serveText(
      mock,
      `${apiPath()}/items`,
      refs
        .slice(0, 50)
        .map((r) => `TY  - JOUR\nID  - ${r.key}\nER  -\n`)
        .join('\n'),
    )
    // 51 refs with one duplicate are 50 unique items, so the export proceeds in 1 batch request.
    const result = await provider.export(exportRequest({ refs, format: 'ris' }))
    if (result.format !== 'ris') throw new Error('unreachable')
    expectRequestCount(mock, 1)
    expect(result.items).toHaveLength(50)
  })

  it('fetches each unique item once when refs repeat', async () => {
    serveText(
      mock,
      `${apiPath()}/items`,
      'TY  - JOUR\nTI  - ABCD1234\nID  - ABCD1234\nER  -\n\nTY  - JOUR\nTI  - BBBB1234\nID  - BBBB1234\nER  -\n',
    )
    const result = await provider.export(
      exportRequest({
        format: 'ris',
        refs: [parseRef(itemRef()), parseRef(itemRef(SECOND_ITEM_KEY)), parseRef(itemRef())],
      }),
    )
    if (result.format !== 'ris') throw new Error('unreachable')
    expectRequestCount(mock, 1)
    expect(mock.requests[0]!.search.get('itemKey')).toBe('ABCD1234,BBBB1234')
    expect(result.items).toHaveLength(2)
  })

  it('itemizes a full 50-ref translator export in 1 batch request', async () => {
    const refs = Array.from({ length: 50 }, (_, i) =>
      parseRef(`zotero://user/0/item/${String(i).padStart(4, '0')}ABCD`),
    )
    serveText(
      mock,
      `${apiPath()}/items`,
      refs.map((r) => `TY  - JOUR\nID  - ${r.key}\nER  -\n`).join('\n'),
    )
    const result = await provider.export(exportRequest({ refs, format: 'ris' }))
    if (result.format !== 'ris') throw new Error('unreachable')
    expectRequestCount(mock, 1)
    expect(result.items).toHaveLength(50)
    // Every item locates its batch record, in the requested ref order.
    expect(result.items.every((item) => item.start !== undefined && item.end !== undefined)).toBe(
      true,
    )
    expect(result.items.map((item) => item.ref)).toEqual(
      refs.map((ref) => `zotero://user/0/item/${ref.key}`),
    )
  })

  it('applies the output cap across citation batches', async () => {
    const narrow = makeProvider({ maxExportChars: 5 })
    const refs = Array.from({ length: 51 }, (_, i) =>
      parseRef(`zotero://user/0/item/${String(i).padStart(4, '0')}ABCD`),
    )
    mock.route('GET', `${apiPath()}/items`, (req, res, helpers, search) =>
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
    serveJson(mock, `${apiPath()}/items`, [citationRow(ITEM_KEY, 'x')])
    await zoteroError(
      provider.export(
        exportRequest({
          refs: [
            parseRef(`${itemRef()}?server=S1`),
            parseRef(`${itemRef(SECOND_ITEM_KEY)}?server=S2`),
          ],
        }),
      ),
      ZOTERO_SERVER_MISMATCH,
    )
    expectRequestCount(mock, 0)
  })

  it('refuses refs from two libraries of the same instance before any request', async () => {
    // Two libraries on one instance are not a provenance mismatch — the
    // question is which library the export is about, and the API takes one.
    await zoteroError(
      provider.export(
        exportRequest({
          refs: [
            parseRef(itemRef()),
            parseRef(refOf('item', ITEM_KEY, { type: 'group', id: GROUP_ID })),
          ],
          format: 'bibtex',
        }),
      ),
      ZOTERO_INVALID_ARGUMENT,
      'same library',
    )
    expectRequestCount(mock, 0)
  })
})

describe('export tolerances', () => {
  it('fails loud when a citation response is not an array', async () => {
    serveJson(mock, `${apiPath()}/items`, { key: ITEM_KEY })
    await zoteroError(provider.export(exportRequest()), ZOTERO_UNEXPECTED)
  })

  it('fails loud on a citation row without a valid key', async () => {
    serveJson(mock, `${apiPath()}/items`, [{ citation: 'x' }])
    await zoteroError(provider.export(exportRequest()), ZOTERO_UNEXPECTED, ITEM_WITHOUT_KEY_MESSAGE)
  })

  it('tolerates rows without a citation string', async () => {
    serveJson(mock, `${apiPath()}/items`, [
      { key: ITEM_KEY },
      { key: SECOND_ITEM_KEY, citation: 'y' },
    ])
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
