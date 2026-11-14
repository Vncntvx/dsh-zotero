/** A read lease fixes one source generation and one immutable store candidate. */
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { ZOTERO_ARTIFACT_PAGE_CHARS } from '../../src/contract.ts'
import {
  artifactReadsFixture,
  requirePage,
  type ArtifactReadsFixture,
} from './support/artifact-reads.ts'
import { parseRequest } from './support/enrichment-parse-jobs.ts'

const owned: ArtifactReadsFixture[] = []
afterEach(async () => {
  for (const host of owned.splice(0)) await host.dispose()
})
async function fixture(text?: string, images?: number) {
  const host = await artifactReadsFixture(text, images)
  owned.push(host)
  return host
}

describe('source-bound document snapshots', () => {
  it('reads the source and Markdown once for all pages and images', async () => {
    const text = 'x'.repeat(ZOTERO_ARTIFACT_PAGE_CHARS * 3) + 'tail'
    const host = await fixture(text, 12)
    const opened = await host.open()
    for (
      let offset = ZOTERO_ARTIFACT_PAGE_CHARS;
      offset < text.length;
      offset += ZOTERO_ARTIFACT_PAGE_CHARS
    )
      expect(requirePage(await host.page(opened.lease, offset))).toBe(
        text.slice(offset, offset + ZOTERO_ARTIFACT_PAGE_CHARS),
      )
    for (const image of opened.images)
      await host.call({
        sessionId: 'parse-owner',
        op: 'image',
        lease: opened.lease,
        name: image.name,
      })
    expect(host.lookup).toHaveBeenCalledOnce()
    expect(host.reads).toHaveBeenCalledOnce()
    expect(host.image).toHaveBeenCalledTimes(12)
    await host.release(opened.requestId)
    await expect(host.page(opened.lease)).rejects.toMatchObject({ code: 'ZOTERO_NOT_FOUND' })
  })

  it('keeps the old generation while a new source pointer and directory are published', async () => {
    const host = await fixture('old body')
    const first = await host.open()
    host.config.value = { ...host.config.value, outputDir: '/another/root' }
    host.lookup.mockResolvedValue({
      ...host.candidate,
      metadata: { ...host.candidate.metadata, artifactId: 'd'.repeat(64) },
      read: async () => 'new body',
    })
    const second = await host.open()
    expect(requirePage(await host.page(first.lease))).toBe('old body')
    expect(requirePage(await host.page(second.lease))).toBe('new body')
    expect(second.artifactId).not.toBe(first.artifactId)
  })

  it('does not let another peer or session borrow a lease', async () => {
    const host = await fixture()
    const opened = await host.open()
    await expect(
      host.page(opened.lease, 0, host.guestContext('documentArtifact')),
    ).rejects.toMatchObject({ code: 'ZOTERO_NOT_FOUND' })
    await expect(
      host.call({ sessionId: 'parse-other', op: 'page', lease: opened.lease, offset: 0 }),
    ).rejects.toMatchObject({ code: 'remote-access/denied' })
    expect(requirePage(await host.page(opened.lease))).toBe('# Snapshot')
  })

  it('joins the same request id and rejects changed targets', async () => {
    const host = await fixture()
    const requestId = randomUUID()
    const [a, b] = await Promise.all([host.open(requestId), host.open(requestId)])
    expect(a.lease).toBe(b.lease)
    expect(host.lookup).toHaveBeenCalledOnce()
    await expect(
      host.call({
        sessionId: 'parse-owner',
        op: 'open',
        requestId,
        target: { kind: 'url', url: 'https://example.org/other.pdf' },
      }),
    ).rejects.toMatchObject({ code: 'ZOTERO_INVALID_ARGUMENT' })
  })

  it('makes release idempotent and prevents a late open from resurrecting a released request', async () => {
    const host = await fixture()
    const requestId = randomUUID()
    await host.release(requestId)
    await host.release(requestId)
    await expect(host.open(requestId)).rejects.toMatchObject({ code: 'ZOTERO_NOT_FOUND' })
    expect(host.lookup).not.toHaveBeenCalled()
  })

  it('inspects metadata without reading the Markdown', async () => {
    const host = await fixture()
    const result = await host.call({
      sessionId: 'parse-owner',
      op: 'inspect',
      target: parseRequest().target,
    })
    expect(result).toMatchObject({ kind: 'ready', characterCount: 10 })
    expect(host.reads).not.toHaveBeenCalled()
  })

  it('answers the lease-free meta arm and the batched probe without opening a lease', async () => {
    const host = await fixture()
    const meta = await host.call({
      sessionId: 'parse-owner',
      op: 'meta',
      target: parseRequest().target,
    })
    // The fixture store holds no committed artifact, so the lease-free read
    // answers missing without ever resolving an attachment or probing.
    expect(meta).toEqual({ kind: 'missing' })
    expect(host.lookup).not.toHaveBeenCalled()
    const target = parseRequest().target
    const refs = target.kind === 'attachment' ? [target.ref] : ['https://example.org/a.pdf']
    const probe = await host.call({ sessionId: 'parse-owner', op: 'probe', refs })
    expect(probe).toEqual({
      kind: 'probed',
      results: refs.map((ref) => ({ ref, state: 'missing' })),
    })
    expect(host.lookup).not.toHaveBeenCalled()
  })
})
