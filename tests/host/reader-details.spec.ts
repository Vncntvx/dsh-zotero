import { Service, type Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ReaderService from '../../src/reader/index.js'
import { ZOTERO_INVOCATION_BY_METHOD } from '../../src/wire-schemas.js'
import { setupHostLane, type HostLane } from '../helpers/lanes/host-lane.js'
import { expectRequestLines } from '../helpers/server/assert.js'
import { GROUP_ID, ITEM_KEY, ATTACHMENT_KEY, SERVER_ID, refOf } from '../helpers/server/keys.js'
import { attachment, noteRow, paperItem, versionHeaders } from '../helpers/server/objects.js'
import { serveJson } from '../helpers/server/serve.js'

const allows = vi.fn()
class ReaderAccess extends Service {
  constructor(ctx: Context) {
    super(ctx, 'remoteAccess')
  }
  allows = allows
}

const group = { type: 'group', id: GROUP_ID } as const
const items = `/api/groups/${GROUP_ID}/items`
const ref = `${refOf('attachment', ATTACHMENT_KEY, group)}?server=${SERVER_ID}`
const request = { sessionId: 'reader-session', ref, offset: 2 }
let host: HostLane

beforeEach(async () => {
  allows.mockReset().mockReturnValue(true)
  host = await setupHostLane({}, { compose: async (ctx) => void (await ctx.plugin(ReaderAccess)) })
  await host.ctx.plugin(ReaderService)
})
afterEach(async () => await host?.teardown())

it('loads the group parent and sibling attachments through core with Library absent', async () => {
  const pdf = attachment({ data: { parentItem: ITEM_KEY } })
  const note = noteRow({ data: { parentItem: ITEM_KEY } })
  const parent = paperItem({ data: { abstractNote: 'An abstract from the same group.' } })
  serveJson(host.mock, `${items}/${ATTACHMENT_KEY}`, pdf, versionHeaders())
  serveJson(host.mock, `${items}/${ITEM_KEY}`, parent, versionHeaders())
  host.mock.route('GET', `${items}/${ITEM_KEY}/children`, (_req, _res, helpers, query) => {
    const notes = query.get('itemType') === 'note'
    expect(query.get('start')).toBe(notes ? '0' : '2')
    helpers.json(notes ? [note] : [pdf], {
      'Zotero-Server-ID': SERVER_ID,
      'Total-Results': notes ? '1' : '3',
    })
  })

  expect(host.ctx.get('zoteroLibrary')).toBeUndefined()
  const result = await host.ctx.reader.readerDetails(request, new AbortController().signal)
  expect(result).toMatchObject({
    ref: `${refOf('item', ITEM_KEY, group)}?server=${SERVER_ID}`,
    abstract: parent.data.abstractNote,
    attachments: { offset: 2, total: 3, items: [{ ref }] },
    notes: { offset: 0, items: [{ text: 'my note' }] },
  })
})

it('serves the attachment itself when Zotero reports no item parent', async () => {
  const pdf = attachment()
  serveJson(host.mock, `${items}/${ATTACHMENT_KEY}`, pdf, versionHeaders())

  const result = await host.ctx.reader.readerDetails(request, new AbortController().signal)
  expect(result).toMatchObject({ ref, title: pdf.data.title, itemType: 'attachment' })
  expect(result.attachments).toBeUndefined()
  expectRequestLines(host.mock, [`${items}/${ATTACHMENT_KEY}`])
})

it('requests the selected note page independently of the attachment page', async () => {
  const pdf = attachment({ data: { parentItem: ITEM_KEY } })
  serveJson(host.mock, `${items}/${ATTACHMENT_KEY}`, pdf, versionHeaders())
  serveJson(host.mock, `${items}/${ITEM_KEY}`, paperItem(), versionHeaders())
  host.mock.route('GET', `${items}/${ITEM_KEY}/children`, (_req, _res, helpers, query) => {
    const notes = query.get('itemType') === 'note'
    expect(query.get('start')).toBe(notes ? '4' : '2')
    helpers.json(notes ? [noteRow({ data: { parentItem: ITEM_KEY } })] : [pdf], {
      'Zotero-Server-ID': SERVER_ID,
      'Total-Results': notes ? '7' : '3',
    })
  })

  const codec = ZOTERO_INVOCATION_BY_METHOD.readerDetails.parameters[0]?.codec
  if (!codec || codec.mode !== 'strict' || !codec.create)
    throw new Error('Reader details request must have a strict codec')
  const schema = codec.create()
  expect(() => schema.parse({ ...request, notesOffset: -1 })).toThrow()
  const nextPage = { ...request, notesOffset: 4 }
  expect(schema.parse(nextPage)).toEqual(nextPage)
  const result = await host.ctx.reader.readerDetails(nextPage, new AbortController().signal)
  expect(result).toMatchObject({
    attachments: { offset: 2, total: 3, items: [{ ref }] },
    notes: { offset: 4, nextOffset: 5, total: 7, items: [{ text: 'my note' }] },
  })
})

it('refuses metadata reads when the session is not accessible', async () => {
  allows.mockReturnValue(false)

  await expect(
    host.ctx.reader.readerDetails(request, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'remote-access/denied' })
  expect(host.mock.requests).toHaveLength(0)
})
