/** Full-document read boundaries are enforced by the domain without the model tool wrapper. */
import { afterEach, beforeEach, expect, it } from 'vitest'
import { MockZotero } from '../../helpers/mock-zotero.ts'
import { createProvider } from '../../helpers/provider-harness.ts'
import { serveFulltext, serveJson } from '../../helpers/server/serve.ts'
import { annotationRow, attachment, item } from '../../helpers/server/objects.ts'
import {
  attachmentRef,
  itemRef,
  ATTACHMENT_KEY,
  apiPath,
  refOf,
} from '../../helpers/server/keys.ts'
let mock: MockZotero
beforeEach(async () => {
  mock = await MockZotero.start()
})
afterEach(async () => {
  await mock.close()
})

it.each([
  { start: -1, maxChars: 6 },
  { start: 1.5, maxChars: 6 },
  { start: 0, maxChars: 0 },
])('rejects invalid window $start/$maxChars before source I/O', async (bounds) => {
  await expect(
    createProvider(mock).retrieve({
      mode: 'fulltext',
      source: { kind: 'ref', ref: attachmentRef() },
      ...bounds,
    }),
  ).rejects.toMatchObject({ code: 'ZOTERO_INVALID_ARGUMENT' })
  expect(mock.requests).toHaveLength(0)
})

it('refuses an item ref where an attachment ref is required', async () => {
  await expect(
    createProvider(mock).retrieve({
      mode: 'fulltext',
      source: { kind: 'ref', ref: itemRef() },
      start: 0,
      maxChars: 6,
    }),
  ).rejects.toMatchObject({ code: 'ZOTERO_INVALID_REF' })
  expect(mock.requests).toHaveLength(0)
})

it('reports an absent index as ZOTERO_NO_FULLTEXT', async () => {
  serveJson(mock, `${apiPath()}/items/${ATTACHMENT_KEY}`, attachment())
  await expect(
    createProvider(mock).retrieve({
      mode: 'fulltext',
      source: { kind: 'ref', ref: attachmentRef() },
      start: 0,
      maxChars: 6,
    }),
  ).rejects.toMatchObject({ code: 'ZOTERO_NO_FULLTEXT' })
})

it.each([
  { row: annotationRow({ key: ATTACHMENT_KEY }), message: 'Read from the owning attachment ref' },
  { row: item({ key: ATTACHMENT_KEY }), message: 'journalArticle, not an attachment' },
  { row: { key: ATTACHMENT_KEY, data: {} }, message: 'could not be confirmed as an attachment' },
])(
  'reports the actual attachment target type before requesting its fulltext',
  async ({ row, message }) => {
    serveJson(mock, `${apiPath()}/items/${ATTACHMENT_KEY}`, row)
    await expect(
      createProvider(mock).retrieve({
        mode: 'fulltext',
        source: { kind: 'ref', ref: attachmentRef() },
        start: 0,
        maxChars: 6,
      }),
    ).rejects.toMatchObject({
      code: 'ZOTERO_INVALID_ARGUMENT',
      message: expect.stringContaining(message),
    })
    expect(mock.requests).toHaveLength(1)
  },
)

it('rejects a continuation moved to a different index source with identical bytes', async () => {
  const otherKey = 'PDF00099'
  const provider = createProvider(mock)
  for (const key of [ATTACHMENT_KEY, otherKey]) {
    serveJson(mock, `${apiPath()}/items/${key}`, attachment({ key, data: { parentItem: false } }))
    serveFulltext(mock, key, { content: 'same document', indexedChars: 13, totalChars: 13 })
  }
  const first = await provider.retrieve({
    mode: 'fulltext',
    source: { kind: 'ref', ref: attachmentRef() },
    start: 0,
    maxChars: 6,
  })
  await expect(
    provider.retrieve({
      mode: 'fulltext',
      source: { kind: 'ref', ref: attachmentRef(otherKey) },
      start: first.fulltext!.nextStart!,
      maxChars: 6,
      continuation: first.fulltext!.continuation!,
    }),
  ).rejects.toMatchObject({ code: 'ZOTERO_SOURCE_PAGE_STALE' })
})

it('returns the exact empty document boundary and refuses a start beyond it', async () => {
  serveFulltext(mock, ATTACHMENT_KEY, { content: '', indexedChars: 0, totalChars: 0 })
  serveJson(mock, `${apiPath()}/items/${ATTACHMENT_KEY}`, attachment())
  const request = {
    mode: 'fulltext' as const,
    source: { kind: 'ref' as const, ref: attachmentRef() },
    start: 0,
    maxChars: 6,
  }
  const result = await createProvider(mock).retrieve(request)
  expect(result.fulltext).toMatchObject({
    text: '',
    start: 0,
    end: 0,
    totalChars: 0,
    isTruncated: false,
  })
  expect(result.fulltext).not.toHaveProperty('nextStart')
  await expect(createProvider(mock).retrieve({ ...request, start: 1 })).rejects.toMatchObject({
    code: 'ZOTERO_INVALID_ARGUMENT',
  })
})

it('reads a supported group attachment instead of imposing a fictitious personal-library restriction', async () => {
  const library = { type: 'group' as const, id: 42 }
  serveFulltext(
    mock,
    ATTACHMENT_KEY,
    { content: 'group fulltext', indexedChars: 14, totalChars: 14 },
    library,
  )
  serveJson(mock, `${apiPath(library)}/items/${ATTACHMENT_KEY}`, attachment())
  const result = await createProvider(mock).retrieve({
    mode: 'fulltext',
    source: { kind: 'ref', ref: refOf('attachment', ATTACHMENT_KEY, library) },
    start: 0,
    maxChars: 6,
  })
  expect(result.fulltext).toMatchObject({
    text: 'group ',
    attachmentRef: refOf('attachment', ATTACHMENT_KEY, library),
  })
  expect(mock.requests.every((request) => request.pathname.startsWith('/api/groups/42/'))).toBe(
    true,
  )
})
