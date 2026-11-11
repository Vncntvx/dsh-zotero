/** Ordinary reads can reuse artifacts without acquiring or uploading a document. */
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ParsedArtifactStore } from '../../src/enrichment/artifact-store.ts'
import { sourceKeyOf } from '../../src/enrichment/source-stamp.ts'
import { EnrichmentService } from '../../src/enrichment/service.ts'
import type { MineruClient } from '../../src/enrichment/transport.ts'

const GENERATION_A = 'e62ff93d-4637-4c40-ab95-5baea2440908'
const GENERATION_B = '987899bb-fcf2-4a6e-90da-47d1a2fd2c96'
const owned: Array<{ ctx: Context; dir: string }> = []
afterEach(async () => {
  for (const { ctx, dir } of owned.splice(0)) {
    await ctx.fiber.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

async function reader() {
  const ctx = new Context()
  const dir = await mkdtemp(join(tmpdir(), 'dsh-zotero-artifact-reader-'))
  owned.push({ ctx, dir })
  const head = vi.fn(async (url: string, _options?: unknown) => ({
    finalUrl: url,
    headers: new Headers({ etag: '"v1"' }),
  }))
  const get = vi.fn(async () => {
    throw new Error('ordinary reading must not obtain PDF bytes')
  })
  const parse = vi.fn(async () => {
    throw new Error('ordinary reading must not submit MinerU work')
  })
  const store = new ParsedArtifactStore(dir)
  const service = new EnrichmentService(
    ctx,
    { allowDocumentUpload: true },
    {
      client: { head, get } as unknown as MineruClient,
      parse,
      store: async () => store,
    },
  )
  return { service, store, head, get, parse }
}

async function seed(
  store: ParsedArtifactStore,
  url: string,
  options: { mode?: 'free' | 'pro'; contentLength?: number } = {},
) {
  const cacheKey = 'a'.repeat(64)
  const fingerprint = 'b'.repeat(64)
  const sourceKey = sourceKeyOf(url)
  await store.put(cacheKey, {
    markdown: '# Previously parsed document',
    meta: {
      version: 2,
      parser: 'mineru',
      format: 'markdown',
      sourceId: sourceKey,
      generation: GENERATION_A,
      identity: 'https://example.org/…',
      mode: options.mode ?? 'free',
      contentFingerprint: fingerprint,
      taskId: 'completed-task',
      files: ['full.md'],
    },
  })
  await store.putSource(sourceKey, {
    version: 2,
    parser: 'mineru',
    format: 'markdown',
    generation: GENERATION_A,
    cacheKey,
    fingerprint,
    stamp: {
      kind: 'url',
      url,
      etag: '"v1"',
      ...(options.contentLength !== undefined ? { contentLength: options.contentLength } : {}),
    },
  })
  return { cacheKey, fingerprint, sourceKey }
}

const lookup = (service: EnrichmentService, url: string) =>
  service.enhancer.lookup({ key: url, source: { kind: 'url', url } })

describe('the ordinary artifact lookup boundary', () => {
  it('leaves a missing configured artifact root absent', async () => {
    const ctx = new Context()
    const dir = await mkdtemp(join(tmpdir(), 'dsh-zotero-read-only-root-'))
    owned.push({ ctx, dir })
    const root = join(dir, 'not-created')
    const service = new EnrichmentService(ctx, { outputDir: root }, { client: {} as MineruClient })
    await expect(lookup(service, 'https://example.org/not-parsed.pdf')).resolves.toEqual({
      kind: 'miss',
      reason: 'absent',
    })
    await expect(stat(root)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('uses one source-index snapshot while a newer pointer is published', async () => {
    const { service, store, head } = await reader()
    const url = 'https://example.org/reparsed.pdf'
    const { cacheKey: keyA, fingerprint: fingerprintA, sourceKey } = await seed(store, url)
    const keyB = 'c'.repeat(64)
    const fingerprintB = 'd'.repeat(64)
    await store.put(keyB, {
      markdown: '# New artifact',
      meta: {
        version: 2,
        parser: 'mineru',
        format: 'markdown',
        sourceId: sourceKey,
        generation: GENERATION_B,
        identity: 'https://example.org/…',
        mode: 'free',
        contentFingerprint: fingerprintB,
        taskId: 'reparsed-task',
        files: ['full.md'],
      },
    })
    head.mockImplementation(async () => {
      await store.putSource(sourceKey, {
        version: 2,
        parser: 'mineru',
        format: 'markdown',
        generation: GENERATION_B,
        cacheKey: keyB,
        fingerprint: fingerprintB,
        stamp: { kind: 'url', url, etag: '"v1"' },
      })
      return { finalUrl: url, headers: new Headers({ etag: '"v1"' }) }
    })
    await expect(lookup(service, url)).resolves.toMatchObject({
      kind: 'hit',
      text: '# Previously parsed document',
      provenance: { artifactId: keyA, fingerprint: fingerprintA, generation: GENERATION_A },
    })
    await expect(lookup(service, url)).resolves.toMatchObject({
      kind: 'hit',
      text: '# New artifact',
      provenance: { artifactId: keyB, fingerprint: fingerprintB, generation: GENERATION_B },
    })
    expect(head).toHaveBeenCalledTimes(2)
    const indexBytes = await readFile(join(store.root, 'sources', 'index.json'))
    expect(JSON.parse(indexBytes.toString('utf8')).sources[sourceKey].cacheKey).toBe(keyB)
  })

  it('reads a pro artifact after switching to free with uploads disabled', async () => {
    const { service, store, head, get, parse } = await reader()
    const url = 'https://example.org/large.pdf'
    const contentLength = 11 * 1024 * 1024
    await seed(store, url, { mode: 'pro', contentLength })
    head.mockResolvedValue({
      finalUrl: url,
      headers: new Headers({ etag: '"v1"', 'content-length': String(contentLength) }),
    })
    service.config = { mode: 'free', allowDocumentUpload: false }
    await expect(lookup(service, url)).resolves.toMatchObject({
      kind: 'hit',
      provenance: { mode: 'pro', generation: GENERATION_A },
    })
    expect(head.mock.calls[0]?.[1]).toMatchObject({ maxBytes: 200 * 1024 * 1024 })
    expect(get).not.toHaveBeenCalled()
    expect(parse).not.toHaveBeenCalled()
  })

  it('shares fragment-equivalent identity while keeping different queries separate', async () => {
    const { service, store, head } = await reader()
    const url = 'https://example.org/paper.pdf?edition=one'
    await seed(store, url)
    head.mockResolvedValue({ finalUrl: url, headers: new Headers({ etag: '"v1"' }) })
    await expect(lookup(service, `${url}#section-2`)).resolves.toMatchObject({ kind: 'hit' })
    await expect(lookup(service, 'https://example.org/paper.pdf?edition=two')).resolves.toEqual({
      kind: 'miss',
      reason: 'absent',
    })
    expect(head).toHaveBeenCalledTimes(1)
  })

  it('rejects inconsistent source identity before a source probe', async () => {
    const { service, store, head, get, parse } = await reader()
    const url = 'https://example.org/one.pdf'
    await seed(store, url)
    await expect(
      service.enhancer.lookup({
        key: url,
        source: { kind: 'url', url: 'https://example.org/two.pdf' },
      }),
    ).resolves.toMatchObject({ kind: 'fault' })
    expect(head).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
    expect(parse).not.toHaveBeenCalled()
  })

  it('does not probe a URL with no source-index candidate', async () => {
    const { service, head, get, parse } = await reader()
    await expect(lookup(service, 'https://example.org/no-artifact.pdf')).resolves.toEqual({
      kind: 'miss',
      reason: 'absent',
    })
    expect(head).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
    expect(parse).not.toHaveBeenCalled()
  })

  it('has no upload method on the core-visible reader', async () => {
    const { service } = await reader()
    expect(Object.keys(service.enhancer)).toEqual(['lookup'])
  })
})
