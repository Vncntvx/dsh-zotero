import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import { StubApproval, approvalAsks, resetApprovalStub } from '../helpers/approval-stub.js'
import { expectValue, setupHostLane, type HostLane } from '../helpers/lanes/host-lane.js'
import type { MockZotero } from '../helpers/mock-zotero.js'
import { serveJson } from '../helpers/server/serve.js'
import { searchHit } from '../helpers/server/objects.js'

const SERVER_ID = 'srv-write-catalog-1'
const COLLECTION_KEY = 'COLL5678'
const ITEM_KEY = 'ITEMABC1'

/**
 * The plan-review channel this lane needs: one answer per ask, always
 * "Apply", with every card's markdown recorded for assertion.
 */
class ApprovingQuestions extends Service {
  readonly asks: AskUserQuestionRequest[] = []

  constructor(ctx: Context) {
    super(ctx, 'userQuestions')
  }

  async ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
    this.asks.push(request)
    return {
      answers: request.questions.map((question) => ({
        id: question.id,
        selected: ['Apply'],
      })),
    }
  }
}

const openLanes: HostLane[] = []

async function bootLane(): Promise<HostLane> {
  const lane = await setupHostLane(
    { writeEnabled: true },
    {
      compose: async (ctx) => {
        await ctx.plugin(StubApproval)
        await ctx.plugin(ApprovingQuestions)
      },
    },
  )
  openLanes.push(lane)
  return lane
}

/** The plan card the last write was shown, or undefined when nothing asked. */
function lastPlan(lane: HostLane): string {
  const scripted = lane.ctx.get('userQuestions') as unknown as ApprovingQuestions
  const ask = scripted.asks.at(-1)
  return ask?.questions[0]?.detail ?? ''
}

/** Identity ping, authorize dialog, and the two-collection listing. */
function serveCatalog(mock: MockZotero): void {
  serveJson(mock, '/api/', {}, { 'Zotero-Server-ID': SERVER_ID })
  mock.route('POST', '/api/local/authorize', (_req, res, helpers) =>
    helpers.raw(
      200,
      { 'Zotero-Server-ID': SERVER_ID },
      JSON.stringify({ key: 'R'.repeat(32), remember: true }),
    ),
  )
  serveJson(
    mock,
    '/api/users/0/collections',
    [
      { key: 'COLL1234', version: 3, data: { key: 'COLL1234', name: '方法论' } },
      { key: COLLECTION_KEY, version: 4, data: { key: COLLECTION_KEY, name: 'Second' } },
    ],
    { 'Zotero-Server-ID': SERVER_ID },
  )
  // The sibling-name check pages the top level with an honest total.
  serveJson(
    mock,
    '/api/users/0/collections/top',
    [
      { key: 'COLL1234', version: 3, data: { key: 'COLL1234', name: '方法论' } },
      { key: COLLECTION_KEY, version: 4, data: { key: COLLECTION_KEY, name: 'Second' } },
    ],
    { 'Zotero-Server-ID': SERVER_ID, 'Total-Results': '2' },
  )
}

beforeEach(() => {
  resetApprovalStub()
})

afterEach(async () => {
  for (const lane of openLanes) await lane.teardown()
  openLanes.length = 0
})

describe('zotero_create_collection', () => {
  it('creates a collection after the plan card names it', async () => {
    const lane = await bootLane()
    serveCatalog(lane.mock)
    let entry: Record<string, unknown> | undefined
    lane.mock.route('POST', '/api/users/0/collections', (_req, res, helpers) => {
      entry = JSON.parse(
        lane.mock.requests[lane.mock.requests.length - 1]?.body ?? '[]',
      )[0] as Record<string, unknown>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '50' },
        JSON.stringify({
          successful: {
            '0': {
              key: 'NEWCOLL1',
              version: 50,
              data: { key: 'NEWCOLL1', version: 50, name: 'Field notes' },
            },
          },
          success: { '0': 'NEWCOLL1' },
          unchanged: {},
          failed: {},
        }),
      )
    })
    const result = expectValue(
      await lane.runTool('zotero_create_collection', { name: 'Field notes' }),
      'zotero_create_collection',
    )
    expect(result.value).toMatchObject({
      kind: 'applied',
      key: 'NEWCOLL1',
      ref: `zotero://user/0/collection/NEWCOLL1?server=${SERVER_ID}`,
      version: 50,
      libraryVersion: 50,
    })
    expect(lastPlan(lane)).toContain('- Name: Field notes')
    expect(lastPlan(lane)).toContain('- Library: zotero://user/0')
    expect(entry).toEqual({ name: 'Field notes' })
    expect(approvalAsks.some((ask) => ask.toolName === 'zotero_create_collection')).toBe(true)
  })

  it('returns declined without writing when the plan is dismissed', async () => {
    const lane = await bootLane()
    serveCatalog(lane.mock)
    const scripted = lane.ctx.get('userQuestions') as unknown as ApprovingQuestions
    scripted.ask = async (request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> => ({
      answers: request.questions.map((question) => ({
        id: question.id,
        selected: ['Cancel'],
      })),
    })
    const result = expectValue(
      await lane.runTool('zotero_create_collection', { name: 'Field notes' }),
      'zotero_create_collection',
    )
    expect(result.value).toEqual({ kind: 'declined' })
    expect(lane.mock.requests.some((request) => request.method === 'POST')).toBe(false)
  })
})

describe('zotero_delete_collection', () => {
  it('shows the previewed blast radius, then deletes under the version precondition', async () => {
    const lane = await bootLane()
    serveCatalog(lane.mock)
    // The item-count preview: a search scoped to the collection.
    serveJson(lane.mock, `/api/users/0/collections/${COLLECTION_KEY}/items/top`, [searchHit()], {
      'Total-Results': '1',
      'Zotero-Server-ID': SERVER_ID,
    })
    // The child-collection preview: the browse under this parent.
    serveJson(lane.mock, `/api/users/0/collections/${COLLECTION_KEY}/collections`, [], {
      'Total-Results': '0',
      'Zotero-Server-ID': SERVER_ID,
    })
    // The domain's own read, carrying both the object and library versions.
    lane.mock.route('GET', `/api/users/0/collections/${COLLECTION_KEY}`, (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '30' },
        JSON.stringify({
          key: COLLECTION_KEY,
          version: 4,
          data: { key: COLLECTION_KEY, version: 4, name: 'Second' },
        }),
      ),
    )
    lane.mock.route('DELETE', `/api/users/0/collections/${COLLECTION_KEY}`, (_req, res, helpers) =>
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '31' }, ''),
    )
    const result = expectValue(
      await lane.runTool('zotero_delete_collection', {
        collection: `zotero://user/0/collection/${COLLECTION_KEY}`,
      }),
      'zotero_delete_collection',
    )
    expect(result.value).toEqual({
      kind: 'deleted',
      ref: `zotero://user/0/collection/${COLLECTION_KEY}?server=${SERVER_ID}`,
      key: COLLECTION_KEY,
      deleted: true,
      libraryVersion: 31,
      serverId: SERVER_ID,
    })
    const plan = lastPlan(lane)
    expect(plan).toContain('- Items in this collection: 1 (they stay in the library')
    expect(plan).toContain('- Child collections: 0 (they are deleted with the parent)')
    expect(plan).toContain('cannot be undone')
    const deleted = lane.mock.requests.find((request) => request.method === 'DELETE')
    expect(deleted?.headers['if-unmodified-since-version']).toBe('30')
  })

  it('leaves the preview counts unknown when the preview reads fail', async () => {
    const lane = await bootLane()
    serveCatalog(lane.mock)
    // Only the domain's read and delete answer; the preview reads do not.
    lane.mock.route('GET', `/api/users/0/collections/${COLLECTION_KEY}`, (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '30' },
        JSON.stringify({
          key: COLLECTION_KEY,
          version: 4,
          data: { key: COLLECTION_KEY, version: 4, name: 'Second' },
        }),
      ),
    )
    lane.mock.route('DELETE', `/api/users/0/collections/${COLLECTION_KEY}`, (_req, res, helpers) =>
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '31' }, ''),
    )
    const result = expectValue(
      await lane.runTool('zotero_delete_collection', { collection: 'Second' }),
      'zotero_delete_collection',
    )
    expect(result.value).toMatchObject({ kind: 'deleted', key: COLLECTION_KEY })
    expect(lastPlan(lane)).toContain('- Items in this collection: unknown')
    expect(lastPlan(lane)).toContain('- Child collections: unknown')
  })
})

describe('zotero_create_item', () => {
  it('creates the item from the closed field set after the plan card', async () => {
    const lane = await bootLane()
    serveCatalog(lane.mock)
    let entry: Record<string, unknown> | undefined
    lane.mock.route('POST', '/api/users/0/items', (_req, res, helpers) => {
      entry = JSON.parse(
        lane.mock.requests[lane.mock.requests.length - 1]?.body ?? '[]',
      )[0] as Record<string, unknown>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '60' },
        JSON.stringify({
          successful: {
            '0': {
              key: 'NEWITEM1',
              version: 60,
              data: {
                key: 'NEWITEM1',
                version: 60,
                itemType: 'journalArticle',
                title: 'A study',
              },
            },
          },
          success: { '0': 'NEWITEM1' },
          unchanged: {},
          failed: {},
        }),
      )
    })
    const result = expectValue(
      await lane.runTool('zotero_create_item', {
        itemType: 'journalArticle',
        title: 'A study',
        doi: '10.1/xyz',
      }),
      'zotero_create_item',
    )
    expect(result.value).toMatchObject({
      kind: 'applied',
      key: 'NEWITEM1',
      itemType: 'journalArticle',
      libraryVersion: 60,
    })
    expect(lastPlan(lane)).toContain('- Type: journalArticle')
    expect(lastPlan(lane)).toContain('- Title: A study')
    expect(lastPlan(lane)).toContain('no BibTeX or CSL-JSON channel exists')
    expect(entry).toMatchObject({ itemType: 'journalArticle', title: 'A study', DOI: '10.1/xyz' })
  })
})

describe('zotero_update_item', () => {
  it('patches the requested fields under the item version precondition', async () => {
    const lane = await bootLane()
    serveCatalog(lane.mock)
    lane.mock.route('GET', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) =>
      helpers.raw(
        200,
        { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '10' },
        JSON.stringify({
          key: ITEM_KEY,
          version: 10,
          data: {
            key: ITEM_KEY,
            version: 10,
            itemType: 'journalArticle',
            tags: [],
            collections: [],
          },
        }),
      ),
    )
    serveJson(
      lane.mock,
      '/api/itemTypeFields',
      ['title', 'date', 'DOI', 'url', 'abstractNote', 'publicationTitle', 'extra'].map((field) => ({
        field,
        itemType: 'journalArticle',
        localized: field,
      })),
      { 'Zotero-Server-ID': SERVER_ID },
    )
    let body: Record<string, unknown> | undefined
    lane.mock.route('PATCH', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) => {
      body = JSON.parse(lane.mock.requests[lane.mock.requests.length - 1]?.body ?? '{}') as Record<
        string,
        unknown
      >
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '21' }, '')
    })
    const result = expectValue(
      await lane.runTool('zotero_update_item', {
        ref: `zotero://user/0/item/${ITEM_KEY}`,
        set: { title: 'New title' },
      }),
      'zotero_update_item',
    )
    expect(result.value).toEqual({
      kind: 'applied',
      ref: `zotero://user/0/item/${ITEM_KEY}?server=${SERVER_ID}`,
      version: 21,
      changed: ['title'],
      libraryVersion: 21,
      serverId: SERVER_ID,
    })
    expect(lastPlan(lane)).toContain('- title: New title')
    expect(body).toEqual({ title: 'New title' })
    const patch = lane.mock.requests.find((request) => request.method === 'PATCH')
    expect(patch?.headers['if-unmodified-since-version']).toBe('10')

    // The field set for one (instance, item type) is fetched once and
    // memoized: the second update of the same type re-reads the item and
    // re-patches, but never re-asks for the field list.
    lane.mock.route('PATCH', `/api/users/0/items/${ITEM_KEY}`, (_req, res, helpers) => {
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '22' }, '')
    })
    expectValue(
      await lane.runTool('zotero_update_item', {
        ref: `zotero://user/0/item/${ITEM_KEY}`,
        set: { title: 'Second title' },
      }),
      'zotero_update_item',
    )
    expect(
      lane.mock.requests.filter((request) => request.pathname === '/api/itemTypeFields'),
    ).toHaveLength(1)
    expect(lane.mock.requests.filter((request) => request.method === 'PATCH')).toHaveLength(2)
  })
})

describe('zotero_delete_library_tags', () => {
  it('states each tag’s item count, then deletes under the library version', async () => {
    const lane = await bootLane()
    serveCatalog(lane.mock)
    // The preview listing: tags with their item counts.
    serveJson(
      lane.mock,
      '/api/users/0/items/top/tags',
      [
        { tag: 'methods', numItems: 7 },
        { tag: 'legacy', numItems: 3 },
      ],
      { 'Total-Results': '2', 'Zotero-Server-ID': SERVER_ID },
    )
    // The library-version read the delete's precondition comes from.
    serveJson(lane.mock, '/api/users/0/items/top', [], {
      'Zotero-Server-ID': SERVER_ID,
      'Last-Modified-Version': '88',
    })
    lane.mock.route('DELETE', '/api/users/0/tags', (_req, res, helpers) =>
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '89' }, ''),
    )
    const result = expectValue(
      await lane.runTool('zotero_delete_library_tags', { tags: ['methods', 'legacy'] }),
      'zotero_delete_library_tags',
    )
    expect(result.value).toEqual({
      kind: 'deleted',
      deletedTags: ['legacy', 'methods'],
      libraryVersion: 89,
      serverId: SERVER_ID,
    })
    const plan = lastPlan(lane)
    expect(plan).toContain('- "methods": 7 items')
    expect(plan).toContain('- "legacy": 3 items')
    expect(plan).toContain('cannot be undone')
    const deleted = lane.mock.requests.find((request) => request.method === 'DELETE')
    expect(deleted?.headers['if-unmodified-since-version']).toBe('88')
    expect(deleted?.search.get('tag')).toBe('methods||legacy')
  })

  it('leaves the counts unknown when the preview listing fails, and names unmatched tags', async () => {
    const lane = await bootLane()
    serveCatalog(lane.mock)
    // The preview listing answers without its Total-Results header, so the
    // preview gives up; the write path itself still reads a version.
    serveJson(lane.mock, '/api/users/0/items/top/tags', [], { 'Zotero-Server-ID': SERVER_ID })
    serveJson(lane.mock, '/api/users/0/items/top', [], {
      'Zotero-Server-ID': SERVER_ID,
      'Last-Modified-Version': '88',
    })
    lane.mock.route('DELETE', '/api/users/0/tags', (_req, res, helpers) =>
      helpers.raw(204, { 'Zotero-Server-ID': SERVER_ID, 'Last-Modified-Version': '89' }, ''),
    )
    const result = expectValue(
      await lane.runTool('zotero_delete_library_tags', { tags: ['absent'] }),
      'zotero_delete_library_tags',
    )
    expect(result.value).toMatchObject({ kind: 'deleted', deletedTags: ['absent'] })
    expect(lastPlan(lane)).toContain('- "absent": unknown items')
  })
})
