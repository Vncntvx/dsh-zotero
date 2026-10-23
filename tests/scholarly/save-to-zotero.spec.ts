/**
 * `scholarly_save_to_zotero`: the cross-component write bridge — it assembles
 * a `ZoteroCreateItemRequest` from a scholarly result, goes through the
 * normal approval seam, and reports the applied / declined / unverified arms.
 * The Zotero side is a stub: this spec pins the bridge's own mapping, not the
 * write domain it delegates to.
 * @module tests/scholarly/save-to-zotero
 */

import { describe, expect, it } from 'vitest'
import type { ZoteroServiceLike } from '../../src/scholarly/zotero-link.js'
import { renderScholarlySave } from '../../src/scholarly/tools/save-to-zotero.js'
import { createScholarlySaveToZoteroTool } from '../../src/scholarly/tools/index.js'
import { EXEC_CONTEXT, createMockHost, createMockHttp } from './fixtures.js'

/** A stub Zotero service that records the request and settles with `outcome`. */
function stubZotero(outcome: unknown): {
  service: ZoteroServiceLike
  requests: unknown[]
  plans: string[]
} {
  const requests: unknown[] = []
  const plans: string[] = []
  return {
    service: {
      createItem: async (request: unknown, call: { plan: string }) => {
        requests.push(request)
        plans.push(call.plan)
        return outcome
      },
    } as unknown as ZoteroServiceLike,
    requests,
    plans,
  }
}

function toolWith(zotero?: ZoteroServiceLike) {
  return createScholarlySaveToZoteroTool(
    createMockHost(
      createMockHttp(() => new Response('{}')),
      zotero,
    ),
  )
}

describe('scholarly_save_to_zotero', () => {
  it('refuses when the Zotero write component is absent or disabled', async () => {
    await expect(
      toolWith(undefined).execute({ title: 'A study' }, EXEC_CONTEXT as never),
    ).rejects.toThrow('The local Zotero write component is unavailable or disabled.')
  })

  it('maps every field into the create request and reports the applied ref', async () => {
    const stub = stubZotero({
      kind: 'applied',
      ref: 'zotero://user/0/item/SAVED001?server=srv-scholarly',
      key: 'SAVED001',
      version: 12,
      itemType: 'journalArticle',
      libraryVersion: 12,
    })
    const result = (await toolWith(stub.service).execute(
      {
        title: '  Attention Is All You Need  ',
        authors: ['Ashish Vaswani', 'Plato'],
        year: 2017,
        doi: ' 10.48550/arXiv.1706.03762 ',
        url: ' https://arxiv.org/abs/1706.03762 ',
        abstract: 'The dominant sequence transduction models…',
        publicationTitle: 'NeurIPS',
        tags: ['attention'],
        collections: ['Reading'],
      },
      EXEC_CONTEXT as never,
    )) as Parameters<typeof renderScholarlySave>[1]
    expect(renderScholarlySave({}, result)).toContainEqual({
      type: 'text',
      text: expect.stringContaining('zotero://user/0/item/SAVED001?server=srv-scholarly'),
    })
    expect(result.kind).toBe('applied')
    if (result.kind !== 'applied') throw new Error('expected saved result')
    expect(result.papers).toEqual([
      {
        ref: 'zotero://user/0/item/SAVED001?server=srv-scholarly',
        key: 'SAVED001',
        title: 'Attention Is All You Need',
        doi: '10.48550/arXiv.1706.03762',
      },
    ])
    expect(stub.requests).toEqual([
      {
        itemType: 'journalArticle',
        title: 'Attention Is All You Need',
        url: 'https://arxiv.org/abs/1706.03762',
        date: '2017',
        doi: '10.48550/arXiv.1706.03762',
        abstractNote: 'The dominant sequence transduction models…',
        publicationTitle: 'NeurIPS',
        creators: [
          {
            creatorType: 'author',
            firstName: 'Ashish',
            lastName: 'Vaswani',
          },
          { creatorType: 'author', name: 'Plato' },
        ],
        tags: ['attention'],
        collections: ['Reading'],
      },
    ])
    // The plan names the reviewed facts a reader checks before approving.
    expect(stub.plans[0]).toContain('- Title: Attention Is All You Need')
    expect(stub.plans[0]).toContain('- Authors: 2')
    expect(stub.plans[0]).toContain('- Tags: attention')
    expect(stub.plans[0]).toContain('- Collections: Reading')
  })

  it('reports the declined and unverified arms without inventing a save', async () => {
    const declined = stubZotero({ kind: 'declined' })
    const declinedResult = (await toolWith(declined.service).execute(
      { title: 'A study' },
      EXEC_CONTEXT as never,
    )) as Parameters<typeof renderScholarlySave>[1]
    expect(declinedResult).toEqual({ kind: 'declined' })

    const unverified = stubZotero({
      kind: 'committed-unverified',
      committed: true,
      retryable: false,
      reason: 'commit-unknown',
      serverId: 'srv-scholarly',
    })
    const unverifiedResult = (await toolWith(unverified.service).execute(
      { title: 'A study' },
      EXEC_CONTEXT as never,
    )) as Parameters<typeof renderScholarlySave>[1]
    expect(unverifiedResult).toMatchObject({
      kind: 'committed-unverified',
      retryable: false,
      reason: 'commit-unknown',
    })
    expect(renderScholarlySave({}, unverifiedResult)).toContainEqual({
      type: 'text',
      text: expect.stringContaining('Do not retry'),
    })
    expect(unverifiedResult).not.toHaveProperty('papers')
  })

  it('omits the optional halves a bare result does not carry', async () => {
    const stub = stubZotero({
      kind: 'applied',
      ref: 'zotero://user/0/item/SAVED002?server=srv-scholarly',
      key: 'SAVED002',
      version: 2,
      itemType: 'journalArticle',
      libraryVersion: 2,
    })
    await toolWith(stub.service).execute({ title: 'Bare' }, EXEC_CONTEXT as never)
    expect(stub.requests).toEqual([{ itemType: 'journalArticle', title: 'Bare' }])
    expect(stub.plans[0]).toContain('- DOI: (none)')
    expect(stub.plans[0]).toContain('- Authors: 0')
    expect(stub.plans[0]).toContain('- Tags: (none)')
    expect(stub.plans[0]).toContain('- Collections: (none)')
  })

  it('refuses an uncreatable item type before any write', async () => {
    const stub = stubZotero({ kind: 'declined' })
    await expect(
      toolWith(stub.service).execute({ title: 'A study', itemType: 'note' }, EXEC_CONTEXT as never),
    ).rejects.toThrow()
    expect(stub.requests).toHaveLength(0)
  })

  it('offers the pending card naming the requested title', () => {
    const tool = toolWith(undefined)
    expect(tool.presentCall!({ title: 'A study' })).toEqual({
      card: 'generic',
      title: 'Save scholarly result to Zotero',
      rawInput: 'A study',
      kind: 'edit',
    })
  })
})
