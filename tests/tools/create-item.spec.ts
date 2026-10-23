/**
 * `zotero_create_item`, the closed field set: nothing outside
 * `itemType` + title/url/date/doi/abstractNote/publicationTitle/creators
 * leaves the module, so the spec pins every refusal the argument layer
 * issues before a request exists, the plan it shows, the receipt arms, and
 * the presentation projections that name an unverified commit.
 * @module tests/tools/create-item
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ToolDefinition, ToolResult } from '@deepseek-ai/dsh-tools'
import { expectValue, type HostLane, setupHostLane } from '../helpers/lanes/host-lane.js'
import { ApprovingQuestions, resetApprovalStub, StubApproval } from '../helpers/approval-stub.js'
import {
  batchBody,
  batchHeaders,
  COLLECTION_KEY,
  SERVER_ID,
} from '../helpers/write-domain-fixtures.js'
import {
  WRITE_ITEM_NEEDS_TITLE_OR_URL_MESSAGE,
  writeNonBlankMessage,
  writeItemTypeUnsupportedMessage,
} from '../../src/errors.js'
import { createItemPlan } from '../../src/tools/create-item.js'
import { ZOTERO_CREATABLE_ITEM_TYPES } from '../../src/types.js'

const NEW_KEY = 'NEWITEM1'
const COLLECTION_REF = `zotero://user/0/collection/${COLLECTION_KEY}`

let lane: HostLane

beforeEach(async () => {
  resetApprovalStub()
  lane = await setupHostLane(
    { writeEnabled: true },
    {
      compose: async (ctx) => {
        await ctx.plugin(StubApproval)
        await ctx.plugin(ApprovingQuestions)
      },
    },
  )
})

afterEach(async () => {
  await lane.teardown()
})

/** The registered definition, or a loud failure naming the missing tool. */
function definition(name: string): ToolDefinition {
  const tool = lane.tool(name)
  if (tool === undefined) throw new Error(`tool ${name} not registered`)
  return tool
}

/** The model-facing text of a refused call. */
async function refusal(args: Record<string, unknown>): Promise<string> {
  const result = await lane.runTool('zotero_create_item', args)
  if (!result.isError) throw new Error('expected the call to be refused')
  return (result.content[0] as { text: string }).text
}

/** A settled result carrying the given presentation meta. */
function ok(meta: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: 'x' }],
    isError: false,
    meta: meta as ToolResult['meta'],
  }
}

describe('zotero_create_item argument refusals', () => {
  it('refuses an item type outside the closed set before any request', async () => {
    expect(await refusal({ itemType: 'podcast', title: 'A study' })).toContain(
      writeItemTypeUnsupportedMessage('podcast'),
    )
    expect(lane.mock.requests).toHaveLength(0)
  })

  it('names every type the closed set does admit', async () => {
    // The closed set is the whole intake surface; a type that quietly stops
    // being creatable is a doc-drift bug, so the refusal names the set.
    for (const itemType of ZOTERO_CREATABLE_ITEM_TYPES) {
      expect(itemType).toBeTypeOf('string')
    }
    const message = await refusal({ itemType: 'podcast' })
    for (const itemType of ZOTERO_CREATABLE_ITEM_TYPES) expect(message).toContain(itemType)
  })

  it('refuses a call carrying neither a title nor a url', async () => {
    expect(await refusal({ itemType: 'journalArticle', date: '2026' })).toContain(
      WRITE_ITEM_NEEDS_TITLE_OR_URL_MESSAGE,
    )
    expect(lane.mock.requests).toHaveLength(0)
  })

  it('refuses blank optional fields the schema let through', async () => {
    expect(await refusal({ itemType: 'book', title: 'A study', date: '   ' })).toContain(
      writeNonBlankMessage('date'),
    )
    expect(await refusal({ itemType: 'book', url: 'https://example.org', doi: '  ' })).toContain(
      writeNonBlankMessage('doi'),
    )
    expect(lane.mock.requests).toHaveLength(0)
  })

  it('refuses creators it cannot express', async () => {
    expect(
      await refusal({
        itemType: 'book',
        title: 'A study',
        creators: [{ creatorType: '  ' }],
      }),
    ).toContain(writeNonBlankMessage('creators[0].creatorType'))
    expect(
      await refusal({
        itemType: 'book',
        title: 'A study',
        creators: [{ creatorType: 'author' }],
      }),
    ).toContain('creators[0] must carry a name or a firstName/lastName pair')
    expect(lane.mock.requests).toHaveLength(0)
  })
})

describe('createItemPlan', () => {
  it('states the closed field set with every supplied field', () => {
    const plan = createItemPlan({
      itemType: 'journalArticle',
      title: '  A study  ',
      url: ' https://example.org ',
      date: ' 2026 ',
      doi: ' 10.1/example ',
      publicationTitle: ' Journal of Tests ',
      creators: [{ creatorType: 'author', name: 'Doe, Jane' }],
    })
    expect(plan).toContain('- Type: journalArticle')
    expect(plan).toContain('- Title: A study')
    expect(plan).toContain('- URL: https://example.org')
    expect(plan).toContain('- Date: 2026')
    expect(plan).toContain('- DOI: 10.1/example')
    expect(plan).toContain('- Venue: Journal of Tests')
    expect(plan).toContain('- Creators: 1 listed')
    expect(plan).toContain(
      'Only the closed field set is stored; no BibTeX or CSL-JSON channel exists.',
    )
  })

  it('names the absent optional fields instead of implying they were sent', () => {
    const plan = createItemPlan({ itemType: 'webpage', url: 'https://example.org' })
    expect(plan).toContain('- Title: (none)')
    expect(plan).toContain('- URL: https://example.org')
    expect(plan).not.toContain('- Date:')
    expect(plan).not.toContain('- DOI:')
    expect(plan).not.toContain('- Venue:')
    expect(plan).not.toContain('- Creators:')
  })

  it('lists tags and collections, and their empty arms, without inventing either', () => {
    const withLists = createItemPlan({
      itemType: 'book',
      title: 'A book',
      tags: ['attention', 'reading-list'],
      collections: [COLLECTION_REF],
    })
    expect(withLists).toContain('- Tags: attention, reading-list')
    expect(withLists).toContain(`- Collections: ${COLLECTION_REF}`)

    const empty = createItemPlan({ itemType: 'book', title: 'A book', tags: [], collections: [] })
    expect(empty).toContain('- Tags: (none)')
    expect(empty).toContain('- Collections: (none)')
  })
})

describe('zotero_create_item execution', () => {
  /** The single item entry the last `POST /items` carried. */
  function postedEntry(): Record<string, unknown> {
    const post = lane.mock.requests.find(
      (request) => request.method === 'POST' && request.pathname === '/api/users/0/items',
    )
    return (JSON.parse(post?.body ?? '[]') as Record<string, unknown>[])[0]!
  }

  /** Identity ping, the grant the write key comes from, and one collection to resolve. */
  function serveIdentityAndDirectory(): void {
    lane.mock.route('GET', '/api/', (_req, _res, h) =>
      h.json({}, { 'Zotero-Server-ID': SERVER_ID }),
    )
    lane.mock.route('POST', '/api/local/authorize', (_req, _res, h) =>
      h.json({ key: 'K'.repeat(32), remember: true }, { 'Zotero-Server-ID': SERVER_ID }),
    )
    lane.mock.route('GET', '/api/users/0/collections', (_req, _res, h) =>
      h.json([{ key: COLLECTION_KEY, version: 3, data: { key: COLLECTION_KEY, name: 'Reading' } }]),
    )
  }

  it('creates with the whole field set and reports only what the server echoed', async () => {
    serveIdentityAndDirectory()
    lane.mock.route('POST', '/api/users/0/items', (_req, _res, h) => {
      const entry = postedEntry()
      return h.raw(
        200,
        batchHeaders(42),
        batchBody(NEW_KEY, 42, {
          itemType: entry.itemType,
          title: entry.title,
          tags: entry.tags,
          collections: entry.collections,
        }),
      )
    })

    const result = expectValue(
      await lane.runTool('zotero_create_item', {
        itemType: 'journalArticle',
        title: 'Attention is all you need',
        date: '2017',
        doi: '10.5555/example',
        abstractNote: 'A transformer.',
        publicationTitle: 'NeurIPS',
        creators: [{ creatorType: 'author', name: 'Vaswani, Ashish' }],
        tags: ['attention', 'transformer'],
        collections: [COLLECTION_REF],
      }),
      'zotero_create_item',
    )
    expect(result.value).toMatchObject({
      kind: 'applied',
      key: NEW_KEY,
      version: 42,
      itemType: 'journalArticle',
      title: 'Attention is all you need',
      tags: ['attention', 'transformer'],
      collections: [`${COLLECTION_REF}?server=${SERVER_ID}`],
      libraryVersion: 42,
      serverId: SERVER_ID,
    })

    expect(postedEntry()).toMatchObject({
      itemType: 'journalArticle',
      DOI: '10.5555/example',
      publicationTitle: 'NeurIPS',
      tags: [{ tag: 'attention' }, { tag: 'transformer' }],
      collections: [COLLECTION_KEY],
      creators: [{ creatorType: 'author', name: 'Vaswani, Ashish' }],
    })
  })

  it('does not claim tags or collections the server did not echo', async () => {
    serveIdentityAndDirectory()
    lane.mock.route('POST', '/api/users/0/items', (_req, _res, h) =>
      // An echo whose tag rows are malformed: the write landed, but no proof
      // of its tag/collection state exists, so the result must not invent one.
      h.raw(
        200,
        batchHeaders(42),
        batchBody(NEW_KEY, 42, {
          itemType: 'journalArticle',
          title: 'Attention is all you need',
          tags: [{ tag: '' }],
          collections: [],
        }),
      ),
    )

    const result = await lane.runTool('zotero_create_item', {
      itemType: 'journalArticle',
      title: 'Attention is all you need',
      tags: ['attention'],
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('unreachable')
    expect(result.value).toMatchObject({ kind: 'committed-unverified' })
  })
})

describe('zotero_create_item presentation', () => {
  const tool = (): ToolDefinition => definition('zotero_create_item')

  it('renders each receipt arm, including both unverified reasons', () => {
    const args = { itemType: 'book' }
    expect(tool().output.render(args, { kind: 'declined' })[0]).toEqual({
      type: 'text',
      text: 'Declined: the user answered the plan without approving. Nothing was written.',
    })
    const commitUnknown = tool().output.render(args, {
      kind: 'committed-unverified',
      committed: true,
      retryable: false,
      reason: 'commit-unknown',
      serverId: 'srv-x',
    })[0] as { text: string }
    expect(commitUnknown.text).toContain('did not prove the outcome')
    expect(commitUnknown.text).toContain('reconcile by checking Zotero for the item')
    const unverified = tool().output.render(args, {
      kind: 'committed-unverified',
      committed: true,
      retryable: false,
      reason: 'saved-state-unverified',
      key: 'ITEMABC1',
      serverId: 'srv-x',
    })[0] as { text: string }
    expect(unverified.text).toContain('could not be verified')
    expect(unverified.text).toContain('key ITEMABC1')
    expect(unverified.text).toContain('reconcile the item by its key/ref')
    const applied = tool().output.render(args, {
      kind: 'applied',
      ref: 'zotero://user/0/item/ITEMABC1',
      key: 'ITEMABC1',
      version: 3,
      itemType: 'book',
      title: 'A study',
      libraryVersion: 42,
      serverId: 'srv-x',
    })[0] as { text: string }
    expect(applied.text).toContain('Created book item zotero://user/0/item/ITEMABC1 (version 3)')
    expect(applied.text).toContain('(served by srv-x)')
  })

  it('names the card for every settle state', () => {
    const present = tool().presentResult!
    expect(present({ itemType: 'book' }, ok({ kind: 'declined' }))).toEqual({
      card: 'generic',
      title: 'Zotero item: declined, nothing written',
    })
    expect(
      present({ itemType: 'book' }, ok({ kind: 'committed-unverified', reason: 'commit-unknown' })),
    ).toEqual({ card: 'generic', title: 'Zotero item outcome unknown; do not retry' })
    expect(
      present(
        { itemType: 'book' },
        ok({ kind: 'committed-unverified', reason: 'saved-state-unverified' }),
      ),
    ).toEqual({ card: 'generic', title: 'Zotero item created but not verified; do not retry' })
    expect(present({ itemType: 'book' }, ok({ kind: 'applied', ref: 'r' }))).toEqual({
      card: 'generic',
      title: 'Zotero item created: r',
    })
    // A meta record with no recognizable kind still names a creation the
    // generic card cannot: the tool keeps the plain card title.
    expect(present({ itemType: 'book' }, ok({}))).toEqual({
      card: 'generic',
      title: 'Zotero item created',
    })
    // Error and non-object meta are the only ways to no-claim: the generic
    // card takes over rather than repeating a title the meta never earned.
    expect(
      present(
        { itemType: 'book' },
        {
          content: [{ type: 'text', text: 'Error' }],
          isError: true,
        },
      ),
    ).toBeUndefined()
    expect(present({ itemType: 'book' }, ok('loose meta'))).toBeUndefined()
  })

  it('projects the meta the card reads, and never an unverified one as applied', () => {
    const meta = tool().output.presentationMeta!
    expect(meta({ itemType: 'book' }, { kind: 'applied', ref: 'r', key: 'k', version: 3 })).toEqual(
      {
        kind: 'applied',
        ref: 'r',
        key: 'k',
        version: 3,
      },
    )
    expect(
      meta(
        { itemType: 'book' },
        { kind: 'committed-unverified', reason: 'commit-unknown', key: 'k' },
      ),
    ).toEqual({
      kind: 'committed-unverified',
      committed: true,
      retryable: false,
      reason: 'commit-unknown',
      key: 'k',
    })
    expect(
      meta(
        { itemType: 'book' },
        { kind: 'committed-unverified', reason: 'saved-state-unverified' },
      ),
    ).toEqual({
      kind: 'committed-unverified',
      committed: true,
      retryable: false,
      reason: 'saved-state-unverified',
    })
    expect(meta({ itemType: 'book' }, { kind: 'declined' })).toEqual({ kind: 'declined' })
  })

  it('offers the pending card with the title, falling back to the url', () => {
    expect(
      definition('zotero_create_item').presentCall!({ itemType: 'book', title: 'A study' }),
    ).toMatchObject({
      card: 'generic',
      kind: 'edit',
      title: 'Create Zotero item',
      rawInput: 'A study',
    })
    expect(
      definition('zotero_create_item').presentCall!({
        itemType: 'webpage',
        url: 'https://example.org',
      }),
    ).toMatchObject({ rawInput: 'https://example.org' })
    expect(definition('zotero_create_item').presentCall!({ itemType: 'book' })).toMatchObject({
      rawInput: 'book',
    })
  })
})
