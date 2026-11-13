/** Cancel, revoke, expire and dispose real owned read leases. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { artifactReadsFixture, type ArtifactReadsFixture } from './support/artifact-reads.ts'
import { deferred } from '../helpers/sync.ts'

const owned: ArtifactReadsFixture[] = []
afterEach(async () => {
  vi.useRealTimers()
  for (const host of owned.splice(0)) await host.dispose()
})
async function fixture() {
  const host = await artifactReadsFixture()
  owned.push(host)
  return host
}

describe('document read lifetime', () => {
  it('refuses admission at the count and byte limits without evicting an existing reader', async () => {
    const host = await fixture()
    host.limits({ maxOpen: 1 })
    const first = await host.open()
    await expect(host.open()).rejects.toMatchObject({ code: 'ZOTERO_PROVIDER_UNAVAILABLE' })
    expect((await host.page(first.lease)).kind).toBe('page')
    await host.release(first.requestId)
    host.limits({ maxBytes: 1 })
    await expect(host.open()).rejects.toMatchObject({ code: 'ZOTERO_PROVIDER_UNAVAILABLE' })
  })

  it('expires an abandoned opening response using a single deadline', async () => {
    const host = await fixture()
    host.limits({ idleTimeoutMs: 50, maxLifetimeMs: 100 })
    vi.useFakeTimers()
    const opened = await host.open()
    await vi.advanceTimersByTimeAsync(51)
    await expect(host.page(opened.lease)).rejects.toMatchObject({ code: 'ZOTERO_NOT_FOUND' })
  })

  it('does not extend total lifetime by repeated page requests', async () => {
    const host = await fixture()
    host.limits({ idleTimeoutMs: 80, maxLifetimeMs: 100 })
    vi.useFakeTimers()
    const opened = await host.open()
    await vi.advanceTimersByTimeAsync(60)
    await host.page(opened.lease)
    await vi.advanceTimersByTimeAsync(41)
    await expect(host.page(opened.lease)).rejects.toMatchObject({ code: 'ZOTERO_NOT_FOUND' })
  })

  it('rechecks authorization after an image read and retires a refused lease', async () => {
    const host = await fixture()
    const pending = deferred<Awaited<ReturnType<typeof host.image>>>()
    const entered = deferred<void>()
    host.image.mockImplementation(async () => {
      entered.resolve()
      return await pending.promise
    })
    const opened = await host.open()
    const read = host.call({
      sessionId: 'parse-owner',
      op: 'image',
      lease: opened.lease,
      name: opened.images[0]!.name,
    })
    const verdict = expect(read).rejects.toMatchObject({ code: 'remote-access/denied' })
    await entered.promise
    host.revoke()
    pending.resolve({ data: new Uint8Array([1, 2, 3, 4]), mediaType: 'image/png' })
    await verdict
    host.grant()
    await expect(host.page(opened.lease)).rejects.toMatchObject({ code: 'ZOTERO_NOT_FOUND' })
  })

  it('retires a lease when its Agent is removed', async () => {
    const host = await fixture()
    const opened = await host.open()
    await host.owners[0]!.unregister()
    await expect(host.page(opened.lease)).rejects.toThrow()
  })

  it('waits for accepted I/O cleanup on component disposal', async () => {
    const host = await fixture()
    const pending = deferred<string>()
    const entered = deferred<void>()
    host.reads.mockImplementation(async () => {
      entered.resolve()
      return await pending.promise
    })
    const opening = host.open()
    const rejected = expect(opening).rejects.toMatchObject({ name: 'AbortError' })
    await entered.promise
    let disposed = false
    const disposal = host.helper.dispose().then(() => {
      disposed = true
    })
    await Promise.resolve()
    expect(disposed).toBe(false)
    pending.resolve('# Snapshot')
    await rejected
    await disposal
    expect(disposed).toBe(true)
  })

  it('keeps expired I/O counted and drains it before disposal', async () => {
    const host = await fixture()
    host.limits({ maxOpen: 1, idleTimeoutMs: 50, maxLifetimeMs: 100 })
    vi.useFakeTimers()
    const pending = deferred<string>()
    const entered = deferred<void>()
    host.reads.mockImplementation(async () => {
      entered.resolve()
      return await pending.promise
    })
    const opening = host.open()
    const rejected = expect(opening).rejects.toMatchObject({ name: 'AbortError' })
    await entered.promise
    await vi.advanceTimersByTimeAsync(51)
    await expect(host.open()).rejects.toMatchObject({ code: 'ZOTERO_PROVIDER_UNAVAILABLE' })
    let disposed = false
    const disposal = host.helper.dispose().then(() => {
      disposed = true
    })
    await Promise.resolve()
    expect(disposed).toBe(false)
    pending.resolve('# Snapshot')
    await rejected
    await disposal
    expect(disposed).toBe(true)
  })
})
