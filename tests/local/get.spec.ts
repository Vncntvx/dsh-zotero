/**
 * The `zotero_get` / `zotero_attachment` provider contract: item detail with
 * lazy children and collection names, and attachment resolution to verified
 * on-disk files or linked URLs.
 * @module tests/provider/get
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZOTERO_FILE_MISSING, ZOTERO_NO_ATTACHMENT } from '../../src/errors.js'
import { type LocalApiProvider } from '../../src/local/provider.js'
import {
  attachmentTypeMessage,
  missingAttachmentFileMessage,
  missingLinkedUrlMessage,
  noAttachmentToResolveMessage,
  noUsableFileLocationMessage,
  notAWebLocationMessage,
  unsupportedAttachmentProtocolMessage,
} from '../../src/local/attachment-location.js'
import type { LocalApiLimits } from '../../src/local/limits.js'
import { expectedKindRefMessage, foreignUserRefMessage, parseRef } from '../../src/refs.js'
import {
  createProvider,
  getRequest,
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../helpers/provider-harness.js'
import {
  expectRequestCount,
  expectRequestLines,
  expectRequestPaths,
  requestLines,
  zoteroError,
} from '../helpers/server/assert.js'
import {
  ATTACHMENT_KEY,
  COLLECTION_KEY,
  ITEM_KEY,
  SECOND_ITEM_KEY,
  apiPath,
  attachmentRef,
  itemRef,
} from '../helpers/server/keys.js'
import {
  annotationRow,
  attachment,
  collectionRow,
  item,
  noteRow,
  paperItem,
  versionHeaders,
} from '../helpers/server/objects.js'
import { serveItemGraph, serveJson, serveText } from '../helpers/server/serve.js'

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

function makeProvider(limits: Partial<LocalApiLimits> = {}): LocalApiProvider {
  return createProvider(mock, limits)
}

/** The paper as the detail reads see it: one tag, one collection, two children. */
const PARENT = paperItem({
  meta: { numChildren: 2 },
  data: { tags: [{ tag: 'attention' }], collections: [COLLECTION_KEY] },
})

/** The same paper with no collection membership, for the reads that must skip the listing. */
const PARENT_WITHOUT_COLLECTIONS = paperItem({
  meta: { numChildren: 2 },
  data: { tags: [{ tag: 'attention' }] },
})

/** The canonical PDF as the location reads see it. */
const FILE_ATTACHMENT = attachment()

describe('getItem', () => {
  it('fetches only the parent when nothing is included', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, PARENT_WITHOUT_COLLECTIONS, versionHeaders())
    const detail = await provider.getItem(getRequest())
    expectRequestLines(mock, ['/api/users/0/items/ABCD1234'])
    expect(detail.ref).toBe('zotero://user/0/item/ABCD1234?server=S1')
    expect(detail.children.total).toBe(2)
    expect(detail.notes).toBeUndefined()
    expect(detail.bestAttachment).toEqual({
      ref: 'zotero://user/0/attachment/WXYZ6789?server=S1',
      title: '',
      contentType: 'application/pdf',
    })
  })

  it('fetches children lazily and resolves collection names once', async () => {
    serveItemGraph(mock, {
      parent: PARENT,
      children: [noteRow(), attachment()],
      annotations: [annotationRow()],
      collections: [collectionRow()],
    })
    const detail = await provider.getItem(getRequest(['notes', 'annotations', 'attachments']))
    // Parent first; the two children contracts and the collections listing
    // are independent once the parent has arrived.
    const lines = requestLines(mock)
    expect(lines[0]).toBe('/api/users/0/items/ABCD1234')
    expect(lines.slice(1).sort()).toEqual(
      [
        '/api/users/0/items/ABCD1234/children',
        '/api/users/0/items/ABCD1234/children?itemType=annotation',
        '/api/users/0/collections',
      ].sort(),
    )
    expect(detail.collections).toEqual([
      { ref: 'zotero://user/0/collection/COLL1234?server=S1', name: 'LLM Papers' },
    ])
    expect(detail.notes).toEqual({
      total: 1,
      returned: 1,
      items: [
        { ref: 'zotero://user/0/item/NOTE1111?server=S1', text: 'my note', truncated: false },
      ],
    })
    expect(detail.annotations!.total).toBe(1)
    expect(detail.annotations!.items[0]).toMatchObject({
      ref: 'zotero://user/0/annotation/ANNO1111?server=S1',
      parentRef: 'zotero://user/0/attachment/WXYZ6789?server=S1',
    })
    expect(detail.attachments!.items[0]!.title).toBe('Full Text PDF')
    expect(detail.bestAttachment!.title).toBe('Full Text PDF')
  })

  it('skips the collections listing for items without collections', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, PARENT_WITHOUT_COLLECTIONS)
    await provider.getItem(getRequest())
    expectRequestLines(mock, ['/api/users/0/items/ABCD1234'])
  })

  it('leaves collection names off when the listing lacks them', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, PARENT)
    serveJson(mock, `${apiPath()}/collections`, [
      collectionRow({ key: 'COLL9999', data: { name: 'Other' } }),
    ])
    const detail = await provider.getItem(getRequest())
    expect(detail.collections).toEqual([{ ref: 'zotero://user/0/collection/COLL1234' }])
  })

  it('treats a non-array children response as no children', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, PARENT_WITHOUT_COLLECTIONS)
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}/children`, { key: 'NOTE1111' })
    const detail = await provider.getItem(getRequest(['notes']))
    expect(detail.notes).toEqual({ total: 0, returned: 0, items: [] })
  })

  it('applies the configured note and annotation record caps', async () => {
    const notes = Array.from({ length: 7 }, (_, i) =>
      noteRow({ key: `NOTE${String(i).padStart(4, '0')}`, data: { note: `note ${i}` } }),
    )
    const annotations = Array.from({ length: 3 }, (_, i) =>
      annotationRow({
        key: `ANNO${String(i).padStart(4, '0')}`,
        data: {
          annotationText: `a ${i}`,
          annotationSortIndex: String(i).padStart(5, '0'),
          parentItem: ATTACHMENT_KEY,
        },
      }),
    )
    serveItemGraph(mock, {
      parent: PARENT_WITHOUT_COLLECTIONS,
      children: [...notes, attachment()],
      annotations,
      collections: null,
      attachmentItem: null,
    })
    const capped = makeProvider({ maxNoteRecords: 2, maxAnnotationRecords: 1, maxNoteChars: 5 })
    const detail = await capped.getItem(getRequest(['notes', 'annotations']))
    expect(detail.notes).toMatchObject({ total: 7, returned: 2 })
    expect(detail.notes!.items[0]).toMatchObject({ text: 'note ', truncated: true })
    // The merged annotation corpus is capped as one collection.
    expect(detail.annotations).toMatchObject({ total: 3, returned: 1 })
  })

  it('passes unconsumed data fields through under fields:"all"', async () => {
    serveJson(
      mock,
      `${apiPath()}/items/${ITEM_KEY}`,
      item({
        data: {
          itemType: 'dataset',
          title: 'Attention Is All You Need — replication data',
          repository: 'Zenodo',
          versionNumber: 2,
          archive: 'arXiv',
          libraryCatalog: 'Zotero',
          extra: { nested: ['a', 1, true] },
        },
      }),
    )
    const all = await provider.getItem({
      ref: parseRef(itemRef()),
      include: new Set(),
      fields: 'all',
    })
    // Consumed keys never leak into extraFields; unknown ones survive verbatim.
    expect(all.extraFields).toEqual({
      archive: 'arXiv',
      extra: { nested: ['a', 1, true] },
      libraryCatalog: 'Zotero',
      repository: 'Zenodo',
      versionNumber: 2,
    })
    const standard = await provider.getItem(getRequest())
    expect(standard.extraFields).toBeUndefined()
  })

  it('reuses the cached collections listing across items', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, PARENT)
    serveJson(
      mock,
      `${apiPath()}/items/${SECOND_ITEM_KEY}`,
      paperItem({
        key: SECOND_ITEM_KEY,
        meta: { numChildren: 2 },
        data: {
          key: SECOND_ITEM_KEY,
          tags: [{ tag: 'attention' }],
          collections: [COLLECTION_KEY],
        },
      }),
    )
    serveJson(mock, `${apiPath()}/collections`, [collectionRow()])
    const first = await provider.getItem(getRequest())
    const second = await provider.getItem({
      ref: parseRef(itemRef(SECOND_ITEM_KEY)),
      include: new Set(),
    })
    expect(
      mock.requests.filter((entry) => entry.pathname === '/api/users/0/collections'),
    ).toHaveLength(1)
    expect(first.collections).toEqual([
      { ref: 'zotero://user/0/collection/COLL1234', name: 'LLM Papers' },
    ])
    expect(second.collections).toEqual(first.collections)
  })

  it('rejects non-item refs before any request happens', async () => {
    await zoteroError(
      provider.getItem({
        ref: parseRef(attachmentRef()),
        include: new Set(),
      }),
      'ZOTERO_INVALID_REF',
      expectedKindRefMessage(['item'], 'attachment'),
    )
    expectRequestCount(mock, 0)
  })
})

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

describe('getItem collections edge cases', () => {
  it('treats a non-array collections listing as no names', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, PARENT)
    serveJson(mock, `${apiPath()}/collections`, { key: 'COLL1234' })
    const detail = await provider.getItem(getRequest())
    expect(detail.collections).toEqual([{ ref: 'zotero://user/0/collection/COLL1234' }])
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
      ref: 'zotero://user/0/attachment/WXYZ6789',
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

  it('fails with NO_ATTACHMENT on a non-array children fallback', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, item({ data: { title: 'T' } }))
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}/children`, { key: 'NOTE1111' })
    await zoteroError(provider.getAttachmentLocation(parseRef(itemRef())), ZOTERO_NO_ATTACHMENT)
  })
})
