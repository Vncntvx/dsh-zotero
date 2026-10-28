/**
 * The dedicated child-page read: one paged child listing per call, no parent
 * or collection-name traffic, typed 404 for a missing parent, and the shared
 * window/cap rules.
 * @module tests/local/child-page
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZOTERO_INVALID_ARGUMENT, ZOTERO_NOT_FOUND } from '../../src/errors.js'
import { parseRef } from '../../src/refs.js'
import { type LocalApiProvider } from '../../src/local/provider.js'
import type { LocalApiLimits } from '../../src/local/limits.js'
import {
  createProvider,
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../helpers/provider-harness.js'
import { requestLines } from '../helpers/server/assert.js'
import { apiPath, attachmentRef, itemRef } from '../helpers/server/keys.js'
import { annotationRow, noteRow, paperItem } from '../helpers/server/objects.js'

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

const SERVER_HEADERS = { 'Zotero-Server-ID': 'S1' }

describe('getChildPage', () => {
  it('reads one child page without touching the parent or collection names', async () => {
    const notes = [noteRow(), noteRow({ key: 'NOTE2222' }), noteRow({ key: 'NOTE3333' })]
    mock.route('GET', `${apiPath()}/items/ABCD1234/children`, (_req, _res, helpers, search) => {
      expect(search.get('itemType')).toBe('note')
      helpers.json(notes, { ...SERVER_HEADERS, 'Total-Results': '3' })
    })
    const page = await provider.getChildPage?.({
      ref: parseRef(itemRef()),
      kind: 'notes',
      offset: 0,
      limit: 50,
    })
    expect(page).toEqual({
      kind: 'notes',
      page: {
        total: 3,
        returned: 3,
        offset: 0,
        limit: 50,
        items: notes.map((note) => expect.objectContaining({ ref: expect.any(String) })),
      },
    })
    const lines = requestLines(mock)
    expect(lines).toEqual([`${apiPath()}/items/ABCD1234/children?itemType=note&start=0&limit=50`])
  })

  it('pages by nextOffset and echoes the served window', async () => {
    const notes = [noteRow(), noteRow({ key: 'NOTE2222' })]
    mock.route('GET', `${apiPath()}/items/ABCD1234/children`, (_req, _res, helpers, search) => {
      const start = Number(search.get('start') ?? '0')
      helpers.json(notes.slice(start), {
        ...SERVER_HEADERS,
        'Total-Results': String(notes.length),
      })
    })
    const second = await provider.getChildPage?.({
      ref: parseRef(itemRef()),
      kind: 'notes',
      offset: 1,
      limit: 1,
    })
    expect(second?.page).toMatchObject({ total: 2, returned: 1, offset: 1, limit: 1 })
    expect(second?.page.nextOffset).toBeUndefined()
  })

  it('proves the parent exists when the first page is empty', async () => {
    mock.route('GET', `${apiPath()}/items/ABCD1234/children`, (_req, _res, helpers) => {
      helpers.json([], { ...SERVER_HEADERS, 'Total-Results': '0' })
    })
    mock.route('GET', `${apiPath()}/items/ABCD1234`, (_req, _res, helpers) => {
      helpers.json(paperItem(), SERVER_HEADERS)
    })
    const page = await provider.getChildPage?.({
      ref: parseRef(itemRef()),
      kind: 'notes',
      offset: 0,
      limit: 50,
    })
    expect(page?.page.total).toBe(0)
    expect(requestLines(mock)).toEqual([
      `${apiPath()}/items/ABCD1234/children?itemType=note&start=0&limit=50`,
      `${apiPath()}/items/ABCD1234`,
    ])
  })

  it('maps a missing parent to the typed 404', async () => {
    mock.route('GET', `${apiPath()}/items/ABCD1234/children`, (_req, _res, helpers) => {
      helpers.json([], { ...SERVER_HEADERS, 'Total-Results': '0' })
    })
    mock.route('GET', `${apiPath()}/items/ABCD1234`, (_req, _res, helpers) => {
      helpers.raw(404, { 'Content-Type': 'application/json' }, 'Not found')
    })
    await expect(
      provider.getChildPage?.({
        ref: parseRef(itemRef()),
        kind: 'notes',
        offset: 0,
        limit: 50,
      }),
    ).rejects.toMatchObject({ code: ZOTERO_NOT_FOUND })
  })

  it('serves the attachments arm of an item ref through the same window rules', async () => {
    const attachments = [
      { key: 'ATTA0001', data: { itemType: 'attachment', contentType: 'application/pdf' } },
    ]
    mock.route('GET', `${apiPath()}/items/ABCD1234/children`, (_req, _res, helpers, search) => {
      expect(search.get('itemType')).toBe('attachment')
      helpers.json(attachments, { ...SERVER_HEADERS, 'Total-Results': '1' })
    })
    const page = await provider.getChildPage?.({
      ref: parseRef(itemRef()),
      kind: 'attachments',
      offset: 0,
      limit: 50,
    })
    expect(page?.kind).toBe('attachments')
    expect(page?.page).toMatchObject({ total: 1, returned: 1, limit: 50 })
    expect(page?.page.items[0]).toMatchObject({ title: '', contentType: 'application/pdf' })
  })

  it('serves annotations under an item ref through the annotation-filtered listing', async () => {
    const annotations = [annotationRow()]
    mock.route('GET', `${apiPath()}/items/ABCD1234/children`, (_req, _res, helpers, search) => {
      expect(search.get('itemType')).toBe('annotation')
      helpers.json(annotations, { ...SERVER_HEADERS, 'Total-Results': '1' })
    })
    const page = await provider.getChildPage?.({
      ref: parseRef(itemRef()),
      kind: 'annotations',
      offset: 0,
      limit: 50,
    })
    expect(page?.kind).toBe('annotations')
    expect(page?.page.total).toBe(1)
  })

  it('serves annotations under an attachment ref and refuses other kinds', async () => {
    const annotations = [annotationRow()]
    mock.route('GET', `${apiPath()}/items/WXYZ6789/children`, (_req, _res, helpers, search) => {
      expect(search.get('itemType')).toBe('annotation')
      helpers.json(annotations, { ...SERVER_HEADERS, 'Total-Results': '1' })
    })
    mock.route('GET', `${apiPath()}/items/WXYZ6789`, (_req, _res, helpers) => {
      helpers.json(
        { key: 'WXYZ6789', data: { itemType: 'attachment', linkMode: 'imported_file' } },
        SERVER_HEADERS,
      )
    })
    const page = await provider.getChildPage?.({
      ref: parseRef(attachmentRef()),
      kind: 'annotations',
      offset: 0,
      limit: 50,
    })
    expect(page?.page.total).toBe(1)
    await expect(
      provider.getChildPage?.({
        ref: parseRef(attachmentRef()),
        kind: 'notes',
        offset: 0,
        limit: 50,
      }),
    ).rejects.toMatchObject({ code: ZOTERO_INVALID_ARGUMENT })
  })

  it('refuses an attachment-kind ref whose target is another item type', async () => {
    mock.route('GET', `${apiPath()}/items/ABCD1234`, (_req, _res, helpers) => {
      helpers.json(paperItem(), SERVER_HEADERS)
    })
    await expect(
      provider.getChildPage?.({
        ref: parseRef('zotero://user/0/attachment/ABCD1234'),
        kind: 'annotations',
        offset: 0,
        limit: 50,
      }),
    ).rejects.toMatchObject({ code: ZOTERO_INVALID_ARGUMENT })
  })

  it('clamps the page to the record cap and echoes the effective limit', async () => {
    provider = makeProvider({ maxNoteRecords: 2 })
    const notes = [noteRow(), noteRow({ key: 'NOTE2222' }), noteRow({ key: 'NOTE3333' })]
    mock.route('GET', `${apiPath()}/items/ABCD1234/children`, (_req, _res, helpers, search) => {
      const start = Number(search.get('start') ?? '0')
      const limit = Number(search.get('limit') ?? '50')
      helpers.json(notes.slice(start, start + limit), {
        ...SERVER_HEADERS,
        'Total-Results': '3',
      })
    })
    const page = await provider.getChildPage?.({
      ref: parseRef(itemRef()),
      kind: 'notes',
      offset: 0,
      limit: 50,
    })
    expect(page?.page).toMatchObject({ total: 3, returned: 2, offset: 0, limit: 2, nextOffset: 2 })
  })

  it.each([[0], [101], [2.5], [-1]])('refuses the out-of-window limit %j', async (limit) => {
    await expect(
      provider.getChildPage?.({
        ref: parseRef(itemRef()),
        kind: 'notes',
        offset: 0,
        // The wire schema clamps integers; the domain still owns the rule.
        limit: limit as number,
      }),
    ).rejects.toMatchObject({ code: ZOTERO_INVALID_ARGUMENT })
    expect(requestLines(mock)).toEqual([])
  })
})
