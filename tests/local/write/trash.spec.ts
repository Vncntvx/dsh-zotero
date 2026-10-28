/** A Trash operation retains objects, verifies every descendant and reports partial progress. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { batchItems } from '../../../src/local/write-domain.js'
import {
  batchHeaders,
  ITEM_KEY,
  ITEM_REF,
  itemJson,
  grantAuthorize,
  SERVER_ID,
  startWriteDomainMock,
  writeDeps,
} from '../../helpers/write-domain-fixtures.js'
import type { MockZotero } from '../../helpers/mock-zotero.js'
let mock: MockZotero
beforeEach(async () => {
  mock = await startWriteDomainMock()
})
afterEach(async () => {
  await mock.close()
})

interface Node {
  key: string
  type: string
  parent?: string
  deleted?: number
}
const nodes: Node[] = [
  { key: ITEM_KEY, type: 'journalArticle' },
  { key: 'CHILDNOT', type: 'note', parent: ITEM_KEY },
  { key: 'CHILDPDF', type: 'attachment', parent: ITEM_KEY },
  { key: 'CHILDANN', type: 'annotation', parent: 'CHILDPDF' },
]
function graph(
  options: {
    fail?: string
    lie?: string
    missingTotal?: boolean
    many?: boolean
    badSnapshot?: 'wrong-key' | 'invalid-deleted'
    badChildParent?: boolean
    duplicateChild?: boolean
  } = {},
) {
  const saved = new Map(nodes.map((node) => [node.key, { ...node, version: 9, deleted: 0 }]))
  for (const node of saved.values()) {
    const wire = (entry = node) =>
      itemJson(entry.key, entry.version, {
        itemType: entry.type,
        deleted: entry.deleted,
        ...(entry.parent ? { parentItem: entry.parent } : {}),
      })
    mock.route('GET', `/api/users/0/items/${node.key}`, (_req, _res, h) => {
      const snapshot = wire() as { key: string; data: Record<string, unknown> }
      if (node.key === ITEM_KEY && options.badSnapshot === 'wrong-key') snapshot.key = 'OTHER001'
      if (node.key === ITEM_KEY && options.badSnapshot === 'invalid-deleted')
        snapshot.data.deleted = 2
      h.json(snapshot, batchHeaders(node.version))
    })
    mock.route('GET', `/api/users/0/items/${node.key}/children`, (_req, _res, h, query) => {
      const children = [...saved.values()].filter(
        (child) =>
          child.parent === node.key &&
          (query.get('itemType') === 'annotation') === (child.type === 'annotation'),
      )
      const start = Number(query.get('start') ?? 0)
      const page = children.slice(start, options.many ? start + 1 : undefined).map((child) => {
        const value = wire(child) as { data: Record<string, unknown> }
        if (options.badChildParent && node.key === ITEM_KEY) value.data.parentItem = 'OTHER001'
        return value
      })
      if (options.duplicateChild && node.key === ITEM_KEY && start === 0 && page[0] !== undefined)
        page.push(page[0])
      h.json(page, {
        ...batchHeaders(9),
        ...(options.missingTotal ? {} : { 'Total-Results': String(children.length) }),
      })
    })
    mock.route('PATCH', `/api/users/0/items/${node.key}`, (req, _res, h) => {
      expect(req.headers['if-unmodified-since-version']).toBe(String(node.version))
      expect(mock.requests.at(-1)?.body).toBe(JSON.stringify({ deleted: 1 }))
      if (options.fail === node.key) {
        h.raw(412, { 'Zotero-Server-ID': SERVER_ID }, 'Changed')
        return
      }
      if (options.lie !== node.key) node.deleted = 1
      node.version++
      h.raw(204, batchHeaders(node.version), '')
    })
  }
  return saved
}

describe('complete Trash operations', () => {
  it('moves notes, attachments and annotations before their parent, then verifies them', async () => {
    grantAuthorize(mock)
    const saved = graph({ many: true })
    const { deps } = writeDeps(mock)
    const result = await batchItems(deps, { delete: [ITEM_REF] })
    expect(result.failed).toEqual([])
    expect(result.deleted).toMatchObject([{ key: ITEM_KEY, deleted: true, version: 10 }])
    expect(result.deleted[0].children).toHaveLength(3)
    expect([...saved.values()].every((node) => node.deleted === 1)).toBe(true)
    expect(
      mock.requests.filter((r) => r.method === 'PATCH').map((r) => r.pathname.split('/').at(-1)),
    ).toEqual(['CHILDNOT', 'CHILDANN', 'CHILDPDF', ITEM_KEY])
    expect(mock.requests.some((r) => r.method === 'DELETE')).toBe(false)
    expect(mock.requests.some((r) => r.search.get('start') === '1')).toBe(true)
  })

  it('reports acknowledged children after a conflict and leaves the root unchanged', async () => {
    grantAuthorize(mock)
    const saved = graph({ fail: 'CHILDPDF' })
    const { deps } = writeDeps(mock)
    const result = await batchItems(deps, { delete: [ITEM_REF] })
    expect(result.deleted).toEqual([])
    expect(result.failed).toMatchObject([
      {
        op: 'delete',
        code: 'ZOTERO_WRITE_CONFLICT',
        completedRefs: [expect.stringContaining('CHILDNOT'), expect.stringContaining('CHILDANN')],
      },
    ])
    expect(saved.get(ITEM_KEY)?.deleted).toBe(0)
  })

  it('does not claim success if an acknowledged PATCH did not change saved state', async () => {
    grantAuthorize(mock)
    graph({ lie: 'CHILDNOT' })
    const { deps } = writeDeps(mock)
    const result = await batchItems(deps, { delete: [ITEM_REF] })
    expect(result.deleted).toEqual([])
    expect(result.failed[0]).toMatchObject({
      code: 'ZOTERO_UNEXPECTED',
      completedRefs: expect.any(Array),
    })
  })

  it('refuses incomplete child listings before any write', async () => {
    grantAuthorize(mock)
    graph({ missingTotal: true })
    const { deps } = writeDeps(mock)
    const result = await batchItems(deps, { delete: [ITEM_REF] })
    expect(result.failed[0].code).toBe('ZOTERO_UNEXPECTED')
    expect(mock.requests.some((r) => r.method === 'PATCH')).toBe(false)
  })

  it.each(['wrong-key', 'invalid-deleted'] as const)(
    'refuses an invalid root snapshot (%s) before writing',
    async (badSnapshot) => {
      graph({ badSnapshot })
      const { deps } = writeDeps(mock)
      const result = await batchItems(deps, { delete: [ITEM_REF] })
      expect(result.failed[0].code).toBe('ZOTERO_UNEXPECTED')
      expect(mock.requests.some((r) => r.method === 'PATCH')).toBe(false)
    },
  )

  it.each(['bad parent', 'duplicate child'] as const)(
    'refuses an invalid child graph (%s) before writing',
    async (invalidity) => {
      graph({
        badChildParent: invalidity === 'bad parent',
        duplicateChild: invalidity === 'duplicate child',
      })
      const { deps } = writeDeps(mock)
      const result = await batchItems(deps, { delete: [ITEM_REF] })
      expect(result.failed[0].code).toBe('ZOTERO_UNEXPECTED')
      expect(mock.requests.some((r) => r.method === 'PATCH')).toBe(false)
    },
  )

  it('verifies already trashed graphs without writing again', async () => {
    const saved = graph()
    for (const node of saved.values()) node.deleted = 1
    const { deps } = writeDeps(mock)
    const result = await batchItems(deps, { delete: [ITEM_REF] })
    expect(result.deleted).toHaveLength(1)
    expect(mock.requests.every((r) => r.method === 'GET')).toBe(true)
  })
})
