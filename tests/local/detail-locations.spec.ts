/**
 * `getItem` location resolution arms: the best-attachment link may be
 * resolved from a live item read, from the child row the detail already
 * listed, or from an attachment ref's own row; a cancellation that lands
 * after the parent read cancels the child batch.
 * @module tests/local/detail-locations
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ZoteroHttpClient } from '../../src/http-client.js'
import { getItem } from '../../src/local/detail.js'
import { ScopeDirectory } from '../../src/local/scope-directory.js'
import { parseRef } from '../../src/refs.js'
import type { ZoteroGetRequest } from '../../src/types.js'
import {
  PROVIDER_LIMITS,
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../helpers/provider-harness.js'
import { expectRequestLines, expectRequestPaths } from '../helpers/server/assert.js'
import {
  ATTACHMENT_KEY,
  ITEM_KEY,
  apiPath,
  attachmentRef,
  itemRef,
} from '../helpers/server/keys.js'
import { attachment, noteRow, paperItem, versionHeaders } from '../helpers/server/objects.js'
import { serveItemGraph, serveJson } from '../helpers/server/serve.js'

let harness: ProviderHarness

beforeEach(async () => {
  harness = await setupProvider()
})

afterEach(async () => {
  await teardownProvider(harness)
})

/** The canonical PDF as a linked URL, so location resolution needs no filesystem. */
const LINKED_PDF = attachment({
  data: { linkMode: 'linked_url', url: 'https://example.com/paper.pdf' },
})

const LINKED_URL = 'https://example.com/paper.pdf'

describe('getItem best-attachment location', () => {
  it('reads the linked attachment row when no child listing carried it', async () => {
    serveJson(harness.mock, `${apiPath()}/items/${ITEM_KEY}`, paperItem(), versionHeaders())
    serveJson(harness.mock, `${apiPath()}/items/${ATTACHMENT_KEY}`, LINKED_PDF, versionHeaders())

    const detail = await harness.provider.getItem({
      ref: parseRef(itemRef()),
      include: new Set(),
      locations: 'best',
    })
    expect(detail.bestAttachment?.location).toEqual({ kind: 'url', url: LINKED_URL })
    expectRequestLines(harness.mock, [
      `/api/users/0/items/${ITEM_KEY}`,
      `/api/users/0/items/${ATTACHMENT_KEY}`,
    ])
  })

  it('resolves the best attachment from the child row without a second item read', async () => {
    serveItemGraph(harness.mock, {
      children: [LINKED_PDF],
      attachmentItem: null,
      collections: null,
    })

    const detail = await harness.provider.getItem({
      ref: parseRef(itemRef()),
      include: new Set(['attachments']),
      locations: 'best',
    })
    expect(detail.bestAttachment?.location).toEqual({ kind: 'url', url: LINKED_URL })
    expectRequestPaths(harness.mock, [
      `/api/users/0/items/${ITEM_KEY}`,
      `/api/users/0/items/${ITEM_KEY}/children`,
    ])
  })

  it('resolves an attachment ref from its own served row', async () => {
    serveJson(harness.mock, `${apiPath()}/items/${ATTACHMENT_KEY}`, LINKED_PDF, versionHeaders())

    const detail = await harness.provider.getItem({
      ref: parseRef(attachmentRef()),
      include: new Set(),
      locations: 'best',
    })
    expect(detail.itemType).toBe('attachment')
    expect(detail.bestAttachment?.location).toEqual({ kind: 'url', url: LINKED_URL })
    expectRequestLines(harness.mock, [`/api/users/0/items/${ATTACHMENT_KEY}`])
  })

  it('reads the linked attachment live when only notes were listed', async () => {
    serveItemGraph(harness.mock, {
      children: [noteRow()],
      attachmentItem: null,
      collections: null,
    })
    serveJson(harness.mock, `${apiPath()}/items/${ATTACHMENT_KEY}`, LINKED_PDF, versionHeaders())

    const detail = await harness.provider.getItem({
      ref: parseRef(itemRef()),
      include: new Set(['notes']),
      locations: 'best',
    })
    expect(detail.bestAttachment?.location).toEqual({ kind: 'url', url: LINKED_URL })
    expectRequestPaths(harness.mock, [
      `/api/users/0/items/${ITEM_KEY}`,
      `/api/users/0/items/${ITEM_KEY}/children`,
      `/api/users/0/items/${ATTACHMENT_KEY}`,
    ])
  })
})

describe('getItem cancellation after the parent read', () => {
  it('aborts the child batch when the caller cancels after the parent arrives', async () => {
    const controller = new AbortController()
    let childSignal: AbortSignal | undefined
    const client = {
      getJson: async (path: string, _params: unknown, options?: { signal?: AbortSignal }) => {
        if (path === `users/0/items/${ITEM_KEY}`) {
          const parent = paperItem({ meta: { numChildren: 1 } })
          controller.abort()
          return { json: parent, headers: new Headers(versionHeaders()) }
        }
        childSignal = options?.signal
        return {
          json: [],
          headers: new Headers({ 'Total-Results': '0', 'Zotero-Server-ID': 'S1' }),
        }
      },
    } as unknown as ZoteroHttpClient
    const directory = new ScopeDirectory(
      client,
      () => 30_000,
      () => 2,
    )
    const request: ZoteroGetRequest = {
      ref: parseRef(itemRef()),
      include: new Set(['notes']),
    }

    await expect(
      getItem({ client, limits: PROVIDER_LIMITS }, directory, request, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(childSignal?.aborted).toBe(true)
  })
})
