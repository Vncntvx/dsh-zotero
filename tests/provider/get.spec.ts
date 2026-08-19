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
import { type LocalApiLimits, type LocalApiProvider } from '../../src/provider-local.js'
import { parseRef } from '../../src/refs.js'
import { MockZotero } from '../helpers/mock-zotero.js'
import { CHILD_ROWS } from '../helpers/fixtures.js'
import {
  createProvider,
  getRequest,
  setupProvider,
  teardownProvider,
  zoteroError,
  type ProviderHarness,
} from '../helpers/provider-harness.js'

let mock: MockZotero
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

const PARENT = {
  key: 'ABCD1234',
  version: 3,
  links: {
    self: { href: 'http://localhost:23119/api/users/0/items/ABCD1234', type: 'application/json' },
    attachment: {
      href: 'http://localhost:23119/api/users/0/items/WXYZ6789',
      type: 'application/json',
      attachmentType: 'application/pdf',
    },
  },
  meta: { creatorSummary: 'Dao, Tri', parsedDate: '2023-07-28', numChildren: 3 },
  data: {
    itemType: 'journalArticle',
    title: 'FlashAttention-2',
    date: '2023-07-28',
    creators: [{ creatorType: 'author', firstName: 'Tri', lastName: 'Dao' }],
    publicationTitle: 'ICML',
    tags: [{ tag: 'attention' }],
    collections: ['COLL1234'],
  },
}

describe('getItem', () => {
  it('fetches only the parent when nothing is included', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(
        { ...PARENT, data: { ...PARENT.data, collections: [] } },
        { 'Zotero-Server-ID': 'S1' },
      ),
    )
    const detail = await provider.getItem(getRequest())
    expect(mock.requests.map((entry) => entry.pathname)).toEqual(['/api/users/0/items/ABCD1234'])
    expect(detail.ref).toBe('zotero://user/0/item/ABCD1234?server=S1')
    expect(detail.children.total).toBe(3)
    expect(detail.notes).toBeUndefined()
    expect(detail.bestAttachment).toEqual({
      ref: 'zotero://user/0/attachment/WXYZ6789?server=S1',
      title: '',
      contentType: 'application/pdf',
    })
  })

  it('fetches children lazily and resolves collection names once', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(PARENT, { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json(CHILD_ROWS, { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json([
        { key: 'COLL1234', version: 1, data: { key: 'COLL1234', version: 1, name: 'LLM Papers' } },
      ]),
    )
    const detail = await provider.getItem(getRequest(['notes', 'annotations', 'attachments']))
    expect(mock.requests.map((entry) => entry.pathname)).toEqual([
      '/api/users/0/items/ABCD1234',
      '/api/users/0/items/ABCD1234/children',
      '/api/users/0/collections',
    ])
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
    expect(detail.attachments!.items[0]!.title).toBe('Full Text PDF')
    expect(detail.bestAttachment!.title).toBe('Full Text PDF')
  })

  it('skips the collections listing for items without collections', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json({ ...PARENT, data: { ...PARENT.data, collections: [] } }),
    )
    await provider.getItem(getRequest())
    expect(mock.requests.map((entry) => entry.pathname)).toEqual(['/api/users/0/items/ABCD1234'])
  })

  it('leaves collection names off when the listing lacks them', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) => helpers.json(PARENT))
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json([
        { key: 'COLL9999', version: 1, data: { key: 'COLL9999', version: 1, name: 'Other' } },
      ]),
    )
    const detail = await provider.getItem(getRequest())
    expect(detail.collections).toEqual([{ ref: 'zotero://user/0/collection/COLL1234' }])
  })

  it('treats a non-array children response as no children', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json({ ...PARENT, data: { ...PARENT.data, collections: [] } }),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json({ key: 'NOTE1111' }),
    )
    const detail = await provider.getItem(getRequest(['notes']))
    expect(detail.notes).toEqual({ total: 0, returned: 0, items: [] })
  })

  it('applies the configured note and annotation record caps', async () => {
    const notes = Array.from({ length: 7 }, (_, i) => ({
      key: `NOTE${String(i).padStart(4, '0')}`,
      data: { itemType: 'note', note: `note ${i}` },
    }))
    const annotations = Array.from({ length: 3 }, (_, i) => ({
      key: `ANNO${String(i).padStart(4, '0')}`,
      data: {
        itemType: 'annotation',
        annotationType: 'highlight',
        annotationText: `a ${i}`,
        annotationSortIndex: String(i).padStart(5, '0'),
      },
    }))
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(
        { ...PARENT, data: { ...PARENT.data, collections: [] } },
        { 'Zotero-Server-ID': 'S1' },
      ),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json([...notes, ...annotations], { 'Zotero-Server-ID': 'S1' }),
    )
    const capped = makeProvider({ maxNoteRecords: 2, maxAnnotationRecords: 1, maxNoteChars: 5 })
    const detail = await capped.getItem(getRequest(['notes', 'annotations']))
    expect(detail.notes).toMatchObject({ total: 7, returned: 2 })
    expect(detail.notes!.items[0]).toMatchObject({ text: 'note ', truncated: true })
    expect(detail.annotations).toMatchObject({ total: 3, returned: 1 })
  })

  it('reuses the cached collections listing across items', async () => {
    const listing = [
      { key: 'COLL1234', version: 1, data: { key: 'COLL1234', version: 1, name: 'LLM Papers' } },
    ]
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) => helpers.json(PARENT))
    mock.route('GET', '/api/users/0/items/EFGH5678', (req, res, helpers) =>
      helpers.json({ ...PARENT, key: 'EFGH5678', data: { ...PARENT.data, key: 'EFGH5678' } }),
    )
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) => helpers.json(listing))
    const first = await provider.getItem(getRequest())
    const second = await provider.getItem({
      ref: parseRef('zotero://user/0/item/EFGH5678'),
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
        ref: parseRef('zotero://user/0/attachment/WXYZ6789'),
        include: new Set(),
      }),
      'ZOTERO_INVALID_REF',
      'Expected a item reference',
    )
    expect(mock.requests).toEqual([])
  })
})

describe('getAttachmentLocation', () => {
  const FILE_ATTACHMENT = {
    key: 'WXYZ6789',
    version: 1,
    data: {
      itemType: 'attachment',
      title: 'Full Text PDF',
      contentType: 'application/pdf',
      linkMode: 'imported_file',
    },
  }

  it('resolves an imported file through /file/view/url and verifies it on disk', async () => {
    const filePath = join(tempDir, 'paper.pdf')
    writeFileSync(filePath, '%PDF stub')
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
      helpers.json(FILE_ATTACHMENT, { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/file/view/url', (req, res, helpers) =>
      helpers.text(pathToFileURL(filePath).href),
    )
    const location = await provider.getAttachmentLocation(
      parseRef('zotero://user/0/attachment/WXYZ6789'),
    )
    expect(mock.requests.map((entry) => entry.pathname)).toEqual([
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
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
      helpers.json(FILE_ATTACHMENT),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/file/view/url', (req, res, helpers) =>
      helpers.text(missing),
    )
    const error = await zoteroError(
      provider.getAttachmentLocation(parseRef('zotero://user/0/attachment/WXYZ6789')),
      ZOTERO_FILE_MISSING,
      'missing from disk',
    )
    expect(error.message).toContain('gone.pdf')
  })

  it('serves linked-URL attachments from data.url without touching /file/view/url', async () => {
    const linked = {
      key: 'WXYZ6789',
      version: 1,
      data: {
        itemType: 'attachment',
        title: 'Preprint',
        contentType: 'application/pdf',
        linkMode: 'linked_url',
        url: 'https://arxiv.org/pdf/2307.08691',
      },
    }
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) => helpers.json(linked))
    const location = await provider.getAttachmentLocation(
      parseRef('zotero://user/0/attachment/WXYZ6789'),
    )
    expect(mock.requests.map((entry) => entry.pathname)).toEqual(['/api/users/0/items/WXYZ6789'])
    expect(location).toEqual({
      ref: 'zotero://user/0/attachment/WXYZ6789',
      title: 'Preprint',
      contentType: 'application/pdf',
      kind: 'url',
      url: 'https://arxiv.org/pdf/2307.08691',
    })
  })

  it('fails with NO_ATTACHMENT when a linked-URL attachment reports no URL', async () => {
    const linked = {
      key: 'WXYZ6789',
      version: 1,
      data: { itemType: 'attachment', title: 'Preprint', linkMode: 'linked_url' },
    }
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) => helpers.json(linked))
    await zoteroError(
      provider.getAttachmentLocation(parseRef('zotero://user/0/attachment/WXYZ6789')),
      ZOTERO_NO_ATTACHMENT,
      'reported none',
    )
  })

  it('fails with NO_ATTACHMENT when the referenced object is not an attachment', async () => {
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
      helpers.json({
        key: 'WXYZ6789',
        version: 1,
        data: { itemType: 'note', note: 'not a file' },
      }),
    )
    const error = await zoteroError(
      provider.getAttachmentLocation(parseRef('zotero://user/0/attachment/WXYZ6789')),
      ZOTERO_NO_ATTACHMENT,
      'not an attachment',
    )
    expect(error.message).toContain('note')
    expect(mock.requests).toHaveLength(1)
  })

  it('fails with NO_ATTACHMENT when /file/view/url reports no usable location', async () => {
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
      helpers.json(FILE_ATTACHMENT),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/file/view/url', (req, res, helpers) =>
      helpers.text('false'),
    )
    await zoteroError(
      provider.getAttachmentLocation(parseRef('zotero://user/0/attachment/WXYZ6789')),
      ZOTERO_NO_ATTACHMENT,
      'no usable file location',
    )
  })

  it('passes non-file URLs through as url locations', async () => {
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
      helpers.json(FILE_ATTACHMENT),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/file/view/url', (req, res, helpers) =>
      helpers.text('https://example.com/paper.pdf'),
    )
    const location = await provider.getAttachmentLocation(
      parseRef('zotero://user/0/attachment/WXYZ6789'),
    )
    expect(location.kind).toBe('url')
    expect((location as { url: string }).url).toBe('https://example.com/paper.pdf')
  })

  it('rejects an ftp: location from /file/view/url', async () => {
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
      helpers.json(FILE_ATTACHMENT),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/file/view/url', (req, res, helpers) =>
      helpers.text('ftp://files.example.com/paper.pdf'),
    )
    await zoteroError(
      provider.getAttachmentLocation(parseRef('zotero://user/0/attachment/WXYZ6789')),
      ZOTERO_NO_ATTACHMENT,
      'unsupported protocol',
    )
  })

  it('rejects a javascript: location from /file/view/url', async () => {
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
      helpers.json(FILE_ATTACHMENT),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/file/view/url', (req, res, helpers) =>
      helpers.text('javascript:alert(1)'),
    )
    await zoteroError(
      provider.getAttachmentLocation(parseRef('zotero://user/0/attachment/WXYZ6789')),
      ZOTERO_NO_ATTACHMENT,
      'unsupported protocol',
    )
  })

  it('rejects a relative location from /file/view/url', async () => {
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
      helpers.json(FILE_ATTACHMENT),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/file/view/url', (req, res, helpers) =>
      helpers.text('relative/paper.pdf'),
    )
    await zoteroError(
      provider.getAttachmentLocation(parseRef('zotero://user/0/attachment/WXYZ6789')),
      ZOTERO_NO_ATTACHMENT,
      'no usable file location',
    )
  })

  it('rejects a linked-URL attachment with a non-http(s) target', async () => {
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
      helpers.json({
        key: 'WXYZ6789',
        version: 1,
        data: {
          itemType: 'attachment',
          title: 'Preprint',
          linkMode: 'linked_url',
          url: 'javascript:alert(1)',
        },
      }),
    )
    await zoteroError(
      provider.getAttachmentLocation(parseRef('zotero://user/0/attachment/WXYZ6789')),
      ZOTERO_NO_ATTACHMENT,
      'unsupported protocol',
    )
  })

  it('rejects a linked-URL attachment pointing at a file: target', async () => {
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
      helpers.json({
        key: 'WXYZ6789',
        version: 1,
        data: {
          itemType: 'attachment',
          title: 'Preprint',
          linkMode: 'linked_url',
          url: 'file:///tmp/paper.pdf',
        },
      }),
    )
    await zoteroError(
      provider.getAttachmentLocation(parseRef('zotero://user/0/attachment/WXYZ6789')),
      ZOTERO_NO_ATTACHMENT,
      'unsupported protocol',
    )
  })

  it('rejects a linked-URL attachment with an unparsable target', async () => {
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
      helpers.json({
        key: 'WXYZ6789',
        version: 1,
        data: {
          itemType: 'attachment',
          title: 'Preprint',
          linkMode: 'linked_url',
          url: 'not a web url',
        },
      }),
    )
    await zoteroError(
      provider.getAttachmentLocation(parseRef('zotero://user/0/attachment/WXYZ6789')),
      ZOTERO_NO_ATTACHMENT,
      'not a usable web location',
    )
  })

  it('rejects group refs before any request happens', async () => {
    await zoteroError(
      provider.getAttachmentLocation(parseRef('zotero://group/42/attachment/WXYZ6789')),
      'ZOTERO_INVALID_REF',
      'Group library references are not supported',
    )
    expect(mock.requests).toEqual([])
  })
})

describe('getItem collections edge cases', () => {
  it('treats a non-array collections listing as no names', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) => helpers.json(PARENT))
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json({ key: 'COLL1234' }),
    )
    const detail = await provider.getItem(getRequest())
    expect(detail.collections).toEqual([{ ref: 'zotero://user/0/collection/COLL1234' }])
  })
})
describe('getAttachmentLocation via item refs', () => {
  const FILE_ATTACHMENT = {
    key: 'WXYZ6789',
    version: 1,
    data: {
      itemType: 'attachment',
      title: 'Full Text PDF',
      contentType: 'application/pdf',
      linkMode: 'imported_file',
    },
  }

  it("resolves an item ref through Zotero's best-attachment link", async () => {
    const filePath = join(tempDir, 'paper.pdf')
    writeFileSync(filePath, '%PDF stub')
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(
        {
          key: 'ABCD1234',
          version: 3,
          links: {
            attachment: {
              href: 'http://localhost:23119/api/users/0/items/WXYZ6789',
              type: 'application/json',
              attachmentType: 'application/pdf',
            },
          },
          data: { itemType: 'journalArticle', title: 'FlashAttention-2' },
        },
        { 'Zotero-Server-ID': 'S1' },
      ),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
      helpers.json(FILE_ATTACHMENT),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/file/view/url', (req, res, helpers) =>
      helpers.text(pathToFileURL(filePath).href),
    )
    const location = await provider.getAttachmentLocation(parseRef('zotero://user/0/item/ABCD1234'))
    expect(mock.requests.map((entry) => entry.pathname)).toEqual([
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
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json({
        key: 'ABCD1234',
        version: 3,
        data: { itemType: 'journalArticle', title: 'T' },
      }),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json([
        { key: 'NOTE1111', data: { itemType: 'note', note: 'n' } },
        {
          key: 'WXYZ6789',
          data: {
            itemType: 'attachment',
            title: 'Full Text PDF',
            contentType: 'application/pdf',
            linkMode: 'imported_file',
          },
        },
      ]),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
      helpers.json(FILE_ATTACHMENT),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/file/view/url', (req, res, helpers) =>
      helpers.text(pathToFileURL(filePath).href),
    )
    const location = await provider.getAttachmentLocation(parseRef('zotero://user/0/item/ABCD1234'))
    expect(mock.requests.map((entry) => entry.pathname)).toEqual([
      '/api/users/0/items/ABCD1234',
      '/api/users/0/items/ABCD1234/children',
      '/api/users/0/items/WXYZ6789',
      '/api/users/0/items/WXYZ6789/file/view/url',
    ])
    expect(location.kind).toBe('file')
  })

  it('fails with NO_ATTACHMENT when the item has no attachment', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json({
        key: 'ABCD1234',
        version: 3,
        data: { itemType: 'journalArticle', title: 'T' },
      }),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json([{ key: 'NOTE1111', data: { itemType: 'note', note: 'only a note' } }]),
    )
    await zoteroError(
      provider.getAttachmentLocation(parseRef('zotero://user/0/item/ABCD1234')),
      ZOTERO_NO_ATTACHMENT,
      'no attachment',
    )
  })

  it('fails with NO_ATTACHMENT on a non-array children fallback', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json({
        key: 'ABCD1234',
        version: 3,
        data: { itemType: 'journalArticle', title: 'T' },
      }),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json({ key: 'NOTE1111' }),
    )
    await zoteroError(
      provider.getAttachmentLocation(parseRef('zotero://user/0/item/ABCD1234')),
      ZOTERO_NO_ATTACHMENT,
    )
  })
})
