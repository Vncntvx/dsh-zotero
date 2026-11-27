import { Service, type Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ReaderService from '../../src/reader/index.js'
import { setupHostLane, type HostLane } from '../helpers/lanes/host-lane.js'
import { expectRequestPaths } from '../helpers/server/assert.js'
import {
  ANNOTATION_KEY,
  ATTACHMENT_KEY,
  GROUP_LIBRARY,
  PERSONAL_LIBRARY,
  SERVER_ID,
  apiPath,
  refOf,
} from '../helpers/server/keys.js'
import { annotationRow, attachment, versionHeaders } from '../helpers/server/objects.js'
import { serveJson } from '../helpers/server/serve.js'

const allows = vi.fn()
class ReaderAccess extends Service {
  constructor(ctx: Context) {
    super(ctx, 'remoteAccess')
  }
  allows = allows
}

const pageRequest = { sessionId: 'reader-session', offset: 2, limit: 1 }
let host: HostLane

beforeEach(async () => {
  allows.mockReset().mockReturnValue(true)
  host = await setupHostLane(
    { writeEnabled: true },
    { compose: async (ctx) => void (await ctx.plugin(ReaderAccess)) },
  )
  await host.ctx.plugin(ReaderService)
})
afterEach(async () => await host?.teardown())

it.each([
  { library: PERSONAL_LIBRARY, writeEnabled: true },
  { library: GROUP_LIBRARY, writeEnabled: false },
])(
  'serves a page of native annotations in the $library.type library',
  async ({ library, writeEnabled }) => {
    const ref = `${refOf('attachment', ATTACHMENT_KEY, library)}?server=${SERVER_ID}`
    const path = `${apiPath(library)}/items/${ATTACHMENT_KEY}`
    const annotation = annotationRow({
      version: 17,
      data: {
        annotationType: 'underline',
        annotationPageLabel: 'iv',
        annotationPosition: JSON.stringify({ pageIndex: 2, rects: [[10, 20, 30, 35]] }),
      },
    })
    serveJson(host.mock, path, attachment(), versionHeaders())
    serveJson(host.mock, `${path}/children?itemType=annotation&start=2&limit=1`, [annotation], {
      'Total-Results': '4',
    })

    const result = await host.ctx.reader.readerAnnotations(
      { ...pageRequest, ref },
      new AbortController().signal,
    )

    expect(result).toMatchObject({
      writeEnabled,
      offset: 2,
      limit: 1,
      total: 4,
      returned: 1,
      nextOffset: 3,
      items: [
        {
          ref: `${refOf('annotation', ANNOTATION_KEY, library)}?server=${SERVER_ID}`,
          parentRef: ref,
          type: 'underline',
          version: 17,
          pageLabel: 'iv',
          position: { pageIndex: 2, rects: [{ x: 10, y: 20, width: 20, height: 15 }] },
        },
      ],
    })
  },
)

it('refuses annotation reads before Zotero I/O when session access is denied', async () => {
  allows.mockReturnValue(false)
  const ref = `${refOf('attachment', ATTACHMENT_KEY)}?server=${SERVER_ID}`

  await expect(
    host.ctx.reader.readerAnnotations({ ...pageRequest, ref }, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'remote-access/denied' })
  expectRequestPaths(host.mock, [])
})
