/** The batch picker snapshots attachment metadata through the real Local API client. */
import { afterEach, expect, it } from 'vitest'
import {
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../helpers/provider-harness.ts'

const library = { type: 'user', id: 0 } as const
const signal = new AbortController().signal
let harness: ProviderHarness | undefined
afterEach(async () => {
  if (harness) await teardownProvider(harness)
  harness = undefined
})

const attachment = (key: string, extra = {}) => ({
  key,
  data: { key, itemType: 'attachment', title: key, contentType: 'application/pdf', ...extra },
})
const parent = {
  key: 'PARENT01',
  meta: { parsedDate: '2021-05-01' },
  data: {
    itemType: 'journalArticle',
    title: 'Reservoir operations in seasonal floods',
    publicationTitle: 'Journal of Hydrology',
    creators: [{ creatorType: 'author', firstName: 'Ada', lastName: 'Li' }],
  },
}

async function catalog(
  versionOf: (start: number) => number | undefined,
  rows = [
    attachment('ATTACH01', { parentItem: 'PARENT01' }),
    attachment('ATTACH02', { contentType: 'text/html' }),
    attachment('ATTACH03'),
  ],
  parentVersion = 42,
  parentRow: unknown = parent,
) {
  const world = (harness = await setupProvider())
  world.mock.route('GET', '/api/users/0/collections', (_req, _res, helpers) => {
    helpers.json([], { 'Zotero-Server-ID': 'batch-db' })
  })
  world.mock.route('GET', '/api/users/0/items', (_req, _res, helpers, query) => {
    const start = Number(query.get('start'))
    if (query.has('itemKey')) {
      helpers.json([parentRow, rows[0]], {
        'Zotero-Server-ID': 'batch-db',
        'Last-Modified-Version': String(parentVersion),
      })
      return
    }
    const version = versionOf(start)
    helpers.json(rows.slice(start, start + 1), {
      'Zotero-Server-ID': 'batch-db',
      'Total-Results': String(rows.length),
      ...(version === undefined ? {} : { 'Last-Modified-Version': String(version) }),
    })
  })
  return world
}

it('offers personal and group libraries from the Local API to the batch picker', async () => {
  const { mock, provider } = (harness = await setupProvider())
  mock.route('GET', '/api/users/0/groups', (_req, _res, helpers) =>
    helpers.json([{ id: 42, data: { name: 'Research group' } }], {
      'Zotero-Server-ID': 'batch-db',
    }),
  )
  await expect(provider.parsePdfLibraries(signal)).resolves.toEqual([
    { library, name: 'My Library' },
    { library: { type: 'group', id: 42 }, name: 'Research group' },
  ])
})

it('joins parent metadata while keeping every PDF bound to its own attachment', async () => {
  const { mock, provider } = await catalog(() => 42)
  expect(await provider.parsePdfCatalog(library, signal)).toEqual([
    {
      ref: 'zotero://user/0/attachment/ATTACH01?server=batch-db',
      title: 'Reservoir operations in seasonal floods',
      authors: 'Ada Li',
      venue: 'Journal of Hydrology',
      year: 2021,
    },
    { ref: 'zotero://user/0/attachment/ATTACH03?server=batch-db', title: 'ATTACH03' },
  ])
  const pages = mock.requests.filter(({ search }) => search.has('itemType'))
  expect(pages.map(({ search }) => search.get('start'))).toEqual(['0', '1', '2'])
  expect(pages.map(({ search }) => search.get('itemType'))).toEqual([
    'attachment',
    'attachment',
    'attachment',
  ])
  expect(
    mock.requests
      .filter(({ search }) => search.has('itemKey'))
      .map(({ search }) => search.get('itemKey')),
  ).toEqual(['PARENT01'])
})

it('keeps sibling PDFs selectable with distinct filenames under one bibliographic title', async () => {
  const { provider, mock } = await catalog(
    () => 42,
    [
      attachment('ATTACH01', { parentItem: 'PARENT01', filename: 'primary.pdf' }),
      attachment('ATTACH02', { parentItem: 'PARENT01', filename: 'supplement.pdf' }),
      attachment('ATTACH03', { parentItem: 'PARENT02', title: 'Standalone fallback' }),
    ],
  )
  expect(await provider.parsePdfCatalog(library, signal)).toMatchObject([
    { title: parent.data.title, fileLabel: 'primary.pdf' },
    { title: parent.data.title, fileLabel: 'supplement.pdf' },
    { title: 'Standalone fallback' },
  ])
  expect(mock.requests.find(({ search }) => search.has('itemKey'))?.search.get('itemKey')).toBe(
    'PARENT01,PARENT02',
  )
})

it('rejects a parent lookup whose library version drifted after scanning attachments', async () => {
  const { provider } = await catalog(() => 42, undefined, 43)
  await expect(provider.parsePdfCatalog(library, signal)).rejects.toThrow('library version changed')
})

it('uses the parent date and creator summary when parsed date and author fields are absent', async () => {
  const { provider } = await catalog(
    () => 42,
    [attachment('ATTACH01', { parentItem: 'PARENT01' })],
    42,
    {
      ...parent,
      meta: { creatorSummary: 'Li et al.' },
      data: { ...parent.data, date: '2018', creators: [] },
    },
  )
  expect(await provider.parsePdfCatalog(library, signal)).toMatchObject([
    { title: parent.data.title, authors: 'Li et al.', year: 2018 },
  ])
})
it('rejects a changed library version without handing a partial listing to the picker', async () => {
  const { provider } = await catalog((start) => 42 + start)
  await expect(provider.parsePdfCatalog(library, signal)).rejects.toThrow('listing changed')
})

it('requires a library version before handing a snapshot to the picker', async () => {
  const { provider } = await catalog(() => undefined)
  await expect(provider.parsePdfCatalog(library, signal)).rejects.toThrow(/library version/)
})

it('skips deleted or unrelated items and falls back to the key for an untitled PDF', async () => {
  const { provider } = await catalog(
    () => 42,
    [
      attachment('ATTACH01', { deleted: true }),
      attachment('ATTACH02', { itemType: 'note' }),
      attachment('ATTACH03', { title: '  ', contentType: ' Application/PDF; charset=binary' }),
    ],
  )
  await expect(provider.parsePdfCatalog(library, signal)).resolves.toEqual([
    { ref: 'zotero://user/0/attachment/ATTACH03?server=batch-db', title: 'ATTACH03' },
  ])
})

it.each([
  { rows: [attachment('invalid')], message: 'without a valid key' },
  { rows: [attachment('ATTACH01'), attachment('ATTACH01')], message: 'changed during paging' },
])('rejects an unsafe PDF snapshot with $message', async ({ rows, message }) => {
  const { provider } = await catalog(() => 42, rows)
  await expect(provider.parsePdfCatalog(library, signal)).rejects.toThrow(message)
})
