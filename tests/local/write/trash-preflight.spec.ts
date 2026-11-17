/** Cross-root preflight concurrency and version safety through both write consumers. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { batchItems } from '../../../src/local/write-batch.js'
import { restoreItems } from '../../../src/local/write-library-maintenance.js'
import { parseRef } from '../../../src/refs.js'
import {
  batchHeaders,
  grantAuthorize,
  itemJson,
  startWriteDomainMock,
  writeDeps,
} from '../../helpers/write-domain-fixtures.js'
import type { MockZotero } from '../../helpers/mock-zotero.js'
import { deferred } from '../../helpers/sync.js'

let mock: MockZotero
beforeEach(async () => {
  mock = await startWriteDomainMock()
  grantAuthorize(mock)
})
afterEach(async () => {
  await mock.close()
})

describe.each(['delete', 'restore'] as const)('%s graph preflight', (operation) => {
  const wanted = operation === 'delete' ? 1 : 0
  const perform = (keys: readonly string[]) => {
    const { deps } = writeDeps(mock)
    const refs = keys.map((key) => parseRef(`zotero://user/0/item/${key}`))
    return operation === 'delete'
      ? batchItems(deps, { delete: refs })
      : restoreItems(deps, { items: refs })
  }

  it('admits four independent roots before the first read completes and serializes writes', async () => {
    const keys = ['ROOT0001', 'ROOT0002', 'ROOT0003', 'ROOT0004', 'ROOT0005']
    const admitted = deferred()
    const release = deferred()
    let active = 0,
      peak = 0,
      started = 0,
      writes = 0
    const states = new Map(keys.map((k) => [k, { version: 9, deleted: 1 - wanted }]))
    for (const key of keys) {
      let first = true
      mock.route('GET', `/api/users/0/items/${key}`, async (_req, _res, h) => {
        if (first) {
          first = false
          active++
          peak = Math.max(peak, active)
          started++
          if (started === 4) admitted.resolve()
          await release.promise
          active--
        }
        const state = states.get(key)!
        h.json(
          itemJson(key, state.version, { itemType: 'annotation', deleted: state.deleted }),
          batchHeaders(state.version),
        )
      })
      mock.route('PATCH', `/api/users/0/items/${key}`, (req, _res, h) => {
        expect(active).toBe(0)
        expect(started).toBe(5)
        const state = states.get(key)!
        expect(req.headers['if-unmodified-since-version']).toBe(String(state.version))
        writes++
        state.deleted = wanted
        h.raw(204, batchHeaders(++state.version), '')
      })
    }
    if (operation === 'delete') {
      mock.route('POST', '/api/users/0/items', (_req, _res, h) => {
        expect(active).toBe(0)
        expect(started).toBe(5)
        const entries = JSON.parse(mock.requests.at(-1)!.body) as {
          key: string
          version: number
        }[]
        writes += entries.length
        const successful: Record<string, unknown> = {}
        const success: Record<string, string> = {}
        entries.forEach((e, i) => {
          const state = states.get(e.key)!
          state.deleted = wanted
          state.version = e.version + 1
          successful[i] = itemJson(e.key, state.version, {
            itemType: 'annotation',
            deleted: state.deleted,
          })
          success[i] = e.key
        })
        h.json({ successful, success, unchanged: {}, failed: {} }, batchHeaders(10))
      })
    }
    const result = perform(keys)
    try {
      await admitted.promise
      expect({ started, peak, writes }).toEqual({ started: 4, peak: 4, writes: 0 })
    } finally {
      release.resolve()
    }
    expect((await result).failed).toEqual([])
    expect(writes).toBe(5)
    expect(peak).toBe(4)
  })

  it('refreshes an overlapping child root after the parent graph changed its version', async () => {
    const parent = 'PARENT01',
      child = 'CHILD001'
    const nodes = new Map([parent, child].map((key) => [key, { version: 9, deleted: 1 - wanted }]))
    let childWrites = 0
    for (const [key, state] of nodes) {
      const wire = () =>
        itemJson(key, state.version, {
          itemType: key === child ? 'annotation' : 'attachment',
          deleted: state.deleted,
          ...(key === child ? { parentItem: parent } : {}),
        })
      mock.route('GET', `/api/users/0/items/${key}`, (_req, _res, h) =>
        h.json(wire(), batchHeaders(state.version)),
      )
      if (key === parent)
        mock.route('GET', `/api/users/0/items/${key}/children`, (_req, _res, h, query) => {
          expect(query.get('itemType')).toBe('annotation')
          const saved = nodes.get(child)!
          h.json(
            [
              itemJson(child, saved.version, {
                itemType: 'annotation',
                deleted: saved.deleted,
                parentItem: parent,
              }),
            ],
            {
              ...batchHeaders(saved.version),
              'Total-Results': '1',
            },
          )
        })
      mock.route('PATCH', `/api/users/0/items/${key}`, (req, _res, h) => {
        expect(req.headers['if-unmodified-since-version']).toBe(String(state.version))
        if (key === child) childWrites++
        state.deleted = wanted
        h.raw(204, batchHeaders(++state.version), '')
      })
    }
    const result = await perform([parent, child])
    expect(result.failed).toEqual([])
    expect(childWrites).toBe(1)
    expect(nodes.get(child)?.version).toBe(10)
    expect(
      mock.requests.filter(
        (request) => request.method === 'GET' && request.pathname.endsWith(`/items/${child}`),
      ).length,
    ).toBeGreaterThanOrEqual(2)
  })

  it('keeps one failed preflight local to its root and completes the healthy root', async () => {
    mock.route('GET', '/api/users/0/items/BROKEN01', (_req, _res, h) => h.json({}, batchHeaders(9)))
    let deleted = 1 - wanted
    mock.route('GET', '/api/users/0/items/HEALTHY1', (_req, _res, h) =>
      h.json(
        itemJson('HEALTHY1', deleted === wanted ? 10 : 9, { itemType: 'annotation', deleted }),
        batchHeaders(10),
      ),
    )
    mock.route('PATCH', '/api/users/0/items/HEALTHY1', (_req, _res, h) => {
      deleted = wanted
      h.raw(204, batchHeaders(10), '')
    })
    const result = await perform(['BROKEN01', 'HEALTHY1'])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]?.ref).toContain('BROKEN01')
    expect(deleted).toBe(wanted)
  })
})
