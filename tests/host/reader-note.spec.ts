import { Service, type Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  ZOTERO_READER_NOTE_HTML_CHARS,
  ZOTERO_READER_NOTE_TEXT_CHARS,
} from '../../src/constants.js'
import ReaderService from '../../src/reader/index.js'
import { ZOTERO_INVOCATION_BY_METHOD } from '../../src/wire-schemas.js'
import {
  approvalAsks,
  ApprovingQuestions,
  resetApprovalStub,
  setApprovalOutcome,
  StubApproval,
} from '../helpers/approval-stub.js'
import { setupHostLane, type HostLane } from '../helpers/lanes/host-lane.js'
import { apiPath, itemRef, NOTE_KEY, SERVER_ID } from '../helpers/server/keys.js'
import { noteRow, paperItem, versionHeaders } from '../helpers/server/objects.js'
import { serveJson } from '../helpers/server/serve.js'
import {
  batchHeaders,
  grantAuthorize,
  itemJson,
  SERVER_ID as WRITE_SERVER_ID,
  serveItemRead,
} from '../helpers/write-domain-fixtures.js'

const allows = vi.fn()
class ReaderAccess extends Service {
  constructor(ctx: Context) {
    super(ctx, 'remoteAccess')
  }
  allows = allows
}

class ReaderSessions extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sessionController')
  }
  async resolveAgent() {
    return { agent: { status: 'running' } }
  }
}

const path = `${apiPath()}/items/${NOTE_KEY}`
const ref = `${itemRef(NOTE_KEY)}?server=${SERVER_ID}`
const request = { sessionId: 'reader-session', ref }
let host: HostLane

beforeEach(async () => {
  allows.mockReset().mockReturnValue(true)
  resetApprovalStub()
  host = await setupHostLane(
    { writeEnabled: true },
    {
      compose: async (ctx) => {
        await ctx.plugin(ReaderAccess)
        await ctx.plugin(ReaderSessions)
        await ctx.plugin(StubApproval)
        await ctx.plugin(ApprovingQuestions)
      },
    },
  )
  await host.ctx.plugin(ReaderService)
})
afterEach(async () => await host?.teardown())

it('serves the current rich note, unchanged HTML and version, when Library is disabled', async () => {
  const html =
    '<div class="zotero-note znv1"><p><span data-citation="{&quot;x&quot;:1}">Citation</span></p><table><tbody><tr><td>Results</td></tr></tbody></table><img data-attachment-key="EMBED001"></div>'
  serveJson(host.mock, path, noteRow({ version: 18, data: { note: html } }), versionHeaders())

  expect(host.ctx.get('zoteroLibrary')).toBeUndefined()
  const result = await host.ctx.reader.readerNote(request, new AbortController().signal)
  expect(result).toMatchObject({ ref, title: 'Citation', version: 18, html, truncated: false })
  expect(result.text).toContain('Citation')
  expect(result.editableRuns).toEqual([{ offset: html.indexOf('Results'), text: 'Results' }])
})

it('returns a bounded text preview when the HTML exceeds the read bound', async () => {
  const content = 'a'.repeat(ZOTERO_READER_NOTE_HTML_CHARS)
  serveJson(host.mock, path, noteRow({ data: { note: `<p>${content}</p>` } }), versionHeaders())

  const result = await host.ctx.reader.readerNote(request, new AbortController().signal)
  expect(result.html).toBeUndefined()
  expect(result.truncated).toBe(true)
  expect(result.text.length).toBe(ZOTERO_READER_NOTE_TEXT_CHARS)
})

it('rejects item refs that resolve to a non-note', async () => {
  serveJson(host.mock, path, paperItem({ key: NOTE_KEY }), versionHeaders())

  await expect(
    host.ctx.reader.readerNote(request, new AbortController().signal),
  ).rejects.toMatchObject({
    code: 'zotero/invalid-argument',
  })
})

it('refuses the read before Zotero I/O when the session is unavailable', async () => {
  allows.mockReturnValue(false)

  await expect(
    host.ctx.reader.readerNote(request, new AbortController().signal),
  ).rejects.toMatchObject({
    code: 'remote-access/denied',
  })
  expect(host.mock.requests).toHaveLength(0)
})

it('returns declined for a note write when the plan review is denied', async () => {
  setApprovalOutcome('rejected')
  await expect(
    host.ctx.reader.readerWriteNote(
      { ...request, operation: 'create', markdown: 'Private' },
      new AbortController().signal,
    ),
  ).resolves.toMatchObject({ kind: 'declined' })
  expect(host.mock.requests).toHaveLength(0)
})

it('returns committed-unverified when a note patch has no library version receipt', async () => {
  grantAuthorize(host.mock)
  host.mock.route('GET', '/api/', (_req, _res, helpers) =>
    helpers.json({}, { 'Zotero-Server-ID': WRITE_SERVER_ID }),
  )
  serveItemRead(host.mock, {
    key: NOTE_KEY,
    data: { itemType: 'note', note: '<p>Old</p>' },
    version: 18,
  })
  host.mock.route('PATCH', path, (_req, _res, helpers) =>
    helpers.raw(204, { 'Zotero-Server-ID': WRITE_SERVER_ID }, ''),
  )
  await expect(
    host.ctx.reader.readerWriteNote(
      {
        ...request,
        ref: `${itemRef(NOTE_KEY)}?server=${WRITE_SERVER_ID}`,
        operation: 'edit',
        expectedVersion: 18,
        edits: [{ offset: 3, text: 'Old', format: 'strong', formatRange: { start: 0, end: 3 } }],
      },
      new AbortController().signal,
    ),
  ).resolves.toMatchObject({ kind: 'committed-unverified' })
})

it('returns a conflict without PATCHing when the note changes before execution', async () => {
  grantAuthorize(host.mock)
  host.mock.route('GET', '/api/', (_req, _res, helpers) =>
    helpers.json({}, { 'Zotero-Server-ID': WRITE_SERVER_ID }),
  )
  serveItemRead(host.mock, {
    key: NOTE_KEY,
    data: { itemType: 'note', note: '<p>Old</p>' },
    version: 19,
  })
  await expect(
    host.ctx.reader.readerWriteNote(
      {
        ...request,
        ref: `${itemRef(NOTE_KEY)}?server=${WRITE_SERVER_ID}`,
        operation: 'edit',
        expectedVersion: 18,
        edits: [{ offset: 3, text: 'Old', format: 'strong', formatRange: { start: 0, end: 3 } }],
      },
      new AbortController().signal,
    ),
  ).resolves.toMatchObject({ kind: 'failed', code: 'ZOTERO_WRITE_CONFLICT' })
  expect(host.mock.requests.filter(({ method }) => method === 'PATCH')).toHaveLength(0)
})

it('puts a permanent note deletion through both approvals with the displayed version', async () => {
  grantAuthorize(host.mock)
  host.mock.route('GET', '/api/', (_req, _res, helpers) =>
    helpers.json({}, { 'Zotero-Server-ID': WRITE_SERVER_ID }),
  )
  serveItemRead(host.mock, { key: NOTE_KEY, data: { itemType: 'note' }, version: 18 })
  const questions = host.ctx.userQuestions as unknown as ApprovingQuestions
  host.mock.route('DELETE', path, (_req, _res, helpers) => {
    expect(approvalAsks).toHaveLength(1)
    expect(questions.asks).toHaveLength(1)
    helpers.raw(204, batchHeaders(19), '')
  })
  const write = {
    ...request,
    ref: `${itemRef(NOTE_KEY)}?server=${WRITE_SERVER_ID}`,
    operation: 'delete',
    expectedVersion: 18,
  } as const
  await expect(
    host.ctx.reader.readerWriteNote(write, new AbortController().signal),
  ).resolves.toMatchObject({ kind: 'applied' })
  expect(JSON.stringify(questions.asks[0])).toContain('Expected version: 18')
  expect(
    host.mock.requests.find(({ method }) => method === 'DELETE')?.headers[
      'if-unmodified-since-version'
    ],
  ).toBe('18')
})

it('round-trips selected formatting through the Reader codec, approvals, and versioned note patch', async () => {
  grantAuthorize(host.mock)
  host.mock.route('GET', '/api/', (_req, _res, helpers) =>
    helpers.json({}, { 'Zotero-Server-ID': WRITE_SERVER_ID }),
  )
  const before = '<p>Recent 𝒳 result.</p><span data-citation="{}">Citation</span>'
  const after = before.replace('𝒳', '<strong>𝒳</strong>')
  let saved = false
  host.mock.route('GET', path, (_req, _res, helpers) => {
    const version = saved ? 19 : 18
    helpers.json(
      itemJson(NOTE_KEY, version, { itemType: 'note', note: saved ? after : before }),
      batchHeaders(version),
    )
  })
  const questions = host.ctx.userQuestions as unknown as ApprovingQuestions
  host.mock.route('PATCH', path, (_req, _res, helpers) => {
    expect(approvalAsks).toHaveLength(1)
    expect(questions.asks).toHaveLength(1)
    const patch = host.mock.requests.at(-1)
    expect(patch?.headers['if-unmodified-since-version']).toBe('18')
    expect(JSON.parse(patch?.body ?? '{}')).toEqual({ version: 18, note: after })
    saved = true
    helpers.raw(204, batchHeaders(19), '')
  })
  const write = {
    ...request,
    ref: `${itemRef(NOTE_KEY)}?server=${WRITE_SERVER_ID}`,
    operation: 'edit',
    expectedVersion: 18,
    edits: [
      { offset: 3, text: 'Recent 𝒳 result.', format: 'strong', formatRange: { start: 7, end: 9 } },
    ],
  } as const
  const codec = ZOTERO_INVOCATION_BY_METHOD.readerWriteNote.parameters[0]?.codec
  if (!codec || codec.mode !== 'strict' || !codec.create)
    throw new Error('Reader note write must have a strict codec')
  const schema = codec.create()
  const combinedFormatting = {
    ...write,
    edits: [
      {
        offset: 3,
        text: 'Recent 𝒳 result.',
        formatting: [
          { format: 'strong', range: { start: 7, end: 9 } },
          { format: 'u', range: { start: 7, end: 9 } },
        ],
      },
    ],
  }
  expect(schema.parse(combinedFormatting)).toEqual(combinedFormatting)
  expect(() =>
    schema.parse({
      ...combinedFormatting,
      edits: [{ ...combinedFormatting.edits[0]!, format: 'strong' }],
    }),
  ).toThrow()
  expect(() =>
    schema.parse({
      ...write,
      edits: [{ ...write.edits[0], formatRange: { start: 7, end: 30 } }],
    }),
  ).toThrow()
  expect(schema.parse(write)).toEqual(write)
  await expect(
    host.ctx.reader.readerWriteNote(write, new AbortController().signal),
  ).resolves.toMatchObject({ kind: 'applied' })
  expect(saved).toBe(true)
  expect(JSON.stringify(questions.asks[0])).toContain('strong[7, 9): 𝒳')
})

it('rejects write access before asking for an approval or sending any Zotero request', async () => {
  allows.mockReturnValue(false)
  await expect(
    host.ctx.reader.readerWriteNote(
      { ...request, operation: 'create', markdown: 'Private' },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: 'remote-access/denied' })
  expect(approvalAsks).toHaveLength(0)
  expect(host.mock.requests).toHaveLength(0)
})
