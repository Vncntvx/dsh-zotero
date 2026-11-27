import { afterEach, beforeEach, expect, it } from 'vitest'
import { applyNoteTextEdits, noteTextRuns } from '../../../src/local/note-text-edits.js'
import { ZOTERO_READER_NOTE_HTML_CHARS } from '../../../src/constants.js'
import { modifyNote } from '../../../src/local/write-notes.js'
import type { MockZotero } from '../../helpers/mock-zotero.js'
import {
  batchHeaders,
  grantAuthorize,
  ITEM_KEY,
  ITEM_REF,
  itemJson,
  serveItemRead,
  startWriteDomainMock,
  writeDeps,
} from '../../helpers/write-domain-fixtures.js'

const path = `/api/users/0/items/${ITEM_KEY}`
const html =
  '<div class="zotero-note znv1"><p>Lead &amp; methods <strong>Result</strong> <a href="zotero://open-pdf/library/items/ABCD1234?page=1">Annotation link</a> <span class="citation" data-citation="{}">Citation</span></p><table><tr><td>Cell</td></tr></table><img data-attachment-key="EMBED001"></div>'
const edited = html.replace('Lead &amp; methods ', 'New &lt;script&gt;example&lt;/script&gt; ')
const edit = {
  operation: 'edit',
  item: ITEM_REF,
  expectedVersion: 10,
  edits: [{ offset: html.indexOf('Lead'), text: 'New <script>example</script> ' }],
} as const
let mock: MockZotero

beforeEach(async () => {
  mock = await startWriteDomainMock()
})
afterEach(async () => await mock.close())

it('identifies ordinary note text and leaves citations, annotation links, and raw content out', () => {
  expect(
    noteTextRuns(`${html}<script>ignored</script><p>A</nonsense>B</p>`).map(({ text }) => text),
  ).toEqual(['Lead & methods ', 'Result', 'Cell'])
})

it('edits normal text inside a Zotero editor metadata container while preserving its citation and annotation metadata', () => {
  const native =
    '<div data-schema-version="10" data-citation-items="%5B%5D"><p>Own interpretation</p><p><span class="highlight" data-annotation="%7B%7D">Quoted source</span><span data-citation="%7B%7D">(Sample 2026)</span></p><div data-schema-version="10"><p>Protected nested content</p></div></div>'
  const offset = native.indexOf('Own interpretation')
  expect(noteTextRuns(native)).toEqual([{ offset, end: offset + 18, text: 'Own interpretation' }])
  expect(applyNoteTextEdits(native, [{ offset, text: 'Revised interpretation' }])).toBe(
    native.replace('Own interpretation', 'Revised interpretation'),
  )
})

it('bounds editable note runs without cutting the authoritative HTML', () => {
  expect(noteTextRuns(`<p>${'a'.repeat(ZOTERO_READER_NOTE_HTML_CHARS)}</p>`)).toEqual([])
  expect(noteTextRuns('<p>Text</p>'.repeat(65))).toHaveLength(64)
  expect(noteTextRuns(`${'<div>'.repeat(33)}<p>Deep</p>${'</div>'.repeat(33)}`)).toEqual([])
  expect(() => applyNoteTextEdits(html, [])).toThrow('Select at least one editable note text run.')
  const boundedHtml = `<p>Text</p><!--${'a'.repeat(ZOTERO_READER_NOTE_HTML_CHARS - 18)}-->`
  expect(() => applyNoteTextEdits(boundedHtml, [{ offset: 3, text: 'Longer text' }])).toThrow(
    'The edited note exceeds the Reader limit.',
  )
})

it('applies separated edits to the original offsets even when the form sends them out of order', () => {
  const edits = [
    { offset: html.indexOf('Cell'), text: 'New table cell' },
    { offset: html.indexOf('Result'), text: 'OK' },
  ]
  expect(applyNoteTextEdits(html, edits)).toBe(
    html.replace('Result', 'OK').replace('Cell', 'New table cell'),
  )
  expect(() => applyNoteTextEdits(html, [edits[0]!, edits[0]!])).toThrow('duplicate text run')
})

it('adds only allowlisted formatting around the run and preserves its original entity spelling', () => {
  const offset = html.indexOf('Lead')
  const text = 'Lead & methods '
  expect(applyNoteTextEdits(html, [{ offset, text, format: 'em' }])).toBe(
    html.replace('Lead &amp; methods ', '<em>Lead &amp; methods </em>'),
  )
  expect(() => applyNoteTextEdits(html, [{ offset, text, format: 'img' as never }])).toThrow(
    'unsupported formatting',
  )
})

it.each(['u', 's', 'mark', 'sub', 'sup'] as const)(
  'applies the allowlisted %s formatting tag to note text',
  (format) => {
    const offset = html.indexOf('Lead')
    const text = 'Lead & methods '
    expect(applyNoteTextEdits(html, [{ offset, text, format }])).toBe(
      html.replace('Lead &amp; methods ', `<${format}>Lead &amp; methods </${format}>`),
    )
  },
)

it('formats a selected UTF-16 span without changing surrounding Zotero markup', () => {
  const offset = html.indexOf('Lead')
  const text = 'Lead & 𝒳 <methods> '
  const range = { start: 7, end: 9 }
  expect(applyNoteTextEdits(html, [{ offset, text, format: 'strong', formatRange: range }])).toBe(
    html.replace('Lead &amp; methods ', 'Lead &amp; <strong>𝒳</strong> &lt;methods&gt; '),
  )
  for (const formatRange of [
    { start: 8, end: 9 },
    { start: 7, end: 8 },
    { start: 9, end: 7 },
    { start: -1, end: 9 },
    { start: 0, end: text.length + 1 },
  ]) {
    expect(() => applyNoteTextEdits(html, [{ offset, text, format: 'em', formatRange }])).toThrow(
      'must select whole characters',
    )
  }
  expect(() => applyNoteTextEdits(html, [{ offset, text, formatRange: range }])).toThrow(
    'requires a format',
  )
})

it('combines overlapping inline formats while keeping all surrounding note markup intact', () => {
  const offset = html.indexOf('Lead')
  const text = 'Lead & methods '
  expect(
    applyNoteTextEdits(html, [
      {
        offset,
        text,
        formatting: [
          { format: 'strong', range: { start: 0, end: 4 } },
          { format: 'u', range: { start: 2, end: 7 } },
        ],
      },
    ]),
  ).toBe(
    html.replace(
      'Lead &amp; methods ',
      '<strong>Le</strong><u><strong>ad</strong></u><u> &amp; </u>methods ',
    ),
  )
  expect(() =>
    applyNoteTextEdits(html, [
      {
        offset,
        text,
        format: 'strong',
        formatting: [{ format: 'u' }],
      } as never,
    ]),
  ).toThrow('one supported formatting representation')
})

it('keeps the native entity spelling when the submitted text equals the saved text', async () => {
  serveItemRead(mock, { version: 10, data: { itemType: 'note', note: html } })
  const { deps } = writeDeps(mock)
  await expect(
    modifyNote(deps, {
      ...edit,
      edits: [{ offset: html.indexOf('Lead'), text: 'Lead & methods ' }],
    }),
  ).resolves.toMatchObject({ kind: 'applied', version: 10 })
  expect(mock.requests.every(({ method }) => method === 'GET')).toBe(true)
})

it.each([
  { data: { itemType: 'note', deleted: 1 }, code: 'ZOTERO_NOT_FOUND' },
  { data: { itemType: 'note' }, code: 'ZOTERO_INVALID_ARGUMENT' },
  { data: { itemType: 'journalArticle' }, code: 'ZOTERO_INVALID_ARGUMENT' },
])(
  'refuses an edit when the current item is unavailable or ineligible ($data)',
  async ({ data, code }) => {
    serveItemRead(mock, { version: 10, data })
    await expect(modifyNote(writeDeps(mock).deps, edit)).rejects.toMatchObject({ code })
    expect(mock.requests.every(({ method }) => method === 'GET')).toBe(true)
  },
)

it('returns a reconciliation receipt for a PATCH with an ambiguous acknowledgement', async () => {
  grantAuthorize(mock)
  serveItemRead(mock, { data: { itemType: 'note', note: html }, version: 10 })
  const { 'Last-Modified-Version': _version, ...headers } = batchHeaders(11)
  mock.route('PATCH', path, (_req, _res, helpers) => helpers.raw(204, headers, ''))
  await expect(modifyNote(writeDeps(mock).deps, edit)).resolves.toMatchObject({
    kind: 'committed-unverified',
    retryable: false,
    key: ITEM_KEY,
  })
  expect(mock.requests.filter(({ method }) => method === 'PATCH')).toHaveLength(1)
})

it('sends and verifies a versioned note patch that preserves native markup and escapes the edited text', async () => {
  grantAuthorize(mock)
  let saved = { version: 10, note: html }
  mock.route('GET', path, (_req, _res, helpers) =>
    helpers.json(
      itemJson(ITEM_KEY, saved.version, { itemType: 'note', note: saved.note }),
      batchHeaders(saved.version),
    ),
  )
  mock.route('PATCH', path, (_req, _res, helpers) => {
    saved = { version: 11, note: JSON.parse(mock.requests.at(-1)?.body ?? '{}').note }
    helpers.raw(204, batchHeaders(11), '')
  })

  const outcome = await modifyNote(writeDeps(mock).deps, edit)

  expect(outcome).toMatchObject({ kind: 'applied', version: 11 })
  const patches = mock.requests.filter(({ method }) => method === 'PATCH')
  expect(patches).toHaveLength(1)
  expect(patches[0]?.headers['if-unmodified-since-version']).toBe('10')
  expect(JSON.parse(patches[0]?.body ?? '{}')).toEqual({ version: 10, note: edited })
})

it('reports an unverified commit when the saved HTML differs from the approved patch', async () => {
  grantAuthorize(mock)
  serveItemRead(mock, { data: { itemType: 'note', note: html }, version: 10 })
  mock.route('PATCH', path, (_req, _res, helpers) => {
    serveItemRead(mock, { data: { itemType: 'note', note: '<p>Other text</p>' }, version: 11 })
    helpers.raw(204, batchHeaders(11), '')
  })
  await expect(modifyNote(writeDeps(mock).deps, edit)).resolves.toMatchObject({
    kind: 'committed-unverified',
    retryable: false,
    key: ITEM_KEY,
  })
})

it('keeps an acknowledged patch unverified if the read-back is unavailable', async () => {
  grantAuthorize(mock)
  let patched = false
  mock.route('GET', path, (_req, _res, helpers) => {
    if (patched) helpers.raw(404, batchHeaders(11), '')
    else helpers.json(itemJson(ITEM_KEY, 10, { itemType: 'note', note: html }), batchHeaders(10))
  })
  mock.route('PATCH', path, (_req, _res, helpers) => {
    patched = true
    helpers.raw(204, batchHeaders(11), '')
  })
  await expect(modifyNote(writeDeps(mock).deps, edit)).resolves.toMatchObject({
    kind: 'committed-unverified',
    retryable: false,
    key: ITEM_KEY,
    version: 11,
  })
  expect(mock.requests.filter(({ method }) => method === 'PATCH')).toHaveLength(1)
})

it('rejects edits aimed at a protected element before obtaining a write grant', async () => {
  serveItemRead(mock, { data: { itemType: 'note', note: html }, version: 10 })
  await expect(
    modifyNote(writeDeps(mock).deps, {
      ...edit,
      edits: [{ offset: html.indexOf('Annotation link'), text: 'Replaced' }],
    }),
  ).rejects.toMatchObject({ code: 'ZOTERO_INVALID_ARGUMENT' })
  expect(mock.requests.every(({ method }) => method === 'GET')).toBe(true)
})

it('rejects a stale delete and only deletes the user-observed version', async () => {
  grantAuthorize(mock)
  serveItemRead(mock, { data: { itemType: 'note', note: html }, version: 10 })
  mock.route('DELETE', path, (_req, _res, helpers) => helpers.raw(204, batchHeaders(11), ''))
  const { deps } = writeDeps(mock)
  const deletion = { operation: 'delete', item: ITEM_REF, expectedVersion: 9 } as const
  await expect(modifyNote(deps, deletion)).rejects.toMatchObject({ code: 'ZOTERO_WRITE_CONFLICT' })
  expect(mock.requests.every(({ method }) => method === 'GET')).toBe(true)
  await expect(modifyNote(deps, { ...deletion, expectedVersion: 10 })).resolves.toMatchObject({
    kind: 'applied',
  })
  expect(
    mock.requests.find(({ method }) => method === 'DELETE')?.headers['if-unmodified-since-version'],
  ).toBe('10')
})
