/** A Trash operation retains objects, verifies every descendant and reports partial progress. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { batchItems } from '../../../src/local/write-batch.js'
import { ZoteroWriteCommitUnknownError } from '../../../src/errors.js'
import { deferred } from '../../helpers/sync.js'
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
    missingReceipt?: boolean
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
      h.raw(
        204,
        options.missingReceipt ? { 'Zotero-Server-ID': SERVER_ID } : batchHeaders(node.version),
        '',
      )
    })
  }
  mock.route('POST', '/api/users/0/items', (_req, _res, h) => {
    const entries = JSON.parse(mock.requests.at(-1)!.body) as {
      key: string
      version: number
      deleted: number
    }[]
    const successful: Record<string, unknown> = {}
    const failed: Record<string, unknown> = {}
    entries.forEach((entry, index) => {
      const node = saved.get(entry.key)!
      expect(entry.version).toBe(node.version)
      expect(entry.deleted).toBe(1)
      if (options.fail === node.key) {
        failed[index] = { key: node.key, code: 412, message: 'Changed' }
        return
      }
      if (options.lie !== node.key) node.deleted = 1
      node.version++
      successful[index] = itemJson(node.key, node.version, {
        itemType: node.type,
        deleted: node.deleted,
      })
    })
    h.json(
      { successful, success: {}, unchanged: {}, failed },
      options.missingReceipt ? { 'Zotero-Server-ID': SERVER_ID } : batchHeaders(10),
    )
  })
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
    ).toEqual(['CHILDPDF', ITEM_KEY])
    const firstWrite = mock.requests.find(
      (r) => r.method === 'POST' && r.pathname.endsWith('/items'),
    )!
    expect(JSON.parse(firstWrite.body).map((entry: { key: string }) => entry.key)).toEqual([
      'CHILDNOT',
      'CHILDANN',
    ])
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

  it('puts a delete with a missing receipt in unverified without retrying', async () => {
    grantAuthorize(mock)
    graph({ missingReceipt: true })
    const { deps } = writeDeps(mock)
    const result = await batchItems(deps, { delete: [ITEM_REF] })
    expect(result.deleted).toEqual([])
    expect(result.failed).toEqual([])
    expect(result.unverified).toMatchObject([
      { op: 'delete', reason: 'receipt-unknown', retryable: false },
      { op: 'delete', reason: 'receipt-unknown', retryable: false },
    ])
    expect(mock.requests.filter((request) => request.method === 'PATCH')).toHaveLength(0)
    expect(
      mock.requests.filter(
        (request) => request.method === 'POST' && request.pathname.endsWith('/items'),
      ),
    ).toHaveLength(1)
  })

  it('keeps a keyed receipt with unproven saved state unverified and stops the graph', async () => {
    grantAuthorize(mock)
    graph({ lie: 'CHILDNOT' })
    const { deps } = writeDeps(mock)
    const result = await batchItems(deps, { delete: [ITEM_REF] })
    expect(result.deleted).toEqual([])
    expect(result.failed).toEqual([])
    expect(result.unverified).toMatchObject([
      { ref: expect.stringContaining('CHILDNOT'), retryable: false },
    ])
    expect(mock.requests.some((request) => request.method === 'PATCH')).toBe(false)
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

  it('batches trash frontiers across multiple roots into wave requests', async () => {
    grantAuthorize(mock)
    const rootCount = 10
    const roots = Array.from({ length: rootCount }, (_, i) => ({
      key: `ROOT${String(i).padStart(4, '0')}`,
      childKey: `CHLD${String(i).padStart(4, '0')}`,
    }))

    const nodeStates = new Map<
      string,
      { key: string; parent?: string; type: string; version: number; deleted: number }
    >()
    for (const r of roots) {
      nodeStates.set(r.key, { key: r.key, type: 'journalArticle', version: 1, deleted: 0 })
      nodeStates.set(r.childKey, {
        key: r.childKey,
        parent: r.key,
        type: 'attachment',
        version: 1,
        deleted: 0,
      })
    }

    for (const node of nodeStates.values()) {
      mock.route('GET', `/api/users/0/items/${node.key}`, (_req, _res, h) => {
        h.json(
          itemJson(node.key, node.version, {
            itemType: node.type,
            deleted: node.deleted,
            ...(node.parent ? { parentItem: node.parent } : {}),
          }),
          batchHeaders(node.version),
        )
      })
      mock.route('GET', `/api/users/0/items/${node.key}/children`, (_req, _res, h) => {
        const children = [...nodeStates.values()].filter((c) => c.parent === node.key)
        h.json(
          children.map((c) =>
            itemJson(c.key, c.version, {
              itemType: c.type,
              deleted: c.deleted,
              parentItem: c.parent,
            }),
          ),
          { ...batchHeaders(node.version), 'Total-Results': String(children.length) },
        )
      })
    }

    let waveWrites = 0
    mock.route('POST', '/api/users/0/items', (_req, _res, h) => {
      waveWrites++
      const entries = JSON.parse(mock.requests.at(-1)!.body) as { key: string; version: number }[]
      const successful: Record<string, unknown> = {}
      const success: Record<string, string> = {}
      entries.forEach((e, index) => {
        const node = nodeStates.get(e.key)!
        node.deleted = 1
        node.version++
        successful[index] = itemJson(node.key, node.version, {
          itemType: node.type,
          deleted: node.deleted,
          ...(node.parent ? { parentItem: node.parent } : {}),
        })
        success[index] = node.key
      })
      h.json({ successful, success, unchanged: {}, failed: {} }, batchHeaders(10))
    })

    const { deps } = writeDeps(mock)
    const result = await batchItems(deps, {
      delete: roots.map((r) => ({
        library: { type: 'user' as const, id: 0 },
        kind: 'item' as const,
        key: r.key,
        serverId: SERVER_ID,
      })),
    })

    expect(result.kind).toBe('applied')
    expect(result.deleted).toHaveLength(rootCount)
    // 2 waves: wave 1 for all children (leaves), wave 2 for all roots (parents)
    expect(waveWrites).toBe(2)
    expect(mock.requests.filter((r) => r.method === 'PATCH')).toHaveLength(0)
  })

  it('keeps independent roots moving when one root refuses a child', async () => {
    grantAuthorize(mock)
    const roots: Record<string, string[]> = {
      ROOTAAAA: ['CHILDAA1', 'CHILDAA2'],
      ROOTBBBB: ['CHILDBB1', 'CHILDBB2'],
    }
    const failing = 'CHILDAA1'
    const nodeStates = new Map<
      string,
      { key: string; parent?: string; type: string; version: number; deleted: number }
    >()
    for (const [root, children] of Object.entries(roots)) {
      nodeStates.set(root, { key: root, type: 'journalArticle', version: 9, deleted: 0 })
      for (const child of children)
        nodeStates.set(child, {
          key: child,
          parent: root,
          type: 'note',
          version: 9,
          deleted: 0,
        })
    }

    for (const node of nodeStates.values()) {
      mock.route('GET', `/api/users/0/items/${node.key}`, (_req, _res, h) => {
        h.json(
          itemJson(node.key, node.version, {
            itemType: node.type,
            deleted: node.deleted,
            ...(node.parent ? { parentItem: node.parent } : {}),
          }),
          batchHeaders(node.version),
        )
      })
      mock.route('GET', `/api/users/0/items/${node.key}/children`, (_req, _res, h) => {
        const children = [...nodeStates.values()].filter((child) => child.parent === node.key)
        h.json(
          children.map((child) =>
            itemJson(child.key, child.version, {
              itemType: child.type,
              deleted: child.deleted,
              parentItem: child.parent,
            }),
          ),
          { ...batchHeaders(node.version), 'Total-Results': String(children.length) },
        )
      })
      mock.route('PATCH', `/api/users/0/items/${node.key}`, (_req, _res, h) => {
        node.deleted = 1
        node.version++
        h.raw(204, batchHeaders(10), '')
      })
    }

    mock.route('POST', '/api/users/0/items', (_req, _res, h) => {
      const entries = JSON.parse(mock.requests.at(-1)!.body) as { key: string; version: number }[]
      const successful: Record<string, unknown> = {}
      const success: Record<string, string> = {}
      const failed: Record<string, unknown> = {}
      entries.forEach((entry, index) => {
        const node = nodeStates.get(entry.key)!
        if (node.key === failing) {
          failed[index] = { key: node.key, code: 412, message: 'Changed' }
          return
        }
        node.deleted = 1
        node.version++
        successful[index] = itemJson(node.key, node.version, {
          itemType: node.type,
          deleted: node.deleted,
          ...(node.parent ? { parentItem: node.parent } : {}),
        })
        success[index] = node.key
      })
      h.json({ successful, success, unchanged: {}, failed }, batchHeaders(10))
    })

    const { deps } = writeDeps(mock)
    const result = await batchItems(deps, {
      delete: Object.keys(roots).map((key) => ({
        library: { type: 'user' as const, id: 0 },
        kind: 'item' as const,
        key,
        serverId: SERVER_ID,
      })),
    })

    // The refused child blocks only its own ancestors; the other root still
    // settles through the same merged waves.
    expect(result.deleted.map((entry) => entry.key)).toEqual(['ROOTBBBB'])
    expect(result.failed).toMatchObject([
      {
        op: 'delete',
        ref: expect.stringContaining('ROOTAAAA'),
        code: 'ZOTERO_WRITE_CONFLICT',
        completedRefs: [expect.stringContaining('CHILDAA2')],
      },
    ])
    expect(nodeStates.get('ROOTAAAA')!.deleted).toBe(0)
    expect(nodeStates.get('ROOTBBBB')!.deleted).toBe(1)
    expect(
      mock.requests
        .filter((request) => request.method === 'PATCH')
        .map((request) => request.pathname.split('/').at(-1)),
    ).toEqual(['ROOTBBBB'])
  })

  it('keeps acknowledged deletes in a commit-unknown raised after the graph boundary', async () => {
    grantAuthorize(mock)
    const root = 'ROOTABRT'
    const child = 'CHILDAB1'
    const state = new Map([
      [root, { key: root, type: 'journalArticle', version: 9, deleted: 0 }],
      [child, { key: child, parent: root, type: 'note', version: 9, deleted: 0 }],
    ])
    for (const node of state.values()) {
      mock.route('GET', `/api/users/0/items/${node.key}`, (_req, _res, h) => {
        h.json(
          itemJson(node.key, node.version, {
            itemType: node.type,
            deleted: node.deleted,
            ...(node.parent ? { parentItem: node.parent } : {}),
          }),
          batchHeaders(node.version),
        )
      })
      mock.route('GET', `/api/users/0/items/${node.key}/children`, (_req, _res, h) => {
        const children = [...state.values()].filter((entry) => entry.parent === node.key)
        h.json(
          children.map((entry) =>
            itemJson(entry.key, entry.version, {
              itemType: entry.type,
              deleted: entry.deleted,
              parentItem: entry.parent,
            }),
          ),
          { ...batchHeaders(node.version), 'Total-Results': String(children.length) },
        )
      })
    }
    const rootPatch = deferred<void>()
    mock.route('PATCH', `/api/users/0/items/${child}`, (_req, _res, h) => {
      const node = state.get(child)!
      node.deleted = 1
      node.version++
      h.raw(204, batchHeaders(10), '')
    })
    mock.route('PATCH', `/api/users/0/items/${root}`, (_req, _res, h) => {
      rootPatch.resolve()
      const node = state.get(root)!
      node.deleted = 1
      node.version++
      h.delayRaw(204, batchHeaders(11), '', 2_000)
    })

    const { deps } = writeDeps(mock)
    const controller = new AbortController()
    const pending = batchItems(
      deps,
      {
        delete: [
          {
            library: { type: 'user' as const, id: 0 },
            kind: 'item' as const,
            key: root,
            serverId: SERVER_ID,
          },
        ],
      },
      controller.signal,
    )
    await rootPatch.promise
    controller.abort()
    const error = await pending.catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(ZoteroWriteCommitUnknownError)
    const unknownError = error as ZoteroWriteCommitUnknownError
    expect(unknownError.completedRefs).toEqual([expect.stringContaining(child)])
    // The model sees the message only; the acknowledged child must be in it.
    expect(unknownError.message).toContain(child)
  })

  it('reports an unaffected root when a commit-unknown stops a merged wave', async () => {
    grantAuthorize(mock)
    const rootKeys = ['ROOTAAAA', 'ROOTBBBB']
    const childOf: Record<string, string> = {
      ROOTAAAA: 'CHILDAAA',
      ROOTBBBB: 'CHILDBBB',
    }
    const state = new Map<
      string,
      { key: string; parent?: string; version: number; deleted: number }
    >()
    for (const root of rootKeys) {
      state.set(root, { key: root, version: 9, deleted: 0 })
      state.set(childOf[root]!, { key: childOf[root]!, parent: root, version: 9, deleted: 0 })
    }
    for (const node of state.values()) {
      mock.route('GET', `/api/users/0/items/${node.key}`, (_req, _res, h) => {
        h.json(
          itemJson(node.key, node.version, {
            itemType: node.parent === undefined ? 'journalArticle' : 'note',
            deleted: node.deleted,
            ...(node.parent === undefined ? {} : { parentItem: node.parent }),
          }),
          batchHeaders(node.version),
        )
      })
      mock.route('GET', `/api/users/0/items/${node.key}/children`, (_req, _res, h) => {
        const children = [...state.values()].filter((entry) => entry.parent === node.key)
        h.json(
          children.map((entry) =>
            itemJson(entry.key, entry.version, {
              itemType: 'note',
              deleted: entry.deleted,
              parentItem: entry.parent,
            }),
          ),
          { ...batchHeaders(node.version), 'Total-Results': String(children.length) },
        )
      })
      mock.route('PATCH', `/api/users/0/items/${node.key}`, (_req, _res, h) => {
        node.deleted = 1
        node.version++
        h.raw(204, batchHeaders(10), '')
      })
    }
    mock.route('POST', '/api/users/0/items', (_req, _res, h) => {
      const entries = JSON.parse(mock.requests.at(-1)!.body) as { key: string; version: number }[]
      const successful: Record<string, unknown> = {}
      const success: Record<string, string> = {}
      entries.forEach((entry, index) => {
        if (entry.key === childOf.ROOTAAAA) return // omitted from every bucket
        const node = state.get(entry.key)!
        node.deleted = 1
        node.version++
        successful[index] = itemJson(node.key, node.version, {
          itemType: 'note',
          deleted: node.deleted,
          parentItem: node.parent,
        })
        success[index] = node.key
      })
      h.json({ successful, success, unchanged: {}, failed: {} }, batchHeaders(10))
    })

    const { deps } = writeDeps(mock)
    const result = await batchItems(deps, {
      delete: rootKeys.map((key) => ({
        library: { type: 'user' as const, id: 0 },
        kind: 'item' as const,
        key,
        serverId: SERVER_ID,
      })),
    })

    expect(result.deleted).toEqual([])
    // The root whose child outcome is unknown is named by the unverified row;
    // the other root never reached its own PATCH and must still be reported.
    expect(result.unverified).toMatchObject([
      { op: 'delete', index: 0, ref: expect.stringContaining(childOf.ROOTAAAA) },
    ])
    expect(result.failed).toMatchObject([
      {
        op: 'delete',
        ref: expect.stringContaining('ROOTBBBB'),
        code: 'ZOTERO_UNEXPECTED',
        completedRefs: [expect.stringContaining(childOf.ROOTBBBB!)],
      },
    ])
    expect(state.get('ROOTAAAA')!.deleted).toBe(0)
    expect(state.get('ROOTBBBB')!.deleted).toBe(0)
  })

  it('stops a Trash walk when Zotero refuses the PATCH authorization', async () => {
    grantAuthorize(mock)
    const root = 'ROOTAUTH'
    mock.route('GET', `/api/users/0/items/${root}`, (_req, _res, h) => {
      h.json(itemJson(root, 9, { itemType: 'journalArticle', deleted: 0 }), batchHeaders(9))
    })
    mock.route('GET', `/api/users/0/items/${root}/children`, (_req, _res, h) => {
      h.json([], { ...batchHeaders(9), 'Total-Results': '0' })
    })
    mock.route('PATCH', `/api/users/0/items/${root}`, (_req, _res, h) => {
      h.raw(401, { 'Zotero-Server-ID': SERVER_ID }, 'Unauthorized')
    })
    const { deps } = writeDeps(mock)
    await expect(
      batchItems(deps, {
        delete: [
          {
            library: { type: 'user' as const, id: 0 },
            kind: 'item' as const,
            key: root,
            serverId: SERVER_ID,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'ZOTERO_WRITE_UNAUTHORIZED' })
  })
})
