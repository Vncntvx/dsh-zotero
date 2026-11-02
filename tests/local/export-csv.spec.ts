/** CSV remains one opaque translator document, including BOM and embedded newlines. */
import { afterEach, beforeEach, expect, it } from 'vitest'
import {
  setupProvider,
  teardownProvider,
  exportRequest,
  type ProviderHarness,
} from '../helpers/provider-harness.ts'
import { parseRef } from '../../src/refs.ts'
let harness: ProviderHarness
beforeEach(async () => {
  harness = await setupProvider()
})
afterEach(async () => {
  await teardownProvider(harness)
})
it('passes the official CSV translator body through without parsing or trimming', async () => {
  const text = '\ufeffTitle,Note\r\n"带,逗号","引号""和\n换行"\r\n  '
  harness.mock.route('GET', '/api/users/0/items', (_req, _res, helpers) => helpers.text(text))
  expect(await harness.provider.export(exportRequest({ format: 'csv' }))).toMatchObject({
    format: 'csv',
    text,
  })
  expect(harness.mock.requests).toHaveLength(1)
  expect(harness.mock.requests[0]!.search.get('format')).toBe('csv')
})
it.each([50, 51])(
  'keeps the unique-ref boundary at one 50-key request (%s refs)',
  async (count) => {
    harness.mock.route('GET', '/api/users/0/items', (_req, _res, helpers) =>
      helpers.text('Title\nunchanged\n'),
    )
    const refs = Array.from({ length: count }, (_, index) =>
      parseRef(`zotero://user/0/item/ITEM${String(index).padStart(4, '0')}`),
    )
    const reading = harness.provider.export(exportRequest({ format: 'csv', refs }))
    if (count === 51) {
      await expect(reading).rejects.toMatchObject({ code: 'ZOTERO_INVALID_ARGUMENT' })
      expect(harness.mock.requests).toHaveLength(0)
    } else {
      expect(await reading).toMatchObject({ text: 'Title\nunchanged\n' })
      expect(harness.mock.requests).toHaveLength(1)
      expect(harness.mock.requests[0]!.search.get('itemKey')!.split(',')).toHaveLength(50)
    }
  },
)
