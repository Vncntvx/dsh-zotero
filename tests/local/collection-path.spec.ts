import { afterEach, beforeEach, expect, it } from 'vitest'
import {
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../helpers/provider-harness.js'
import { collectionRow } from '../helpers/server/objects.js'
import { serveJson, serveStatus } from '../helpers/server/serve.js'
import { apiPath, collectionRef } from '../helpers/server/keys.js'

let harness: ProviderHarness
beforeEach(async () => {
  harness = await setupProvider()
})
afterEach(async () => {
  await teardownProvider(harness)
})
const request = {
  library: { type: 'user', id: 0 } as const,
  ref: collectionRef(),
  libraryVersion: 12,
}
const headers = { 'Last-Modified-Version': '12', 'Zotero-Server-ID': 'S1', 'Total-Results': '1' }
function serve(key: string, parentCollection: string | false = false) {
  serveJson(
    harness.mock,
    `${apiPath()}/collections/${key}`,
    collectionRow({ key, data: { name: key, parentCollection } }),
    headers,
  )
}
it('reads actual parents with repeated names and fences the completed path with a listing version', async () => {
  const key = request.ref.split('/').at(-1)!.split('?')[0]!
  serve(key, 'PARENT01')
  serve('PARENT01')
  serveJson(harness.mock, `${apiPath()}/collections/top`, [], headers)
  const result = await harness.provider.collectionPath(request)
  expect(result.path.map((row) => row.ref.split('/').at(-1)?.split('?')[0])).toEqual([
    'PARENT01',
    key,
  ])
  expect(result.path.at(-1)?.path).toEqual(['PARENT01', key])
  expect(result.libraryVersion).toBe(12)
})
it('rejects a cycle rather than returning a truncated success', async () => {
  const key = request.ref.split('/').at(-1)!.split('?')[0]!
  serve(key, key)
  await expect(harness.provider.collectionPath(request)).rejects.toMatchObject({
    code: 'ZOTERO_UNEXPECTED',
  })
})
it('distinguishes a missing ancestor from a missing target', async () => {
  const key = request.ref.split('/').at(-1)!.split('?')[0]!
  serve(key, 'MISSING1')
  serveStatus(harness.mock, `${apiPath()}/collections/MISSING1`, 404)
  await expect(harness.provider.collectionPath(request)).rejects.toMatchObject({
    code: 'ZOTERO_UNEXPECTED',
  })
})
it('rejects a changed library version even when object versions are unchanged', async () => {
  const key = request.ref.split('/').at(-1)!.split('?')[0]!
  serve(key)
  serveJson(harness.mock, `${apiPath()}/collections/top`, [], {
    ...headers,
    'Last-Modified-Version': '13',
  })
  await expect(harness.provider.collectionPath(request)).rejects.toMatchObject({
    code: 'ZOTERO_UNEXPECTED',
  })
})
it('rejects navigation pages without a valid library version header', async () => {
  serveJson(harness.mock, `${apiPath()}/collections/top`, [], { 'Total-Results': '0' })
  await expect(
    harness.provider.browse({ kind: 'collections', offset: 0, limit: 1 }),
  ).rejects.toMatchObject({ code: 'ZOTERO_UNEXPECTED' })
})

it('preserves not-found for the target itself', async () => {
  const key = request.ref.split('/').at(-1)!.split('?')[0]!
  serveStatus(harness.mock, `${apiPath()}/collections/${key}`, 404)
  await expect(harness.provider.collectionPath(request)).rejects.toMatchObject({
    code: 'ZOTERO_NOT_FOUND',
  })
})
it('rejects an illegal parent key', async () => {
  const key = request.ref.split('/').at(-1)!.split('?')[0]!
  serve(key, 'invalid')
  await expect(harness.provider.collectionPath(request)).rejects.toMatchObject({
    code: 'ZOTERO_UNEXPECTED',
  })
})
it('rejects a collection ref from another library before reading', async () => {
  await expect(
    harness.provider.collectionPath({ ...request, library: { type: 'group', id: 42 } }),
  ).rejects.toMatchObject({ code: 'ZOTERO_INVALID_ARGUMENT' })
})
it.each(['', '-1', '1.5', '9007199254740992'])(
  'rejects invalid navigation library version %s',
  async (version) => {
    serveJson(harness.mock, `${apiPath()}/collections/top`, [], {
      ...headers,
      'Last-Modified-Version': version,
      'Total-Results': '0',
    })
    await expect(
      harness.provider.browse({ kind: 'collections', offset: 0, limit: 1 }),
    ).rejects.toMatchObject({ code: 'ZOTERO_UNEXPECTED' })
  },
)
