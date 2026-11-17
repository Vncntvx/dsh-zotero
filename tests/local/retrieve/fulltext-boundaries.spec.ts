/** Full-document read boundaries are enforced by the domain without the model tool wrapper. */
import { afterEach, beforeEach, expect, it } from 'vitest'
import { MockZotero } from '../../helpers/mock-zotero.ts'
import { createProvider } from '../../helpers/provider-harness.ts'
import { serveFulltext, serveJson } from '../../helpers/server/serve.ts'
import { attachment } from '../../helpers/server/objects.ts'
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
  await expect(
    createProvider(mock).retrieve({
      mode: 'fulltext',
      source: { kind: 'ref', ref: attachmentRef() },
      start: 0,
      maxChars: 6,
    }),
  ).rejects.toMatchObject({ code: 'ZOTERO_NO_FULLTEXT' })
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
