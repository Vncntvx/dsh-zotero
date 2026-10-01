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
  ZOTERO_OUTPUT_TOO_LARGE,
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
import { deferred, progress } from '../helpers/sync.js'

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

  it('passes translator export bodies through and itemizes every ref', async () => {
    mock.route('GET', `${apiPath()}/items`, (req, res, helpers, search) => {
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
    mock.route('GET', `${apiPath()}/items`, (req, res, helpers, search) => {
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
    expectRequestCount(mock, 3)
    expect(mock.requests[0]!.search.get('itemKey')).toBe('ABCD1234,BBBB1234')
    expect(mock.requests[0]!.search.get('format')).toBe('bibtex')
    const perItem = mock.requests.slice(1)
    expect(new Set(perItem.map((entry) => entry.search.get('itemKey')))).toEqual(
      new Set(['ABCD1234', 'BBBB1234']),
    )
    expect(perItem.every((entry) => entry.search.get('format') === 'bibtex')).toBe(true)
  })

  it('fails with NOT_FOUND when a single-item export comes back empty', async () => {
    mock.route('GET', `${apiPath()}/items`, (req, res, helpers, search) => {
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

  it('counts unique items against the batch-breaking cap', async () => {
    const refs = Array.from({ length: 50 }, (_, i) =>
      parseRef(`zotero://user/0/item/${String(i).padStart(4, '0')}ABCD`),
    )
    refs.push(refs[0]!)
    mock.route('GET', `${apiPath()}/items`, (req, res, helpers, search) => {
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
    expectRequestCount(mock, 51)
    expect(result.items).toHaveLength(50)
  })

  it('fetches each unique item once when refs repeat', async () => {
    mock.route('GET', `${apiPath()}/items`, (req, res, helpers, search) => {
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
        refs: [parseRef(itemRef()), parseRef(itemRef(SECOND_ITEM_KEY)), parseRef(itemRef())],
      }),
    )
    if (result.format !== 'ris') throw new Error('unreachable')
    // The batch request carries the deduplicated keys, and each unique item
    // is fetched once — the repeated ref never becomes a second request.
    expectRequestCount(mock, 3)
    expect(mock.requests[0]!.search.get('itemKey')).toBe('ABCD1234,BBBB1234')
    const perItem = mock.requests.slice(1)
    expect(new Set(perItem.map((entry) => entry.search.get('itemKey')))).toEqual(
      new Set(['ABCD1234', 'BBBB1234']),
    )
    expect(result.items).toHaveLength(2)
  })

  it('itemizes a full 50-ref translator export through the bounded pool', async () => {
    mock.route('GET', `${apiPath()}/items`, (req, res, helpers, search) => {
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
    expectRequestCount(mock, 51)
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
    mock.route('GET', `${apiPath()}/items`, async (req, res, helpers, search) => {
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
    // The delay is the measurement, not a synchronization guess: the pool's
    // fan-out is only visible as overlap at the server, and the client opens
    // its connections asynchronously, so the wave an over-eager pool would
    // send needs a window wide enough to land inside — the same instrument and
    // the same reason as `routeCounting` in tests/host/http-client.spec.ts.
    // Holding the responses and releasing them instead was tried and rejected:
    // the first release then paces the rest of the wave, and a pool that
    // ignored its bound never shows the extra requests. The pool keeps the
    // concurrent single-item requests at its bound; a bare Promise.all would
    // have put all eight in flight at once.
    expect(maxInFlight).toBe(4)
  })

  it('widens the single-item pool when exportConcurrency is raised', async () => {
    const raised = createProvider(mock, { exportConcurrency: 8 })
    let inFlight = 0
    let maxInFlight = 0
    mock.route('GET', `${apiPath()}/items`, async (req, res, helpers, search) => {
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
    await raised.export(exportRequest({ refs, format: 'ris' }))
    expect(maxInFlight).toBe(8)
  })

  it('stops the pool when one single-item export fails', async () => {
    /** Resolvers of the responses the test holds open, in start order. */
    const held: Array<() => void> = []
    const inFlight = progress()
    mock.route('GET', `${apiPath()}/items`, async (req, res, helpers, search) => {
      const keys = (search.get('itemKey') ?? '').split(',')
      if (keys.length > 1) {
        helpers.text('batch')
        return
      }
      if (keys[0] === '0002ABCD') {
        helpers.text('')
        return
      }
      const slot = deferred()
      held.push(slot.resolve)
      inFlight.notify()
      await slot.promise
      if (res.destroyed || res.writableEnded) return
      helpers.text(`entry-of-${keys[0]}`)
    })
    const refs = Array.from({ length: 8 }, (_, i) =>
      parseRef(`zotero://user/0/item/${String(i).padStart(4, '0')}ABCD`),
    )
    const call = provider.export(exportRequest({ refs, format: 'ris' }))
    // The expected failure is asserted through `zoteroError` first: the call
    // attaches the handler immediately, so the rejection the wait below is
    // written to expect never sits unhandled while that wait is pending.
    const failure = zoteroError(call, ZOTERO_NOT_FOUND, '0002ABCD')
    // Four workers open and only the failing item answers: the other three
    // hold their responses, so the failure is processed with them still in
    // flight — a pool that ignored it could start items 4..7 only once they
    // complete, and the test decides when that happens.
    await inFlight.when(() => held.length >= 3)
    await failure
    // Release the in-flight workers. Whether the pool starts a further item is
    // decided as each one completes, so this settle is the measurement: "no
    // further item was started" is an absence, and nothing after the release
    // is a positive event to wait on — it is the time those completions need
    // to reach the client and for a request they provoke to come back here.
    for (const release of held.splice(0)) release()
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
    mock.route('GET', `${apiPath()}/items`, (req, res, helpers, search) => {
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
    /** Resolvers of the responses the test holds open, in start order. */
    const held: Array<() => void> = []
    /** Set by the abort: requests answering after it are served instead of held. */
    let cancelled = false
    const inFlight = progress()
    mock.route('GET', `${apiPath()}/items`, async (req, res, helpers, search) => {
      const keys = (search.get('itemKey') ?? '').split(',')
      if (keys.length > 1) {
        helpers.text('batch')
        return
      }
      // Held before the abort, so the request is on the wire and answering
      // nothing when the caller cancels; served after it, so a call that
      // ignored the cancellation cannot hide behind a response never sent.
      if (!cancelled) {
        const slot = deferred()
        held.push(slot.resolve)
        inFlight.notify()
        await slot.promise
      }
      if (res.destroyed || res.writableEnded) return
      helpers.text(`entry-of-${keys[0]}`)
    })
    const controller = new AbortController()
    const call = provider.export(exportRequest({ format: 'ris' }), controller.signal)
    // A per-document request has reached the mock: the abort below lands on a
    // request in flight, never on a race against a delay.
    await inFlight.when(() => held.length >= 1)
    controller.abort()
    cancelled = true
    for (const release of held.splice(0)) release()
    await expect(call).rejects.toThrow()
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
  it('treats a non-array citation response as missing items', async () => {
    serveJson(mock, `${apiPath()}/items`, { key: ITEM_KEY })
    await zoteroError(provider.export(exportRequest()), ZOTERO_NOT_FOUND, 'ABCD1234')
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
