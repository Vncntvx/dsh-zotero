import { describe, expect, it } from 'vitest'
import { getBatch } from '../../src/local/get-batch-domain.js'
import { ZoteroError } from '../../src/errors.js'
import { parseRef } from '../../src/refs.js'
import { deferred } from '../helpers/sync.js'
import type { ZoteroItemDetail } from '../../src/types.js'

const detail = (ref: string): ZoteroItemDetail => ({
  ref,
  itemType: 'journalArticle',
  title: ref,
  creators: [],
  abstractTruncated: false,
  tags: [],
  collections: [],
  children: { total: 0 },
  relations: [{ predicate: 'dc:relation', targetUri: 'https://example.test/paper' }],
})

describe('getBatch', () => {
  it('preserves input order and isolates a not-found failure', async () => {
    const refs = ['AAAA1111', 'BBBB2222', 'CCCC3333'].map((key) =>
      parseRef(`zotero://user/0/item/${key}`),
    )
    const result = await getBatch(
      async ({ ref }) => {
        if (ref.key === 'BBBB2222') throw new ZoteroError('missing', 'ZOTERO_NOT_FOUND')
        return detail(`zotero://user/0/item/${ref.key}`)
      },
      { refs },
    )
    expect(result.counts).toEqual({ requested: 3, succeeded: 2, failed: 1 })
    expect(result.items.map((item) => item.ref)).toEqual(
      refs.map((ref) => `zotero://user/0/item/${ref.key}`),
    )
    expect(result.items[1]).toMatchObject({
      status: 'error',
      code: 'ZOTERO_NOT_FOUND',
      next: expect.any(String),
    })
  })

  it('keeps optional relations out unless requested', async () => {
    const ref = parseRef('zotero://user/0/item/AAAA1111')
    const read = async () => detail('zotero://user/0/item/AAAA1111')
    const omitted = await getBatch(read, { refs: [ref] })
    const included = await getBatch(read, { refs: [ref], include: { relations: true } })
    expect(omitted.items[0]).not.toHaveProperty('item.relations')
    expect(included.items[0]).toHaveProperty('item.relations')
  })

  it('limits work to eight active reads and preserves all fifty results', async () => {
    const refs = Array.from({ length: 50 }, (_, index) =>
      parseRef(`zotero://user/0/item/${String(index).padStart(8, '0')}`),
    )
    const release = deferred<void>()
    const eightStarted = deferred<void>()
    let active = 0
    let maximumActive = 0
    const resultPromise = getBatch(
      async ({ ref }) => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        if (active === 8) eightStarted.resolve()
        await release.promise
        active -= 1
        return detail(`zotero://user/0/item/${ref.key}`)
      },
      { refs },
    )
    await eightStarted.promise
    expect(active).toBe(8)
    release.resolve()
    const result = await resultPromise
    expect(maximumActive).toBe(8)
    expect(result.items.map((item) => item.ref)).toEqual(
      refs.map((ref) => `zotero://user/0/item/${ref.key}`),
    )
  })

  it('requests child kinds when children or attachments are included', async () => {
    const requests: Array<{
      ref: unknown
      include?: ReadonlySet<string>
      locations?: string
      fields?: string
    }> = []
    const read = async (req: {
      ref: unknown
      include?: ReadonlySet<string>
      locations?: string
      fields?: string
    }) => {
      requests.push(req)
      return detail('zotero://user/0/item/AAAA1111')
    }
    const ref = parseRef('zotero://user/0/item/AAAA1111')
    await getBatch(read as never, {
      refs: [ref],
      include: { children: true, bestAttachment: true },
      fields: 'all',
    })
    expect(requests[0]).toMatchObject({
      include: new Set(['notes', 'annotations', 'attachments']),
      locations: 'best',
      fields: 'all',
    })

    await getBatch(read as never, { refs: [ref], include: { attachments: true } })
    expect(requests[1]).toMatchObject({
      include: new Set(['attachments']),
    })
  })

  it('isolates unexpected Error and string rejections as ZOTERO_UNEXPECTED', async () => {
    const refs = ['AAAA1111', 'BBBB2222'].map((key) => parseRef(`zotero://user/0/item/${key}`))
    let call = 0
    const result = await getBatch(
      async () => {
        call += 1
        if (call === 1) throw new Error('boom')
        throw 'raw failure'
      },
      { refs },
    )
    expect(result.counts).toEqual({ requested: 2, succeeded: 0, failed: 2 })
    expect(result.items[0]).toMatchObject({
      status: 'error',
      code: 'ZOTERO_UNEXPECTED',
      message: 'boom',
    })
    expect(result.items[1]).toMatchObject({
      status: 'error',
      code: 'ZOTERO_UNEXPECTED',
      message: 'raw failure',
    })
  })

  it('propagates an in-flight read that rejects after caller cancellation aborts the pool', async () => {
    const ref = parseRef('zotero://user/0/item/AAAA1111')
    const caller = new AbortController()
    const started = deferred<void>()
    const result = getBatch(
      async (_request, signal) => {
        started.resolve()
        await new Promise<void>((resolve) => {
          const onAbort = (): void => {
            signal?.removeEventListener('abort', onAbort)
            resolve()
          }
          if (signal?.aborted === true) resolve()
          else signal?.addEventListener('abort', onAbort, { once: true })
        })
        throw new Error('late failure')
      },
      { refs: [ref] },
      caller.signal,
    )
    await started.promise
    caller.abort()
    await expect(result).rejects.toThrow('late failure')
  })

  it('rejects empty, duplicate, and over-sized batches before reading', async () => {
    let reads = 0
    const read = async () => {
      reads += 1
      return detail('zotero://user/0/item/AAAA1111')
    }
    await expect(getBatch(read, { refs: [] })).rejects.toThrow('at least one')
    const ref = parseRef('zotero://user/0/item/AAAA1111')
    await expect(getBatch(read, { refs: [ref, ref] })).rejects.toThrow('unique')
    await expect(
      getBatch(read, {
        refs: Array.from({ length: 51 }, (_, i) =>
          parseRef(`zotero://user/0/item/${String(i).padStart(8, '0')}`),
        ),
      }),
    ).rejects.toThrow('at most 50')
    expect(reads).toBe(0)
  })
})
