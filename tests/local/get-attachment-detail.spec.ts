/**
 * Real Local API get → detail normalization for standalone attachments. The
 * metadata read exposes an actionable PDF without opening its file or children.
 * @module tests/local/get-attachment-detail
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseRef } from '../../src/refs.js'
import { serverIdFromHeaders } from '../../src/local/identity.js'
import { normalizeItemDetail } from '../../src/normalize-item-detail.js'
import { testHttpClient } from '../helpers/test-clients.js'
import {
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../helpers/provider-harness.js'
import { expectRequestLines } from '../helpers/server/assert.js'
import {
  ATTACHMENT_KEY,
  GROUP_LIBRARY,
  PERSONAL_LIBRARY,
  apiPath,
  refOf,
} from '../helpers/server/keys.js'
import { attachment, versionHeaders } from '../helpers/server/objects.js'
import { serveJson } from '../helpers/server/serve.js'

let harness: ProviderHarness
beforeEach(async () => {
  harness = await setupProvider()
})
afterEach(async () => {
  await teardownProvider(harness)
})

describe('getItem standalone attachment detail', () => {
  it('normalizes a standalone PDF fetched by the real HTTP client without a best-attachment link', async () => {
    const path = `${apiPath()}/items/${ATTACHMENT_KEY}`
    serveJson(
      harness.mock,
      path,
      attachment({ data: { title: 'Standalone appendix', filename: 'appendix.txt' } }),
      versionHeaders('S2'),
    )
    const response = await testHttpClient(harness.mock.baseUrl).getJson<unknown>(
      `users/0/items/${ATTACHMENT_KEY}`,
    )
    const detail = normalizeItemDetail({
      parent: response.json,
      library: PERSONAL_LIBRARY,
      serverId: serverIdFromHeaders(response.headers),
      include: new Set(),
      maxAbstractChars: 100,
      maxNoteBodyChars: 100,
      maxNoteChars: 100,
      maxNoteRecords: 10,
      maxAnnotationRecords: 10,
      maxAttachmentRecords: 10,
    })
    expect(detail.bestAttachment).toEqual({
      ref: 'zotero://user/0/attachment/WXYZ6789?server=S2',
      title: 'Standalone appendix',
      contentType: 'application/pdf',
    })
    expectRequestLines(harness.mock, [path])
  })

  it.each([
    { kind: 'item', library: PERSONAL_LIBRARY, label: 'personal item ref' },
    { kind: 'attachment', library: PERSONAL_LIBRARY, label: 'personal attachment ref' },
    { kind: 'item', library: GROUP_LIBRARY, label: 'group item ref' },
  ])('exposes the PDF itself with instance provenance from a $label', async ({ kind, library }) => {
    const path = `${apiPath(library)}/items/${ATTACHMENT_KEY}`
    serveJson(
      harness.mock,
      path,
      attachment({ data: { title: 'Standalone scanned appendix', filename: 'appendix.txt' } }),
      versionHeaders('Desktop A'),
    )

    const detail = await harness.provider.getItem({
      ref: parseRef(refOf(kind, ATTACHMENT_KEY, library)),
      include: new Set(),
    })
    expect(detail.ref).toBe(`${refOf(kind, ATTACHMENT_KEY, library)}?server=Desktop A`)
    expect(detail.bestAttachment).toMatchObject({
      ref: `${refOf('attachment', ATTACHMENT_KEY, library)}?server=Desktop A`,
      title: 'Standalone scanned appendix',
      contentType: 'application/pdf',
    })
    expect(detail.serverId).toBe('Desktop A')
    expect(detail.itemType).toBe('attachment')
    expect(detail.attachments).toBeUndefined()
    expect(detail.bestAttachment?.location).toBeUndefined()
    expectRequestLines(harness.mock, [path])
  })

  it.each([
    { label: 'HTML attachment', contentType: 'text/html' },
    { label: 'binary attachment', contentType: 'application/octet-stream' },
    { label: 'attachment without content type', contentType: undefined },
  ])('does not offer a self PDF for an $label named paper.pdf', async ({ contentType }) => {
    const path = `${apiPath()}/items/${ATTACHMENT_KEY}`
    serveJson(
      harness.mock,
      path,
      attachment({ data: { title: 'paper.pdf', filename: 'paper.pdf', contentType } }),
      versionHeaders(),
    )

    const detail = await harness.provider.getItem({
      ref: parseRef(refOf('item', ATTACHMENT_KEY)),
      include: new Set(),
    })
    expect(detail.itemType).toBe('attachment')
    expect(detail.bestAttachment?.contentType).toBe(contentType ?? '')
    expect(detail.bestAttachment?.contentType === 'application/pdf').toBe(false)
    expect(detail.attachments).toBeUndefined()
    expectRequestLines(harness.mock, [path])
  })
})
