/** Zotero itemKey listings can expand beyond the requested export refs. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZOTERO_UNEXPECTED } from '../../src/errors.js'
import { parseRef } from '../../src/refs.js'
import {
  exportRequest,
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../helpers/provider-harness.js'
import { expectRequestCount, zoteroError } from '../helpers/server/assert.js'
import { apiPath, ATTACHMENT_KEY, ITEM_KEY, NOTE_KEY, itemRef } from '../helpers/server/keys.js'
import { attachment, item, noteRow } from '../helpers/server/objects.js'
import { serveJson } from '../helpers/server/serve.js'

let harness: ProviderHarness

beforeEach(async () => {
  harness = await setupProvider()
})

afterEach(async () => {
  await teardownProvider(harness)
})

const parent = item({ data: { citationKey: 'native-citekey' } })
const pdf = attachment({ data: { parentItem: ITEM_KEY } })
const note = noteRow({ data: { parentItem: ITEM_KEY } })
const parentCsl = { id: 'native-citekey', title: 'Requested paper' }
const pdfCsl = { id: `http://zotero.org/users/0/items/${ATTACHMENT_KEY}`, title: 'Requested PDF' }
const noteCsl = { id: `http://zotero.org/users/0/items/${NOTE_KEY}`, title: 'Unrequested note' }
const parentRef = parseRef(itemRef())
const pdfRef = parseRef(itemRef(ATTACHMENT_KEY))

describe('verified item scope', () => {
  it('allows scope-expanded metadata on an otherwise valid BibTeX export', async () => {
    const { mock, provider } = harness
    const body = '@article{native-citekey, title={Requested paper}}'
    mock.route('GET', `${apiPath()}/items`, (_req, _res, helpers, search) => {
      if (search.get('format') === 'bibtex') helpers.text(body)
      else helpers.json([pdf, parent])
    })
    const result = await provider.export(exportRequest({ format: 'bibtex', refs: [parentRef] }))
    expect(result).toMatchObject({
      format: 'bibtex',
      text: body,
      items: [{ ref: itemRef(), citationKey: parentCsl.id, exportKey: parentCsl.id }],
    })
    expectRequestCount(mock, 2)
  })

  it('rejects duplicate rows for a requested key', async () => {
    const { mock, provider } = harness
    mock.route('GET', `${apiPath()}/items`, (_req, _res, helpers, search) => {
      if (search.has('format')) helpers.text('exported-as-bibtex')
      else helpers.json([parent, parent])
    })
    await zoteroError(
      provider.export(exportRequest({ format: 'bibtex', refs: [parentRef] })),
      ZOTERO_UNEXPECTED,
      'duplicate export item',
    )
  })
})

describe('CSL JSON row includes', () => {
  it('only delivers requested rows and locates them in the API order', async () => {
    const { mock, provider } = harness
    serveJson(mock, `${apiPath()}/items`, [
      { ...note, csljson: JSON.stringify([noteCsl]) },
      { ...pdf, csljson: JSON.stringify([pdfCsl]) },
      { ...parent, csljson: JSON.stringify([parentCsl]) },
    ])
    const result = await provider.export(
      exportRequest({ format: 'csljson', refs: [parentRef, pdfRef] }),
    )
    expect(result).toEqual({
      format: 'csljson',
      text: JSON.stringify([pdfCsl, parentCsl], null, '\t'),
      items: [
        {
          ref: itemRef(),
          citationKey: parentCsl.id,
          citationKeySource: 'native',
          exportKey: parentCsl.id,
          title: parentCsl.title,
          entryIndex: 1,
        },
        { ref: itemRef(ATTACHMENT_KEY), exportKey: pdfCsl.id, title: pdfCsl.title, entryIndex: 0 },
      ],
    })
    expectRequestCount(mock, 1)
    const { search } = mock.requests[0]!
    expect(search.get('itemKey')).toBe(`${ITEM_KEY},${ATTACHMENT_KEY}`)
    expect(search.get('include')).toBe('data,csljson')
  })

  it('delivers the same filtered text without itemization to the panel', async () => {
    const { mock, provider } = harness
    serveJson(mock, `${apiPath()}/items`, [
      { ...pdf, csljson: JSON.stringify([pdfCsl]) },
      { ...parent, csljson: JSON.stringify([parentCsl]) },
    ])
    expect(
      await provider.exportText(exportRequest({ format: 'csljson', refs: [parentRef] })),
    ).toEqual({
      format: 'csljson',
      text: JSON.stringify([parentCsl], null, '\t'),
    })
  })

  it('retains a ref when the translator omits its entry', async () => {
    const { mock, provider } = harness
    serveJson(mock, `${apiPath()}/items`, [{ ...pdf, csljson: '[]' }])
    expect(await provider.export(exportRequest({ format: 'csljson', refs: [pdfRef] }))).toEqual({
      format: 'csljson',
      text: '[]',
      items: [{ ref: itemRef(ATTACHMENT_KEY) }],
    })
  })

  it.each([undefined, '{', '[null]', '[{}, {}]'])(
    'rejects invalid row include %s',
    async (csljson) => {
      const { mock, provider } = harness
      serveJson(mock, `${apiPath()}/items`, [{ ...parent, csljson }])
      await zoteroError(
        provider.export(exportRequest({ format: 'csljson', refs: [parentRef] })),
        ZOTERO_UNEXPECTED,
        'invalid per-item CSL JSON export',
      )
    },
  )
})
