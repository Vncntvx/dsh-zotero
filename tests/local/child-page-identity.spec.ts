/**
 * Child-page identity and target validation: an attachment target must prove
 * its item type, the annotation page keeps the identity of the read that
 * supplied it, an empty page still verifies its parent, and the child-row
 * loader reads only the halves the caller needs.
 * @module tests/local/child-page-identity
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZOTERO_INVALID_ARGUMENT } from '../../src/errors.js'
import { loadChildRows } from '../../src/local/detail.js'
import { parseRef, PERSONAL_LIBRARY } from '../../src/refs.js'
import { testHttpClient } from '../helpers/test-clients.js'
import {
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../helpers/provider-harness.js'
import { expectRequestLines, zoteroError } from '../helpers/server/assert.js'
import {
  ATTACHMENT_KEY,
  ITEM_KEY,
  SERVER_ID,
  apiPath,
  attachmentRef,
  itemRef,
} from '../helpers/server/keys.js'
import { annotationRow, attachment, noteRow, paperItem } from '../helpers/server/objects.js'
import { serveJson } from '../helpers/server/serve.js'

let harness: ProviderHarness

beforeEach(async () => {
  harness = await setupProvider()
})

afterEach(async () => {
  await teardownProvider(harness)
})

const annotationPagePath = `${apiPath()}/items/${ATTACHMENT_KEY}/children?itemType=annotation&start=0&limit=10`

describe('getChildPage attachment target', () => {
  it('names an attachment whose served row carries no item type', async () => {
    serveJson(harness.mock, `${apiPath()}/items/${ATTACHMENT_KEY}`, {
      key: ATTACHMENT_KEY,
      data: { title: 'Mystery' },
    })
    await zoteroError(
      harness.provider.getChildPage({
        ref: parseRef(attachmentRef()),
        kind: 'annotations',
        offset: 0,
        limit: 10,
      }),
      ZOTERO_INVALID_ARGUMENT,
      'could not be confirmed as an attachment',
    )
    expect(harness.mock.requests).toHaveLength(1)
  })
})

describe('getChildPage annotation identity', () => {
  it('keeps the attachment read identity on annotation rows when the page omits it', async () => {
    serveJson(harness.mock, `${apiPath()}/items/${ATTACHMENT_KEY}`, attachment(), {
      'Zotero-Server-ID': SERVER_ID,
    })
    serveJson(harness.mock, annotationPagePath, [annotationRow()], { 'Total-Results': '1' })

    const result = await harness.provider.getChildPage({
      ref: parseRef(attachmentRef()),
      kind: 'annotations',
      offset: 0,
      limit: 10,
    })
    expect(result.kind).toBe('annotations')
    if (result.kind !== 'annotations') throw new Error('expected an annotation page')
    expect(result.page.items[0]?.ref).toBe(
      `zotero://user/0/annotation/ANNO1111?server=${SERVER_ID}`,
    )
    expect(result.page.items[0]?.parentRef).toBe(
      `zotero://user/0/attachment/${ATTACHMENT_KEY}?server=${SERVER_ID}`,
    )
  })

  it('leaves annotation rows unqualified when neither read reports an identity', async () => {
    serveJson(harness.mock, `${apiPath()}/items/${ATTACHMENT_KEY}`, attachment())
    serveJson(harness.mock, annotationPagePath, [annotationRow()], { 'Total-Results': '1' })

    const result = await harness.provider.getChildPage({
      ref: parseRef(attachmentRef()),
      kind: 'annotations',
      offset: 0,
      limit: 10,
    })
    expect(result.kind).toBe('annotations')
    if (result.kind !== 'annotations') throw new Error('expected an annotation page')
    expect(result.page.items[0]?.ref).toBe('zotero://user/0/annotation/ANNO1111')
    expect(result.page.items[0]?.parentRef).toBe(`zotero://user/0/attachment/${ATTACHMENT_KEY}`)
  })
})

describe('getChildPage empty item page', () => {
  it('verifies the parent and keeps the page empty when no identity is reported', async () => {
    serveJson(
      harness.mock,
      `${apiPath()}/items/${ITEM_KEY}/children?itemType=note&start=0&limit=10`,
      [],
      {
        'Total-Results': '0',
      },
    )
    serveJson(harness.mock, `${apiPath()}/items/${ITEM_KEY}`, paperItem())

    const result = await harness.provider.getChildPage({
      ref: parseRef(itemRef()),
      kind: 'notes',
      offset: 0,
      limit: 10,
    })
    expect(result).toEqual({
      kind: 'notes',
      page: { total: 0, returned: 0, items: [], offset: 0, limit: 10 },
    })
    expectRequestLines(harness.mock, [
      `/api/users/0/items/${ITEM_KEY}/children?itemType=note&start=0&limit=10`,
      `/api/users/0/items/${ITEM_KEY}`,
    ])
  })
})

describe('loadChildRows halves', () => {
  it('reads annotations alone and omits the direct count when direct rows are not needed', async () => {
    serveJson(harness.mock, `${apiPath()}/items/${ITEM_KEY}/children?itemType=annotation`, [
      annotationRow({ data: { parentItem: ITEM_KEY } }),
    ])
    const rows = await loadChildRows(
      { client: testHttpClient(harness.mock.baseUrl) },
      ITEM_KEY,
      PERSONAL_LIBRARY,
      SERVER_ID,
      undefined,
      { direct: false, annotations: true },
    )
    expect(rows.rows).toHaveLength(1)
    expect(rows.directCount).toBeUndefined()
    expectRequestLines(harness.mock, [
      `/api/users/0/items/${ITEM_KEY}/children?itemType=annotation`,
    ])
  })

  it('returns the direct row count when direct rows are needed', async () => {
    serveJson(harness.mock, `${apiPath()}/items/${ITEM_KEY}/children`, [noteRow()])
    const rows = await loadChildRows(
      { client: testHttpClient(harness.mock.baseUrl) },
      ITEM_KEY,
      PERSONAL_LIBRARY,
      SERVER_ID,
      undefined,
      { direct: true, annotations: false },
    )
    expect(rows.rows).toHaveLength(1)
    expect(rows.directCount).toBe(1)
  })
})
