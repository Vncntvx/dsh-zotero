import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { updateItem } from '../../../src/local/write-domain.js'
import { createAnnotations, deleteAnnotation } from '../../../src/local/write-annotations.js'
import { parseRef } from '../../../src/refs.js'
import type { ZoteroCreateAnnotationsRequest } from '../../../src/types.js'
import type { MockZotero } from '../../helpers/mock-zotero.js'
import {
  batchHeaders,
  grantAuthorize,
  ITEM_KEY,
  ITEM_REF,
  SERVER_ID,
  serveItemRead,
  startWriteDomainMock,
  writeDeps,
} from '../../helpers/write-domain-fixtures.js'

const ref = `zotero://user/0/annotation/${ITEM_KEY}?server=${SERVER_ID}`
const item = parseRef(ref)
const annotation = {
  itemType: 'annotation',
  annotationType: 'highlight',
  annotationComment: 'Replace me',
}
let mock: MockZotero

beforeEach(async () => {
  mock = await startWriteDomainMock()
})

afterEach(async () => {
  await mock.close()
})

describe('versioned native annotation edits', () => {
  it('patches only changed fields with the observed version and preserves the annotation ref', async () => {
    grantAuthorize(mock)
    serveItemRead(mock, { data: annotation, version: 10 })
    mock.route('PATCH', `/api/users/0/items/${ITEM_KEY}`, (_req, _res, helpers) =>
      helpers.raw(204, batchHeaders(21), ''),
    )
    const { deps } = writeDeps(mock)

    const outcome = await updateItem(deps, {
      item,
      expectedVersion: 10,
      set: { annotationComment: '', annotationType: 'underline', annotationColor: '#0066CC' },
    })

    expect(outcome).toMatchObject({
      kind: 'applied',
      ref,
      version: 21,
      changed: ['annotationColor', 'annotationComment', 'annotationType'],
    })
    const writes = mock.requests.filter((entry) => entry.method === 'PATCH')
    expect(writes).toHaveLength(1)
    expect(writes[0]?.headers['if-unmodified-since-version']).toBe('10')
    expect(JSON.parse(writes[0]?.body ?? '{}')).toEqual({
      version: 10,
      annotationComment: '',
      annotationType: 'underline',
      annotationColor: '#0066cc',
    })
    expect(mock.requests.some((entry) => entry.pathname === '/api/itemTypeFields')).toBe(false)
  })

  it.each([
    {
      itemType: 'annotation',
      annotationType: 'highlight',
      deleted: true,
      code: 'ZOTERO_NOT_FOUND',
    },
    { itemType: 'annotation', annotationType: 'image', code: 'ZOTERO_INVALID_ARGUMENT' },
    { itemType: 'journalArticle', code: 'ZOTERO_INVALID_ARGUMENT' },
  ])(
    'refuses an ineligible saved target before authorization ($code)',
    async ({ code, ...data }) => {
      serveItemRead(mock, { data, version: 10 })
      const { deps } = writeDeps(mock)

      await expect(
        updateItem(deps, { item, expectedVersion: 10, set: { annotationComment: '' } }),
      ).rejects.toMatchObject({ code })
      expect(mock.requests.every((entry) => entry.method === 'GET')).toBe(true)
    },
  )

  it('refuses a reader version that differs from the current version before obtaining a key', async () => {
    serveItemRead(mock, { data: annotation, version: 11 })
    const { deps } = writeDeps(mock)

    await expect(
      updateItem(deps, { item, expectedVersion: 10, set: { annotationComment: 'old draft' } }),
    ).rejects.toMatchObject({ code: 'ZOTERO_WRITE_CONFLICT' })
    expect(mock.requests.every((entry) => entry.method === 'GET')).toBe(true)
  })

  it('adds and removes annotation tags in the same versioned patch as scalar edits', async () => {
    grantAuthorize(mock)
    serveItemRead(mock, {
      version: 10,
      data: { ...annotation, tags: [{ tag: 'Automatic', type: 1 }, { tag: 'Old' }] },
    })
    mock.route('PATCH', `/api/users/0/items/${ITEM_KEY}`, (_req, _res, helpers) =>
      helpers.raw(204, batchHeaders(21), ''),
    )
    const { deps } = writeDeps(mock)

    await expect(
      updateItem(deps, {
        item,
        expectedVersion: 10,
        set: { annotationComment: 'Context' },
        tagChanges: { add: [' Research '], remove: ['Old'] },
      }),
    ).resolves.toMatchObject({ kind: 'applied', changed: ['annotationComment', 'tags'] })

    const writes = mock.requests.filter(({ method }) => method === 'PATCH')
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0]?.body ?? '{}')).toEqual({
      version: 10,
      annotationComment: 'Context',
      tags: [{ tag: 'Automatic', type: 1 }, { tag: 'Research' }],
    })
  })

  it('rejects missing version, wrong fields, and malformed annotation colors before network I/O', async () => {
    const { deps } = writeDeps(mock)
    for (const request of [
      { item, set: { annotationComment: '' } },
      { item, expectedVersion: 10, set: { title: 'Title' } },
      { item, expectedVersion: 10, set: { annotationColor: '#FF' } },
      { item: ITEM_REF, set: { annotationComment: 'text' } },
    ]) {
      await expect(updateItem(deps, request)).rejects.toMatchObject({
        code: 'ZOTERO_INVALID_ARGUMENT',
      })
    }
    expect(mock.requests).toHaveLength(0)
  })
})

const selectedPage = {
  pageIndex: 0,
  text: 'Selected words',
  pageLabel: 'iv',
  textOffset: 14,
  top: 30,
  rects: [{ x: 20, y: 40, width: 75, height: 12 }],
}
const selection: ZoteroCreateAnnotationsRequest = {
  attachment: parseRef(`zotero://user/0/attachment/${ITEM_KEY}?server=${SERVER_ID}`),
  type: 'highlight',
  color: '#FFD400',
  comment: ' read next ',
  pages: [
    selectedPage,
    { ...selectedPage, pageIndex: 1, pageLabel: '', text: 'More selected words' },
  ],
}

describe('native PDF annotation creation', () => {
  it('sends one native entry per page and retains the batch verdict for each index', async () => {
    grantAuthorize(mock)
    serveItemRead(mock, {
      data: { itemType: 'attachment', contentType: 'application/pdf', linkMode: 'imported_file' },
    })
    mock.route('POST', '/api/users/0/items', (_req, _res, helpers) => {
      const submitted: Record<string, unknown>[] = JSON.parse(mock.requests.at(-1)?.body ?? '[]')
      helpers.json(
        {
          successful: {
            '0': {
              key: 'ANNO0001',
              version: 21,
              data: { ...submitted[0], key: 'ANNO0001', version: 21 },
            },
          },
          success: { '0': 'ANNO0001' },
          failed: { '1': { key: '', code: 400, message: 'Page refused' } },
          unchanged: {},
        },
        batchHeaders(21),
      )
    })
    const { deps } = writeDeps(mock)
    const result = await createAnnotations(deps, selection)
    expect(result.created).toEqual([
      {
        index: 0,
        key: 'ANNO0001',
        ref: `zotero://user/0/annotation/ANNO0001?server=${SERVER_ID}`,
        version: 21,
        itemType: 'annotation',
      },
    ])
    expect(result.failed).toEqual([
      expect.objectContaining({ op: 'create', index: 1, code: 'ZOTERO_INVALID_ARGUMENT' }),
    ])
    expect(result.unverified).toEqual([])
    const writes = mock.requests.filter(
      ({ method, pathname }) => method === 'POST' && pathname === '/api/users/0/items',
    )
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0]?.body ?? '[]')).toEqual([
      {
        itemType: 'annotation',
        parentItem: ITEM_KEY,
        annotationType: 'highlight',
        annotationText: 'Selected words',
        annotationColor: '#ffd400',
        annotationComment: 'read next',
        annotationPageLabel: 'iv',
        annotationSortIndex: '00000|000014|00030',
        annotationPosition: '{"pageIndex":0,"rects":[[20,40,95,52]]}',
      },
      {
        itemType: 'annotation',
        parentItem: ITEM_KEY,
        annotationType: 'highlight',
        annotationText: 'More selected words',
        annotationColor: '#ffd400',
        annotationComment: 'read next',
        annotationPageLabel: '2',
        annotationSortIndex: '00001|000014|00030',
        annotationPosition: '{"pageIndex":1,"rects":[[20,40,95,52]]}',
      },
    ])
  })

  it('leaves every page unverified after an ambiguous POST and sends it once', async () => {
    grantAuthorize(mock)
    serveItemRead(mock, { data: { itemType: 'attachment', contentType: 'application/pdf' } })
    mock.route('POST', '/api/users/0/items', (_req, _res, helpers) =>
      helpers.raw(500, batchHeaders(21), 'Unexpected error'),
    )
    const { deps } = writeDeps(mock)
    const result = await createAnnotations(deps, selection)
    expect(result.created).toEqual([])
    expect(result.failed).toEqual([])
    expect(result.unverified).toEqual(
      [0, 1].map((index) =>
        expect.objectContaining({ index, retryable: false, reason: 'commit-unknown' }),
      ),
    )
    expect(
      mock.requests.filter(
        ({ method, pathname }) => method === 'POST' && pathname === '/api/users/0/items',
      ),
    ).toHaveLength(1)
  })

  it.each([
    { problem: 'no pages', pages: [] },
    { problem: 'duplicate pages', pages: [selectedPage, selectedPage] },
    { problem: 'out-of-range text offset', pages: [{ ...selectedPage, textOffset: 1_000_000 }] },
    { problem: 'blank selection', pages: [{ ...selectedPage, text: ' ' }] },
    {
      problem: 'inverted rectangle',
      pages: [{ ...selectedPage, rects: [{ x: 0, y: 1, width: -1, height: 8 }] }],
    },
  ])('rejects $problem before contacting Zotero', async ({ pages }) => {
    const { deps } = writeDeps(mock)
    await expect(createAnnotations(deps, { ...selection, pages })).rejects.toMatchObject({
      code: 'INVALID_ARGS',
    })
    expect(mock.requests).toHaveLength(0)
  })
})

describe('versioned native PDF annotation deletion', () => {
  it('permanently deletes the displayed version from the pinned instance', async () => {
    grantAuthorize(mock)
    serveItemRead(mock, { data: annotation, version: 10 })
    mock.route('DELETE', `/api/users/0/items/${ITEM_KEY}`, (_req, _res, helpers) =>
      helpers.raw(204, batchHeaders(21), ''),
    )
    const { deps } = writeDeps(mock)

    await expect(
      deleteAnnotation(deps, { annotation: item, expectedVersion: 10 }),
    ).resolves.toEqual({
      kind: 'deleted',
      ref,
      libraryVersion: 21,
    })
    const writes = mock.requests.filter(({ method }) => method === 'DELETE')
    expect(writes).toHaveLength(1)
    expect(writes[0]?.headers['if-unmodified-since-version']).toBe('10')
  })

  it('rejects a stale annotation before obtaining a write key', async () => {
    serveItemRead(mock, { data: annotation, version: 11 })
    const { deps } = writeDeps(mock)

    await expect(
      deleteAnnotation(deps, { annotation: item, expectedVersion: 10 }),
    ).rejects.toMatchObject({
      code: 'ZOTERO_WRITE_CONFLICT',
    })
    expect(mock.requests.every(({ method }) => method === 'GET')).toBe(true)
  })

  it('returns an unverified receipt and never repeats an ambiguous DELETE', async () => {
    grantAuthorize(mock)
    serveItemRead(mock, { data: annotation, version: 10 })
    mock.route('DELETE', `/api/users/0/items/${ITEM_KEY}`, (_req, _res, helpers) =>
      helpers.raw(500, batchHeaders(21), 'Unexpected error'),
    )
    const { deps } = writeDeps(mock)

    await expect(
      deleteAnnotation(deps, { annotation: item, expectedVersion: 10 }),
    ).resolves.toMatchObject({
      kind: 'committed-unverified',
      ref,
      retryable: false,
    })
    expect(mock.requests.filter(({ method }) => method === 'DELETE')).toHaveLength(1)
  })
})
