/**
 * The `zotero_get` provider contract: item detail with lazy children and
 * collection names, and attachment resolution to verified on-disk files or
 * linked URLs.
 * @module tests/provider/get
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZOTERO_FILE_MISSING, ZOTERO_NO_ATTACHMENT, ZOTERO_UNEXPECTED } from '../../src/errors.js'
import {
  attachmentTypeMessage,
  missingAttachmentFileMessage,
  missingLinkedUrlMessage,
  noAttachmentToResolveMessage,
  noUsableFileLocationMessage,
  notAWebLocationMessage,
  unsupportedAttachmentProtocolMessage,
} from '../../src/local/attachment-location.js'
import { type LocalApiProvider } from '../../src/local/provider.js'
import { foreignUserRefMessage, parseRef } from '../../src/refs.js'
import {
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../helpers/provider-harness.js'
import { expectRequestCount, expectRequestPaths, zoteroError } from '../helpers/server/assert.js'
import {
  ATTACHMENT_KEY,
  ITEM_KEY,
  apiPath,
  attachmentRef,
  itemRef,
} from '../helpers/server/keys.js'
import { attachment, item, noteRow, paperItem, versionHeaders } from '../helpers/server/objects.js'
import { serveJson, serveText } from '../helpers/server/serve.js'

let mock: ProviderHarness['mock']
let provider: LocalApiProvider
let harness: ProviderHarness
let tempDir: string

beforeEach(async () => {
  harness = await setupProvider()
  mock = harness.mock
  provider = harness.provider
  tempDir = harness.tempDir
})

afterEach(async () => {
  await teardownProvider(harness)
})

/** The canonical PDF as the location reads see it. */
const FILE_ATTACHMENT = attachment()

describe('getAttachmentLocation', () => {
  it('resolves an imported file through /file/view/url and verifies it on disk', async () => {
    const filePath = join(tempDir, 'paper.pdf')
    writeFileSync(filePath, '%PDF stub')
    serveJson(mock, `${apiPath()}/items/${ATTACHMENT_KEY}`, FILE_ATTACHMENT, versionHeaders())
    // `/file/view/url` answers plain text, so it needs `serveText`, not `serveJson`.
    serveText(
      mock,
      `${apiPath()}/items/${ATTACHMENT_KEY}/file/view/url`,
      pathToFileURL(filePath).href,
    )
    const location = await provider.getAttachmentLocation(parseRef(attachmentRef()))
    expectRequestPaths(mock, [
      '/api/users/0/items/WXYZ6789',
      '/api/users/0/items/WXYZ6789/file/view/url',
    ])
    expect(location).toEqual({
      ref: 'zotero://user/0/attachment/WXYZ6789?server=S1',
      title: 'Full Text PDF',
      contentType: 'application/pdf',
      kind: 'file',
      path: filePath,
    })
  })

  it('fails with FILE_MISSING when the reported file is gone', async () => {
    const missing = pathToFileURL(join(tempDir, 'gone.pdf')).href
    serveJson(mock, `${apiPath()}/items/${ATTACHMENT_KEY}`, FILE_ATTACHMENT)
    serveText(mock, `${apiPath()}/items/${ATTACHMENT_KEY}/file/view/url`, missing)
    const error = await zoteroError(
      provider.getAttachmentLocation(parseRef(attachmentRef())),
      ZOTERO_FILE_MISSING,
      missingAttachmentFileMessage(join(tempDir, 'gone.pdf')),
    )
    expect(error.message).toContain('gone.pdf')
  })

  it('serves linked-URL attachments from data.url without touching /file/view/url', async () => {
    const linked = attachment({
      data: {
        title: 'Preprint',
        linkMode: 'linked_url',
        url: 'https://arxiv.org/pdf/2307.08691',
      },
    })
    serveJson(mock, `${apiPath()}/items/${ATTACHMENT_KEY}`, linked)
    const location = await provider.getAttachmentLocation(parseRef(attachmentRef()))
    expectRequestPaths(mock, ['/api/users/0/items/WXYZ6789'])
    expect(location).toEqual({
      ref: 'zotero://user/0/attachment/WXYZ6789',
      title: 'Preprint',
      contentType: 'application/pdf',
      kind: 'url',
      url: 'https://arxiv.org/pdf/2307.08691',
    })
  })

  it('fails with NO_ATTACHMENT when a linked-URL attachment reports no URL', async () => {
    serveJson(
      mock,
      `${apiPath()}/items/${ATTACHMENT_KEY}`,
      attachment({ data: { title: 'Preprint', linkMode: 'linked_url' } }),
    )
    await zoteroError(
      provider.getAttachmentLocation(parseRef(attachmentRef())),
      ZOTERO_NO_ATTACHMENT,
      missingLinkedUrlMessage(ATTACHMENT_KEY),
    )
  })

  it('fails with NO_ATTACHMENT when the referenced object is not an attachment', async () => {
    serveJson(
      mock,
      `${apiPath()}/items/${ATTACHMENT_KEY}`,
      noteRow({ key: ATTACHMENT_KEY, data: { note: 'not a file' } }),
    )
    const error = await zoteroError(
      provider.getAttachmentLocation(parseRef(attachmentRef())),
      ZOTERO_NO_ATTACHMENT,
      attachmentTypeMessage('note'),
    )
    expect(error.message).toContain('note')
    expectRequestCount(mock, 1)
  })

  it('fails with NO_ATTACHMENT when /file/view/url reports no usable location', async () => {
    serveJson(mock, `${apiPath()}/items/${ATTACHMENT_KEY}`, FILE_ATTACHMENT)
    serveText(mock, `${apiPath()}/items/${ATTACHMENT_KEY}/file/view/url`, 'false')
    await zoteroError(
      provider.getAttachmentLocation(parseRef(attachmentRef())),
      ZOTERO_NO_ATTACHMENT,
      noUsableFileLocationMessage(ATTACHMENT_KEY),
    )
  })

  it('passes non-file URLs through as url locations', async () => {
    serveJson(mock, `${apiPath()}/items/${ATTACHMENT_KEY}`, FILE_ATTACHMENT)
    serveText(
      mock,
      `${apiPath()}/items/${ATTACHMENT_KEY}/file/view/url`,
      'https://example.com/paper.pdf',
    )
    const location = await provider.getAttachmentLocation(parseRef(attachmentRef()))
    expect(location.kind).toBe('url')
    expect((location as { url: string }).url).toBe('https://example.com/paper.pdf')
  })

  it('rejects an ftp: location from /file/view/url', async () => {
    serveJson(mock, `${apiPath()}/items/${ATTACHMENT_KEY}`, FILE_ATTACHMENT)
    serveText(
      mock,
      `${apiPath()}/items/${ATTACHMENT_KEY}/file/view/url`,
      'ftp://files.example.com/paper.pdf',
    )
    await zoteroError(
      provider.getAttachmentLocation(parseRef(attachmentRef())),
      ZOTERO_NO_ATTACHMENT,
      unsupportedAttachmentProtocolMessage('ftp:', ['file:', 'http:', 'https:']),
    )
  })

  it('rejects a javascript: location from /file/view/url', async () => {
    serveJson(mock, `${apiPath()}/items/${ATTACHMENT_KEY}`, FILE_ATTACHMENT)
    serveText(mock, `${apiPath()}/items/${ATTACHMENT_KEY}/file/view/url`, 'javascript:alert(1)')
    await zoteroError(
      provider.getAttachmentLocation(parseRef(attachmentRef())),
      ZOTERO_NO_ATTACHMENT,
      unsupportedAttachmentProtocolMessage('javascript:', ['file:', 'http:', 'https:']),
    )
  })

  it('rejects a relative location from /file/view/url', async () => {
    serveJson(mock, `${apiPath()}/items/${ATTACHMENT_KEY}`, FILE_ATTACHMENT)
    serveText(mock, `${apiPath()}/items/${ATTACHMENT_KEY}/file/view/url`, 'relative/paper.pdf')
    await zoteroError(
      provider.getAttachmentLocation(parseRef(attachmentRef())),
      ZOTERO_NO_ATTACHMENT,
      noUsableFileLocationMessage(ATTACHMENT_KEY),
    )
  })

  it('rejects a linked-URL attachment with a non-http(s) target', async () => {
    serveJson(
      mock,
      `${apiPath()}/items/${ATTACHMENT_KEY}`,
      attachment({
        data: {
          title: 'Preprint',
          linkMode: 'linked_url',
          url: 'javascript:alert(1)',
        },
      }),
    )
    await zoteroError(
      provider.getAttachmentLocation(parseRef(attachmentRef())),
      ZOTERO_NO_ATTACHMENT,
      unsupportedAttachmentProtocolMessage('javascript:', ['http:', 'https:']),
    )
  })

  it('rejects a linked-URL attachment pointing at a file: target', async () => {
    serveJson(
      mock,
      `${apiPath()}/items/${ATTACHMENT_KEY}`,
      attachment({
        data: {
          title: 'Preprint',
          linkMode: 'linked_url',
          url: 'file:///tmp/paper.pdf',
        },
      }),
    )
    await zoteroError(
      provider.getAttachmentLocation(parseRef(attachmentRef())),
      ZOTERO_NO_ATTACHMENT,
      unsupportedAttachmentProtocolMessage('file:', ['http:', 'https:']),
    )
  })

  it('rejects a linked-URL attachment with an unparsable target', async () => {
    serveJson(
      mock,
      `${apiPath()}/items/${ATTACHMENT_KEY}`,
      attachment({
        data: {
          title: 'Preprint',
          linkMode: 'linked_url',
          url: 'not a web url',
        },
      }),
    )
    await zoteroError(
      provider.getAttachmentLocation(parseRef(attachmentRef())),
      ZOTERO_NO_ATTACHMENT,
      notAWebLocationMessage(ATTACHMENT_KEY),
    )
  })

  it('rejects non-zero user refs before any request happens', async () => {
    await zoteroError(
      provider.getAttachmentLocation(parseRef('zotero://user/123/attachment/WXYZ6789')),
      'ZOTERO_INVALID_REF',
      foreignUserRefMessage(parseRef('zotero://user/123/attachment/WXYZ6789')),
    )
    expectRequestCount(mock, 0)
  })
})

describe('getAttachmentLocation via item refs', () => {
  it("resolves an item ref through Zotero's best-attachment link", async () => {
    const filePath = join(tempDir, 'paper.pdf')
    writeFileSync(filePath, '%PDF stub')
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, paperItem(), versionHeaders())
    serveJson(mock, `${apiPath()}/items/${ATTACHMENT_KEY}`, FILE_ATTACHMENT)
    serveText(
      mock,
      `${apiPath()}/items/${ATTACHMENT_KEY}/file/view/url`,
      pathToFileURL(filePath).href,
    )
    const location = await provider.getAttachmentLocation(parseRef(itemRef()))
    expectRequestPaths(mock, [
      '/api/users/0/items/ABCD1234',
      '/api/users/0/items/WXYZ6789',
      '/api/users/0/items/WXYZ6789/file/view/url',
    ])
    expect(location).toEqual({
      ref: 'zotero://user/0/attachment/WXYZ6789?server=S1',
      title: 'Full Text PDF',
      contentType: 'application/pdf',
      kind: 'file',
      path: filePath,
    })
  })

  it('falls back to a PDF child when the item has no attachment link', async () => {
    const filePath = join(tempDir, 'paper.pdf')
    writeFileSync(filePath, '%PDF stub')
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, item({ data: { title: 'T' } }))
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}/children`, [
      noteRow({ data: { note: 'n' } }),
      attachment(),
    ])
    serveJson(mock, `${apiPath()}/items/${ATTACHMENT_KEY}`, FILE_ATTACHMENT)
    serveText(
      mock,
      `${apiPath()}/items/${ATTACHMENT_KEY}/file/view/url`,
      pathToFileURL(filePath).href,
    )
    const location = await provider.getAttachmentLocation(parseRef(itemRef()))
    expectRequestPaths(mock, [
      '/api/users/0/items/ABCD1234',
      '/api/users/0/items/ABCD1234/children',
      '/api/users/0/items/WXYZ6789',
      '/api/users/0/items/WXYZ6789/file/view/url',
    ])
    expect(location.kind).toBe('file')
  })

  it('fails with NO_ATTACHMENT when the item has no attachment', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, item({ data: { title: 'T' } }))
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}/children`, [
      noteRow({ data: { note: 'only a note' } }),
    ])
    await zoteroError(
      provider.getAttachmentLocation(parseRef(itemRef())),
      ZOTERO_NO_ATTACHMENT,
      noAttachmentToResolveMessage(ITEM_KEY),
    )
  })

  it('fails loud with UNEXPECTED on a non-array children fallback', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, item({ data: { title: 'T' } }))
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}/children`, { key: 'NOTE1111' })
    await zoteroError(provider.getAttachmentLocation(parseRef(itemRef())), ZOTERO_UNEXPECTED)
  })
})
