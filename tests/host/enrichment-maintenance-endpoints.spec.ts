/** Batch and index management through the pinned Harness Gateway. */
import { randomUUID } from 'node:crypto'
import { JobId } from '@deepseek-ai/dsh-jobs'
import { afterEach, expect, it, vi } from 'vitest'
import { attachment, listingVersionHeaders } from '../helpers/server/objects.ts'
import { serveJson } from '../helpers/server/serve.ts'
import {
  endpointFixture,
  OTHER,
  OWNER,
  type EndpointFixture,
} from './support/enrichment-parse-endpoints.ts'

let fixture: EndpointFixture | undefined
afterEach(async () => {
  await fixture?.dispose()
  fixture = undefined
})

it('authorizes batch actions by session and publishes a selected PDF to FTS5 through the existing MinerU path', async () => {
  const world = (fixture = await endpointFixture())
  const methods = [
    'batchPdfCatalog',
    'startBatchParse',
    'batchParseStatus',
    'parsedIndexStatus',
    'rebuildParsedIndex',
  ] as const
  world.grant(OWNER, methods)
  const request = {
    sessionId: OWNER,
    kind: 'pdfs',
    source: { library: { type: 'user', id: 0 } },
    query: '',
    offset: 0,
  }
  await expect(
    world.invoke('batchPdfCatalog', { ...request, sessionId: OTHER }, world.guest),
  ).rejects.toMatchObject({
    code: 'remote-access/denied',
  })
  const headers = { ...listingVersionHeaders(), 'Total-Results': '1' }
  serveJson(world.lane.mock, '/api/users/0/collections', [], headers)
  serveJson(world.lane.mock, '/api/users/0/items', [attachment()], headers)
  const catalog = (await world.invoke('batchPdfCatalog', request, world.guest)) as {
    catalogId: string
    total: number
  }
  expect(catalog.total).toBe(1)
  expect(world.http.calls).toEqual([])
  const admission = {
    sessionId: OWNER,
    catalogId: catalog.catalogId,
    operationId: randomUUID(),
    selection: { all: true, refs: [] },
  }
  await expect(world.invoke('startBatchParse', admission, world.guest)).resolves.toMatchObject({
    total: 1,
  })
  await vi.waitFor(async () => {
    await expect(
      world.invoke('batchParseStatus', { sessionId: OWNER, offset: 0 }, world.guest),
    ).resolves.toMatchObject({
      state: 'completed',
      parsed: 1,
      failed: 0,
    })
  })
  await expect(
    world.invoke('parsedIndexStatus', { sessionId: OWNER }, world.guest),
  ).resolves.toMatchObject({ indexed: 1, total: 1 })
  const { jobId } = (await world.invoke(
    'rebuildParsedIndex',
    { sessionId: OWNER },
    world.guest,
  )) as { jobId: string }
  await expect(world.ctx.jobs.wait(JobId(jobId), 5000, OWNER)).resolves.toMatchObject({
    status: 'completed',
  })
  await expect(
    world.invoke('parsedIndexStatus', { sessionId: OWNER }, world.guest),
  ).resolves.toMatchObject({
    indexed: 1,
    total: 1,
    rebuild: { state: 'completed', jobId },
  })
  expect(world.http.calls.filter((call) => call.init.method === 'POST')).toHaveLength(1)
})

it('keeps the entire PDF snapshot across filters and rejects exclusions outside it', async () => {
  const world = (fixture = await endpointFixture({ holdResult: true }))
  const headers = { ...listingVersionHeaders(), 'Total-Results': '2' }
  serveJson(world.lane.mock, '/api/users/0/collections', [], headers)
  serveJson(
    world.lane.mock,
    '/api/users/0/items',
    [
      attachment({ data: { title: 'River paper' } }),
      attachment({ key: 'ATTACH02', data: { title: 'Soil paper' } }),
    ],
    headers,
  )
  const invoke = world.invoke
  const query = { sessionId: OWNER, kind: 'pdfs', offset: 0, query: 'river' }
  const { catalogId, rows } = (await invoke('batchPdfCatalog', {
    ...query,
    source: { library: { type: 'user', id: 0 } },
  })) as { catalogId: string; rows: readonly { ref: string }[] }
  expect(rows).toHaveLength(1)
  await expect(
    invoke('batchPdfCatalog', { ...query, query: 'soil', source: { catalogId } }),
  ).resolves.toMatchObject({ total: 2, matching: 1, rows: [{ title: 'Soil paper' }] })
  await expect(
    invoke('batchPdfCatalog', { ...query, sessionId: OTHER, source: { catalogId } }),
  ).rejects.toThrow('listing expired')
  const operationId = randomUUID()
  const start = { sessionId: OWNER, operationId, catalogId }
  await expect(
    invoke('startBatchParse', { ...start, selection: { all: true, refs: ['not in catalog'] } }),
  ).rejects.toThrow('Select at least one PDF')
  expect(world.http.calls).toEqual([])
  await expect(
    invoke('startBatchParse', { ...start, selection: { all: false, refs: [rows[0]!.ref] } }),
  ).resolves.toMatchObject({ total: 1 })
  await expect(
    invoke('cancelBatchParse', { sessionId: OWNER, operationId: randomUUID() }),
  ).rejects.toThrow('No matching')
  await expect(
    invoke('cancelBatchParse', { sessionId: OWNER, operationId }),
  ).resolves.toMatchObject({ state: 'stopping' })
})
