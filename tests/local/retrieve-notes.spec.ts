/**
 * The `zotero_retrieve` note-first-class contract: a note item's own body is
 * its note source, a child note contributes every chunk of its full text with
 * locators, note bodies obey the configured budget, and child note records
 * carry their parent ref.
 * @module tests/provider/retrieve-notes
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type LocalApiProvider } from '../../src/local/provider.js'
import type { LocalApiLimits } from '../../src/local/limits.js'
import { parseRef } from '../../src/refs.js'
import {
  createProvider,
  getRequest,
  retrieveRequest,
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../helpers/provider-harness.js'
import { expectRequestPaths } from '../helpers/server/assert.js'
import { ITEM_KEY, NOTE_ITEM_KEY, apiPath, itemRef } from '../helpers/server/keys.js'
import { noteRow } from '../helpers/server/objects.js'
import { serveJson, serveItemGraph } from '../helpers/server/serve.js'
import { RETRIEVE_PARENT, RETRIEVE_PARENT_WITHOUT_ATTACHMENT } from './retrieve-graph.js'

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

describe('note-first-class paths', () => {
  it('treats a note item own body as its note source without fetching children', async () => {
    serveJson(
      mock,
      `${apiPath()}/items/${NOTE_ITEM_KEY}`,
      noteRow({
        key: NOTE_ITEM_KEY,
        data: { note: '<p>cascade failure chains</p><p>infrastructure interdependency</p>' },
      }),
    )
    const result = await provider.retrieve(
      retrieveRequest({
        ref: parseRef(itemRef(NOTE_ITEM_KEY)),
        query: 'cascade',
        sources: ['note'],
        passages: 4,
      }),
    )
    expectRequestPaths(mock, ['/api/users/0/items/NOTE9999'])
    expect(result.evidence).toEqual([
      {
        source: 'note',
        sourceRef: 'zotero://user/0/item/NOTE9999',
        text: 'cascade failure chains\ninfrastructure interdependency',
        chunkIndex: 0,
        chunkCount: 1,
      },
    ])
    expect(result.sourcesSkipped).toEqual([])
  })

  it('recognizes a note item from the top-level itemType fallback', async () => {
    // The item type rides at the record's top level; the fallback is what
    // makes this note recognizable.
    serveJson(mock, `${apiPath()}/items/${NOTE_ITEM_KEY}`, {
      key: NOTE_ITEM_KEY,
      itemType: 'note',
      data: { note: 'own body words' },
    })
    const result = await provider.retrieve(
      retrieveRequest({
        ref: parseRef(itemRef(NOTE_ITEM_KEY)),
        query: 'body',
        sources: ['note'],
        passages: 2,
      }),
    )
    expect(result.evidence.map((entry) => entry.text)).toEqual(['own body words'])
  })

  it('contributes every chunk of a long child note with locators', async () => {
    const narrow = makeProvider({ fulltextChunkWords: 2 })
    serveItemGraph(mock, {
      parent: RETRIEVE_PARENT_WITHOUT_ATTACHMENT,
      children: [noteRow({ data: { note: 'alpha beta gamma delta epsilon' } })],
      serverId: null,
    })
    const result = await narrow.retrieve(
      retrieveRequest({ sources: ['note'], passages: 10, query: 'alpha gamma epsilon' }),
    )
    // BM25 ranks the shorter `epsilon` chunk above the tied longer ones, so
    // the order is relevance order, not source order: every chunk must still
    // be present with its locators.
    expect(result.evidence.map((entry) => entry.source)).toEqual(['note', 'note', 'note'])
    expect(result.evidence.map((entry) => entry.text).sort()).toEqual([
      'alpha beta',
      'epsilon',
      'gamma delta',
    ])
    expect(new Set(result.evidence.map((entry) => entry.chunkIndex))).toEqual(new Set([0, 1, 2]))
    expect(result.evidence.map((entry) => entry.chunkCount)).toEqual([3, 3, 3])
    expect(
      result.evidence.every((entry) => entry.sourceRef === 'zotero://user/0/item/NOTE1111'),
    ).toBe(true)
  })

  it('skips an unavailable fulltext source while keeping note evidence', async () => {
    serveItemGraph(mock, {
      parent: RETRIEVE_PARENT_WITHOUT_ATTACHMENT,
      children: [noteRow({ data: { note: 'tiling strategy note' } })],
      serverId: null,
    })
    const result = await provider.retrieve(
      retrieveRequest({ sources: ['note', 'fulltext'], query: 'tiling' }),
    )
    expect(result.evidence.map((entry) => entry.source)).toEqual(['note'])
    expect(result.sourcesSkipped).toEqual(['fulltext'])
  })

  it('returns the note body for note items under the configured budget', async () => {
    const narrow = makeProvider({ maxNoteBodyChars: 8 })
    serveJson(
      mock,
      `${apiPath()}/items/${NOTE_ITEM_KEY}`,
      noteRow({
        key: NOTE_ITEM_KEY,
        data: { note: '<p>first line</p><p>second line long</p>' },
      }),
    )
    const detail = await narrow.getItem({
      ref: parseRef(itemRef(NOTE_ITEM_KEY)),
      include: new Set(),
    })
    expect(detail.itemType).toBe('note')
    expect(detail.noteBody).toEqual({ text: 'first li', truncated: true })
  })

  it('carries the parent ref on child note records', async () => {
    serveItemGraph(mock, {
      parent: RETRIEVE_PARENT,
      children: [noteRow({ data: { parentItem: ITEM_KEY, note: 'child note' } })],
    })
    const detail = await provider.getItem(getRequest(['notes']))
    expect(detail.notes!.items[0]).toMatchObject({
      ref: 'zotero://user/0/item/NOTE1111?server=S1',
      parentRef: 'zotero://user/0/item/ABCD1234?server=S1',
    })
  })
})
