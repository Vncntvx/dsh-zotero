import { describe, expect, it } from 'vitest'
import { approvalLane } from '../helpers/approval-stub.js'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolResult } from '@deepseek-ai/dsh-tools'
import { createCollectionPlan, renderCreateCollection } from '../../src/tools/create-collection.js'
import { deleteCollectionPlan, renderDeleteCollection } from '../../src/tools/delete-collection.js'
import { createItemPlan, renderCreateItem } from '../../src/tools/create-item.js'
import { updateItemPlan, renderUpdateItem } from '../../src/tools/update-item.js'
import {
  deleteLibraryTagsPlan,
  renderDeleteLibraryTags,
} from '../../src/tools/delete-library-tags.js'
import {
  WRITE_ITEM_NEEDS_TITLE_OR_URL_MESSAGE,
  writeItemTypeUnsupportedMessage,
} from '../../src/errors.js'

const APPLIED_COLLECTION = {
  kind: 'applied' as const,
  ref: 'zotero://user/0/collection/COLL1234?server=srv',
  key: 'COLL1234',
  version: 7,
  name: '方法论',
  libraryVersion: 7,
  serverId: 'srv',
}

const APPLIED_ITEM = {
  kind: 'applied' as const,
  ref: 'zotero://user/0/item/ITEMABC1?server=srv',
  key: 'ITEMABC1',
  version: 5,
  itemType: 'journalArticle',
  title: 'A study',
  libraryVersion: 5,
  serverId: 'srv',
}

const UNVERIFIED = {
  kind: 'committed-unverified' as const,
  committed: true as const,
  retryable: false as const,
  reason: 'commit-unknown' as const,
  serverId: 'srv',
}

function textOf(blocks: ContentBlock[]): string {
  return blocks.map((block) => (block.type === 'text' ? block.text : '')).join('\n')
}

function resultOf(meta: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text: 'x' }], isError: false, meta } as unknown as ToolResult
}

describe('collection lifecycle presentation', () => {
  it('renders the created collection with its parent and library version', () => {
    const text = textOf(renderCreateCollection({ name: '方法论' }, APPLIED_COLLECTION))
    expect(text).toContain(
      'Created collection zotero://user/0/collection/COLL1234?server=srv (version 7): 方法论.',
    )
    expect(text).toContain('Library version: 7 (served by srv)')
    const withParent = textOf(
      renderCreateCollection(
        { name: '子合集' },
        {
          ...APPLIED_COLLECTION,
          parentRef: 'zotero://user/0/collection/PARENT01',
          serverId: undefined,
        },
      ),
    )
    expect(withParent).toContain('Parent: zotero://user/0/collection/PARENT01')
    expect(withParent).toContain('Library version: 7')
    expect(withParent).not.toContain('(served by')
  })

  it('tells the model never to retry an unverified or unknown collection commit', () => {
    const unknown = textOf(
      renderCreateCollection({ name: 'x' }, { ...UNVERIFIED, key: 'COLL1234' }),
    )
    expect(unknown).toContain('may have created the collection')
    expect(unknown).toContain('Do not retry')
    expect(unknown).toContain('(key COLL1234)')
    expect(unknown).toContain('reconcile the collection by its key/ref')
    const unverified = textOf(
      renderCreateCollection({ name: 'x' }, { ...UNVERIFIED, reason: 'saved-state-unverified' }),
    )
    expect(unverified).toContain('saved state could not be verified')
    expect(unverified).toContain('Do not retry')
    const bare = textOf(renderCreateCollection({ name: 'x' }, UNVERIFIED))
    expect(bare).toContain('checking Zotero for the collection')
  })

  it('renders the declined and deleted collection outcomes', () => {
    expect(textOf(renderCreateCollection({ name: 'x' }, { kind: 'declined' }))).toContain(
      'Declined',
    )
    expect(
      textOf(
        renderDeleteCollection(
          { collection: '方法论' },
          {
            kind: 'deleted',
            ref: 'zotero://user/0/collection/COLL1234',
            key: 'COLL1234',
            deleted: true,
            libraryVersion: 9,
            serverId: 'srv',
          },
        ),
      ),
    ).toBe(
      'Deleted collection zotero://user/0/collection/COLL1234.\n' +
        'Library version: 9 (served by srv)',
    )
    expect(textOf(renderDeleteCollection({ collection: 'x' }, { kind: 'declined' }))).toContain(
      'Declined',
    )
  })

  it('builds the collection plans with the previewed blast radius', () => {
    expect(createCollectionPlan({ name: '方法论' })).toContain('- Name: 方法论')
    expect(createCollectionPlan({ name: '方法论' })).toContain('- Parent: (top level)')
    expect(createCollectionPlan({ name: '子', parent: '方法论' })).toContain('- Parent: 方法论')

    const known = deleteCollectionPlan({ collection: '方法论' }, { itemTotal: 12, childTotal: 3 })
    expect(known).toContain('- Items in this collection: 12')
    expect(known).toContain('- Child collections: 3')
    expect(known).toContain('cannot be undone')
    const unknown = deleteCollectionPlan({ collection: '方法论' })
    expect(unknown).toContain('- Items in this collection: unknown')
    expect(unknown).toContain('- Child collections: unknown')
  })

  it('projects collection outcomes into presentation meta and cards', async () => {
    const lane = await approvalLane({ writeEnabled: true })
    const create = lane.tool('zotero_create_collection')!
    expect(create.output.presentationMeta?.({}, APPLIED_COLLECTION)).toEqual({
      kind: 'applied',
      ref: APPLIED_COLLECTION.ref,
      key: APPLIED_COLLECTION.key,
      version: APPLIED_COLLECTION.version,
    })
    expect(create.output.presentationMeta?.({}, UNVERIFIED)).toEqual({
      kind: 'committed-unverified',
      reason: 'commit-unknown',
    })
    expect(create.output.presentationMeta?.({}, { ...UNVERIFIED, key: 'COLL1234' })).toEqual({
      kind: 'committed-unverified',
      reason: 'commit-unknown',
      key: 'COLL1234',
    })
    expect(create.output.presentationMeta?.({}, { kind: 'declined' })).toEqual({
      kind: 'declined',
    })
    expect(create.presentCall?.({ name: '方法论' })).toMatchObject({
      card: 'generic',
      kind: 'edit',
      title: 'Create Zotero collection',
      rawInput: '方法论',
    })
    expect(create.presentResult?.({ name: 'x' }, resultOf({ kind: 'declined' }))).toEqual({
      card: 'generic',
      title: 'Zotero collection: declined, nothing written',
    })
    expect(
      create.presentResult?.(
        { name: 'x' },
        resultOf({ kind: 'committed-unverified', reason: 'commit-unknown' }),
      ),
    ).toEqual({
      card: 'generic',
      title: 'Zotero collection outcome unknown; do not retry',
    })
    expect(
      create.presentResult?.(
        { name: 'x' },
        resultOf({ kind: 'committed-unverified', reason: 'saved-state-unverified' }),
      ),
    ).toEqual({
      card: 'generic',
      title: 'Zotero collection created but not verified; do not retry',
    })
    expect(create.presentResult?.({ name: 'x' }, resultOf({ kind: 'applied', ref: 'r' }))).toEqual({
      card: 'generic',
      title: 'Zotero collection created: r',
    })
    expect(create.presentResult?.({ name: 'x' }, resultOf({ kind: 'applied' }))).toEqual({
      card: 'generic',
      title: 'Zotero collection created',
    })

    const remove = lane.tool('zotero_delete_collection')!
    expect(
      remove.output.presentationMeta?.(
        {},
        {
          kind: 'deleted',
          ref: 'zotero://user/0/collection/COLL1234',
          key: 'COLL1234',
          deleted: true,
          libraryVersion: 9,
        },
      ),
    ).toEqual({
      kind: 'deleted',
      ref: 'zotero://user/0/collection/COLL1234',
      key: 'COLL1234',
    })
    expect(remove.output.presentationMeta?.({}, { kind: 'declined' })).toEqual({
      kind: 'declined',
    })
    expect(remove.presentCall?.({ collection: '方法论' })).toMatchObject({
      card: 'generic',
      kind: 'edit',
      title: 'Delete Zotero collection',
      rawInput: '方法论',
    })
    expect(remove.presentResult?.({ collection: 'x' }, resultOf({ kind: 'declined' }))).toEqual({
      card: 'generic',
      title: 'Zotero collection delete: declined, nothing written',
    })
    expect(
      remove.presentResult?.({ collection: 'x' }, resultOf({ kind: 'deleted', ref: 'r' })),
    ).toEqual({
      card: 'generic',
      title: 'Zotero collection deleted: r',
    })
    expect(remove.presentResult?.({ collection: 'x' }, resultOf({ kind: 'deleted' }))).toEqual({
      card: 'generic',
      title: 'Zotero collection deleted',
    })
    await lane.teardown()
  })

  it('refuses a blank collection name before any plan or network', async () => {
    const lane = await approvalLane({ writeEnabled: true })
    const blank = await lane.runTool('zotero_create_collection', { name: '   ' })
    expect(blank.isError).toBe(true)
    if (!blank.isError) throw new Error('unreachable')
    expect(blank.error.info?.code).toBe('ZOTERO_INVALID_ARGUMENT')
    await lane.teardown()
  })
})

describe('item create and update presentation', () => {
  it('renders the created item from the closed field set', () => {
    const text = textOf(renderCreateItem({ itemType: 'journalArticle' }, APPLIED_ITEM))
    expect(text).toContain(
      'Created journalArticle item zotero://user/0/item/ITEMABC1?server=srv (version 5).',
    )
    expect(text).toContain('Title: A study')
    expect(text).toContain('Library version: 5 (served by srv)')
    const bare = textOf(
      renderCreateItem(
        { itemType: 'webpage' },
        { ...APPLIED_ITEM, itemType: 'webpage', title: undefined, serverId: undefined },
      ),
    )
    expect(bare).not.toContain('Title:')
    expect(bare).not.toContain('(served by')
  })

  it('tells the model never to retry an unverified or unknown item commit', () => {
    const unknown = textOf(renderCreateItem({ itemType: 'book' }, UNVERIFIED))
    expect(unknown).toContain('may have created the item')
    expect(unknown).toContain('Do not retry')
    const withKey = textOf(
      renderCreateItem(
        { itemType: 'book' },
        { ...UNVERIFIED, reason: 'saved-state-unverified', key: 'ITEMABC1' },
      ),
    )
    expect(withKey).toContain('(key ITEMABC1)')
    expect(withKey).toContain('reconcile the item by its key/ref')
    const withRef = textOf(
      renderCreateItem({ itemType: 'book' }, { ...UNVERIFIED, ref: 'zotero://user/0/item/X' }),
    )
    expect(withRef).toContain('(ref zotero://user/0/item/X)')
    const bare = textOf(renderCreateItem({ itemType: 'book' }, UNVERIFIED))
    expect(bare).toContain('checking Zotero for the item')
    expect(textOf(renderCreateItem({ itemType: 'book' }, { kind: 'declined' }))).toContain(
      'Declined',
    )
  })

  it('renders the updated item with the changed field names', () => {
    const text = textOf(
      renderUpdateItem(
        { ref: 'r', set: { title: 'New' } },
        {
          kind: 'applied',
          ref: 'zotero://user/0/item/ITEMABC1',
          version: 11,
          changed: ['date', 'title'],
          libraryVersion: 11,
          serverId: 'srv',
        },
      ),
    )
    expect(text).toContain('Updated zotero://user/0/item/ITEMABC1 (version 11)')
    expect(text).toContain('changed date, title')
    expect(text).toContain('Library version: 11 (served by srv)')
    expect(textOf(renderUpdateItem({ ref: 'r', set: {} }, { kind: 'declined' }))).toContain(
      'Declined',
    )
  })

  it('builds the item plans from the closed field set', () => {
    const create = createItemPlan({
      itemType: 'journalArticle',
      title: 'A study',
      url: 'https://example.org',
      date: '2024',
      doi: '10.1/xyz',
      publicationTitle: 'Journal',
      creators: [{ creatorType: 'author', lastName: 'Wu' }],
    })
    expect(create).toContain('- Type: journalArticle')
    expect(create).toContain('- Title: A study')
    expect(create).toContain('- URL: https://example.org')
    expect(create).toContain('- Date: 2024')
    expect(create).toContain('- DOI: 10.1/xyz')
    expect(create).toContain('- Venue: Journal')
    expect(create).toContain('- Creators: 1 listed')
    expect(create).toContain('no BibTeX or CSL-JSON channel exists')
    const minimal = createItemPlan({ itemType: 'webpage' })
    expect(minimal).toContain('- Title: (none)')
    expect(minimal).toContain('- URL: (none)')
    expect(minimal).not.toContain('- Date:')

    const update = updateItemPlan({
      ref: 'zotero://user/0/item/ITEMABC1',
      set: { title: 'New title', date: '2025' },
    })
    expect(update).toContain('- Item: zotero://user/0/item/ITEMABC1')
    expect(update).toContain('- title: New title')
    expect(update).toContain('- date: 2025')
    expect(update).toContain('refuses the write before any PATCH')
    expect(updateItemPlan({ ref: 'r', set: {} })).not.toContain('- title:')
  })

  it('projects item outcomes into presentation meta and cards', async () => {
    const lane = await approvalLane({ writeEnabled: true })
    const create = lane.tool('zotero_create_item')!
    expect(create.output.presentationMeta?.({}, APPLIED_ITEM)).toEqual({
      kind: 'applied',
      ref: APPLIED_ITEM.ref,
      key: APPLIED_ITEM.key,
      version: APPLIED_ITEM.version,
    })
    expect(create.output.presentationMeta?.({}, { kind: 'declined' })).toEqual({
      kind: 'declined',
    })
    expect(create.presentCall?.({ itemType: 'book', title: 'T' })).toMatchObject({
      card: 'generic',
      kind: 'edit',
      title: 'Create Zotero item',
      rawInput: 'T',
    })
    expect(create.presentCall?.({ itemType: 'webpage', url: 'u' })).toMatchObject({
      rawInput: 'u',
    })
    expect(create.presentCall?.({ itemType: 'webpage' })).toMatchObject({ rawInput: 'webpage' })
    expect(create.presentResult?.({ itemType: 'book' }, resultOf({ kind: 'declined' }))).toEqual({
      card: 'generic',
      title: 'Zotero item: declined, nothing written',
    })
    expect(
      create.presentResult?.(
        { itemType: 'book' },
        resultOf({ kind: 'committed-unverified', reason: 'commit-unknown' }),
      ),
    ).toEqual({
      card: 'generic',
      title: 'Zotero item outcome unknown; do not retry',
    })
    expect(
      create.presentResult?.(
        { itemType: 'book' },
        resultOf({ kind: 'committed-unverified', reason: 'saved-state-unverified' }),
      ),
    ).toEqual({
      card: 'generic',
      title: 'Zotero item created but not verified; do not retry',
    })
    expect(
      create.presentResult?.({ itemType: 'book' }, resultOf({ kind: 'applied', ref: 'r' })),
    ).toEqual({
      card: 'generic',
      title: 'Zotero item created: r',
    })
    expect(create.presentResult?.({ itemType: 'book' }, resultOf({ kind: 'applied' }))).toEqual({
      card: 'generic',
      title: 'Zotero item created',
    })

    const update = lane.tool('zotero_update_item')!
    expect(
      update.output.presentationMeta?.(
        {},
        {
          kind: 'applied',
          ref: 'zotero://user/0/item/ITEMABC1',
          version: 11,
          changed: ['title', 'date'],
        },
      ),
    ).toEqual({
      kind: 'applied',
      ref: 'zotero://user/0/item/ITEMABC1',
      version: 11,
      changedCount: 2,
    })
    expect(update.output.presentationMeta?.({}, { kind: 'declined' })).toEqual({
      kind: 'declined',
    })
    expect(update.presentCall?.({ ref: 'r', set: { title: 'T' } })).toMatchObject({
      card: 'generic',
      kind: 'edit',
      title: 'Update Zotero item',
      rawInput: 'r',
    })
    expect(update.presentResult?.({ ref: 'r', set: {} }, resultOf({ kind: 'declined' }))).toEqual({
      card: 'generic',
      title: 'Zotero item: declined, nothing written',
    })
    expect(
      update.presentResult?.({ ref: 'r', set: {} }, resultOf({ kind: 'applied', ref: 'r' })),
    ).toEqual({
      card: 'generic',
      title: 'Zotero item updated: r',
    })
    expect(update.presentResult?.({ ref: 'r', set: {} }, resultOf({ kind: 'applied' }))).toEqual({
      card: 'generic',
      title: 'Zotero item updated',
    })
    await lane.teardown()
  })

  it('refuses an unsupported type, a fieldless item, and an empty set before the plan', async () => {
    const lane = await approvalLane({ writeEnabled: true })
    const unsupported = await lane.runTool('zotero_create_item', {
      itemType: 'film',
      title: 'T',
    })
    expect(unsupported.isError).toBe(true)
    if (!unsupported.isError) throw new Error('unreachable')
    expect(unsupported.error.message).toBe(writeItemTypeUnsupportedMessage('film'))
    const noIdentity = await lane.runTool('zotero_create_item', { itemType: 'webpage' })
    expect(noIdentity.isError).toBe(true)
    if (!noIdentity.isError) throw new Error('unreachable')
    expect(noIdentity.error.message).toBe(WRITE_ITEM_NEEDS_TITLE_OR_URL_MESSAGE)
    const emptySet = await lane.runTool('zotero_update_item', {
      ref: 'zotero://user/0/item/ITEMABC1',
      set: {},
    })
    expect(emptySet.isError).toBe(true)
    if (!emptySet.isError) throw new Error('unreachable')
    expect(emptySet.error.info?.code).toBe('ZOTERO_INVALID_ARGUMENT')
    expect(emptySet.error.message).toContain('at least one item')
    await lane.teardown()
  })
})

describe('library-wide tag deletion presentation', () => {
  it('renders the deleted tags with their library version', () => {
    const text = textOf(
      renderDeleteLibraryTags(
        { tags: ['b', 'a'] },
        { kind: 'deleted', deletedTags: ['a', 'b'], libraryVersion: 21, serverId: 'srv' },
      ),
    )
    expect(text).toContain('Deleted 2 tags library-wide: a, b.')
    expect(text).toContain('Library version: 21 (served by srv)')
    const bare = textOf(
      renderDeleteLibraryTags(
        { tags: ['a'] },
        { kind: 'deleted', deletedTags: ['a'], libraryVersion: 22 },
      ),
    )
    expect(bare).not.toContain('(served by')
    expect(textOf(renderDeleteLibraryTags({ tags: ['a'] }, { kind: 'declined' }))).toContain(
      'Declined',
    )
  })

  it('builds the plan with per-tag counts and the irreversible radius', () => {
    const known = deleteLibraryTagsPlan(
      { tags: ['methods', 'legacy'] },
      { counts: new Map([['methods', 7]]), unknown: ['legacy'] },
    )
    expect(known).toContain('- "methods": 7 items')
    expect(known).toContain('- Unmatched names (treated as no-ops): legacy')
    expect(known).toContain('cannot be undone')
    const unknown = deleteLibraryTagsPlan({ tags: ['methods'] })
    expect(unknown).toContain('- "methods": unknown items')
    expect(unknown).not.toContain('Unmatched names')
  })

  it('projects the deleted outcome into presentation meta and cards', async () => {
    const lane = await approvalLane({ writeEnabled: true })
    const remove = lane.tool('zotero_delete_library_tags')!
    expect(
      remove.output.presentationMeta?.(
        {},
        { kind: 'deleted', deletedTags: ['a', 'b'], libraryVersion: 21 },
      ),
    ).toEqual({ kind: 'deleted', deletedCount: 2 })
    expect(remove.output.presentationMeta?.({}, { kind: 'declined' })).toEqual({
      kind: 'declined',
    })
    expect(remove.presentCall?.({ tags: ['a', 'b'] })).toMatchObject({
      card: 'generic',
      kind: 'edit',
      title: 'Delete Zotero library tags',
      rawInput: 'a, b',
    })
    expect(remove.presentResult?.({ tags: ['a'] }, resultOf({ kind: 'declined' }))).toEqual({
      card: 'generic',
      title: 'Zotero tags delete: declined, nothing written',
    })
    expect(remove.presentResult?.({ tags: ['a'] }, resultOf({ kind: 'deleted' }))).toEqual({
      card: 'generic',
      title: 'Zotero library tags deleted',
    })
    expect(remove.presentResult?.({ tags: ['a'] }, { isError: false } as never)).toBeUndefined()
    await lane.teardown()
  })

  it('refuses an empty or oversized tag selection before the plan', async () => {
    const lane = await approvalLane({ writeEnabled: true })
    const empty = await lane.runTool('zotero_delete_library_tags', { tags: [] })
    expect(empty.isError).toBe(true)
    if (!empty.isError) throw new Error('unreachable')
    expect(empty.error.message).toContain('at least one item')
    const blank = await lane.runTool('zotero_delete_library_tags', { tags: ['   '] })
    expect(blank.isError).toBe(true)
    if (!blank.isError) throw new Error('unreachable')
    expect(blank.error.info?.code).toBe('ZOTERO_INVALID_ARGUMENT')
    const tooMany = await lane.runTool('zotero_delete_library_tags', {
      tags: Array.from({ length: 51 }, (_, index) => `t${index}`),
    })
    expect(tooMany.isError).toBe(true)
    if (!tooMany.isError) throw new Error('unreachable')
    expect(tooMany.error.message).toContain('more than 50 items')
    await lane.teardown()
  })
})
