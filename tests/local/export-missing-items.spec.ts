import { afterEach, beforeEach, it } from 'vitest'
import {
  setupProvider,
  teardownProvider,
  exportRequest,
  type ProviderHarness,
} from '../helpers/provider-harness.ts'
import { apiPath, ITEM_KEY, SECOND_ITEM_KEY } from '../helpers/server/keys.ts'
import { item } from '../helpers/server/objects.ts'
import { zoteroError } from '../helpers/server/assert.ts'
import { ZOTERO_NOT_FOUND, ZOTERO_UNEXPECTED } from '../../src/errors.ts'

let harness: ProviderHarness
beforeEach(async () => {
  harness = await setupProvider()
})
afterEach(async () => {
  await teardownProvider(harness)
})

it.each(['bibliography', 'bibtex', 'biblatex', 'ris', 'csljson', 'csv'] as const)(
  'rejects a missing requested key in %s instead of reporting a complete export',
  async (format) => {
    harness.mock.route('GET', `${apiPath()}/items`, (_req, _res, helpers, search) => {
      if (search.has('format')) helpers.text('nonempty export for the first item')
      else helpers.json([item({ key: ITEM_KEY })])
    })
    await zoteroError(
      harness.provider.export(exportRequest({ format })),
      ZOTERO_NOT_FOUND,
      SECOND_ITEM_KEY,
    )
  },
)

it('keeps a metadata refusal explicit for the bibliography text endpoint', async () => {
  harness.mock.route('GET', `${apiPath()}/items`, (_req, _res, helpers, search) => {
    if (search.has('format')) helpers.text('rendered bibliography')
    else {
      helpers.raw(503, { 'Content-Type': 'text/plain' }, 'unavailable')
    }
  })
  await zoteroError(
    harness.provider.exportText(exportRequest({ format: 'bibliography' })),
    ZOTERO_UNEXPECTED,
    'HTTP 503',
  )
})
