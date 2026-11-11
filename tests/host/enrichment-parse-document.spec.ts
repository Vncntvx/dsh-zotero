/** Active parse domain: authorization, mode/credentials, source acquisition and provenance. */
import { afterEach, describe, expect, it } from 'vitest'
import { ENRICHMENT_CREDENTIAL_REFERENCE_NAMES } from '../../src/credential-names.ts'
import { parseDocument } from '../../src/enrichment/parse-document.ts'
import { cacheKeyOf, contentFingerprintOf } from '../../src/enrichment/parse-once.ts'
import { sourceKeyOf } from '../../src/enrichment/source-stamp.ts'
import {
  ZOTERO_ENRICHMENT_CREDENTIAL_UNRESOLVED,
  ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT,
  ZOTERO_ENRICHMENT_UPLOAD_DISABLED,
  ZOTERO_INVALID_ARGUMENT,
} from '../../src/errors.ts'
import {
  NEXT_GENERATION,
  LOCAL,
  MARKDOWN,
  PDF,
  URL,
  URL_INPUT,
  parseDomain,
} from './support/enrichment-parse-domain.ts'

const owned: ReturnType<typeof parseDomain>[] = []
function domain(config?: Parameters<typeof parseDomain>[0]) {
  const value = config === undefined ? parseDomain() : parseDomain(config)
  owned.push(value)
  return value
}
afterEach(async () => {
  await Promise.all(owned.splice(0).map(async (value) => await value.dispose()))
})

describe('parseDocument authorization and mode', () => {
  it.each([
    ['omitted', {}],
    ['disabled', { allowDocumentUpload: false }],
  ] as const)(
    'refuses %s upload permission before resolving/probing/reading a source',
    async (_label, config) => {
      const world = domain(config)
      await expect(parseDocument(LOCAL, world.deps)).rejects.toMatchObject({
        code: ZOTERO_ENRICHMENT_UPLOAD_DISABLED,
      })
      expect(world.storeFactory).not.toHaveBeenCalled()
      expect(world.resolveAttachment).not.toHaveBeenCalled()
      expect(world.sourceFiles.stat).not.toHaveBeenCalled()
      expect(world.sourceFiles.readFile).not.toHaveBeenCalled()
      expect(world.fetch).not.toHaveBeenCalled()
      expect(world.resolveToken).not.toHaveBeenCalled()
    },
  )

  it('refuses a non-PDF content type before source I/O', async () => {
    const world = domain()
    await expect(
      parseDocument({ ...LOCAL, contentType: 'text/html' }, world.deps),
    ).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT,
    })
    expect(world.resolveAttachment).not.toHaveBeenCalled()
    expect(world.fetch).not.toHaveBeenCalled()
  })

  it('accepts an unknown content type after validating actual PDF bytes', async () => {
    const world = domain()
    await expect(parseDocument({ ...LOCAL, contentType: '' }, world.deps)).resolves.toMatchObject({
      cached: false,
      artifact: { markdown: MARKDOWN },
    })
  })

  it('parses free mode without reading a configured credential', async () => {
    const world = domain({
      mode: 'free',
      mineruTokenRef: 'MINERU_API_TOKEN',
      allowDocumentUpload: true,
    })
    const result = await parseDocument(LOCAL, world.deps)
    expect(result.artifact.markdown).toBe(MARKDOWN)
    expect(result.cached).toBe(false)
    expect(result.stamp).toEqual({ kind: 'file', size: PDF.byteLength, mtimeMs: 1 })
    expect(result.provenance).toEqual({
      parser: 'mineru',
      mode: 'free',
      artifactId: result.cacheKey,
      fingerprint: contentFingerprintOf(PDF),
      sourceId: sourceKeyOf(LOCAL.key),
      generation: world.deps.generation,
    })
    expect(result.cacheKey).toBe(
      cacheKeyOf({
        identity: LOCAL.key,
        mode: 'free',
        generation: world.deps.generation,
        bytes: PDF,
      }),
    )
    expect(await world.store.sourceRecord(sourceKeyOf(LOCAL.key))).toEqual({
      version: 2,
      generation: world.deps.generation,
      parser: 'mineru',
      format: 'markdown',
      cacheKey: result.cacheKey,
      fingerprint: contentFingerprintOf(PDF),
      stamp: result.stamp,
    })
    expect(world.resolveToken).not.toHaveBeenCalled()
    expect(world.credential).not.toHaveBeenCalled()
  })

  it('resolves the configured pro token and keeps credentials off upload/CDN requests', async () => {
    const world = domain({
      mode: 'pro',
      mineruTokenRef: ' MINERU_API_TOKEN ',
      allowDocumentUpload: true,
    })
    world.credential.mockResolvedValue({ value: ' token ', source: 'synthetic' })
    const result = await parseDocument(LOCAL, world.deps)
    expect(result.artifact).toMatchObject({
      markdown: MARKDOWN,
      contentList: '[]',
      meta: { mode: 'pro', pageCount: 3 },
    })
    expect(result.provenance.mode).toBe('pro')
    expect(world.credential).toHaveBeenCalledWith('MINERU_API_TOKEN')
    for (const call of world.calls) {
      const headers = new Headers(call.init.headers)
      expect(headers.get('authorization')).toBe(
        call.url.startsWith('https://mineru.net/') ? 'Bearer token' : null,
      )
      if (call.init.method === 'PUT') expect([...headers]).toEqual([])
    }
  })

  it('uses the default pro credential reference when the configured name is blank', async () => {
    const world = domain({ mode: 'pro', mineruTokenRef: ' ', allowDocumentUpload: true })
    await parseDocument(LOCAL, world.deps)
    expect(world.resolveToken).toHaveBeenCalledWith(ENRICHMENT_CREDENTIAL_REFERENCE_NAMES.mineru)
  })

  it.each(['missing', 'empty'] as const)(
    'fails closed on %s pro credentials before acquiring bytes',
    async (kind) => {
      const world = domain({ mode: 'pro', allowDocumentUpload: true })
      world.credential.mockResolvedValue(
        kind === 'missing' ? undefined : { value: ' ', source: 'synthetic' },
      )
      await expect(parseDocument(LOCAL, world.deps)).rejects.toMatchObject({
        code: ZOTERO_ENRICHMENT_CREDENTIAL_UNRESOLVED,
      })
      expect(world.sourceFiles.readFile).not.toHaveBeenCalled()
      expect(world.fetch).not.toHaveBeenCalled()
    },
  )

  it('fails closed when the credentials service is absent', async () => {
    const world = domain({ mode: 'pro', allowDocumentUpload: true })
    const ctx = new (await import('@deepseek-ai/cordis')).Context()
    try {
      const { resolveMineruToken } = await import('../../src/enrichment/credentials.ts')
      await expect(
        parseDocument(LOCAL, {
          ...world.deps,
          resolveToken: async (ref) => await resolveMineruToken(ctx, ref),
        }),
      ).rejects.toMatchObject({ code: ZOTERO_ENRICHMENT_CREDENTIAL_UNRESOLVED })
      expect(world.fetch).not.toHaveBeenCalled()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('refuses malformed configuration before any host port runs', async () => {
    const world = domain()
    // Deliberately malformed external configuration exercises the domain guard.
    const config = { ...world.deps.config, mode: 'turbo' } as unknown as typeof world.deps.config
    await expect(parseDocument(LOCAL, { ...world.deps, config })).rejects.toMatchObject({
      code: ZOTERO_INVALID_ARGUMENT,
    })
    expect(world.storeFactory).not.toHaveBeenCalled()
    expect(world.fetch).not.toHaveBeenCalled()
  })
})

describe('parseDocument sources and generations', () => {
  it('reuses the same generation without reading bytes or resolving another token', async () => {
    const world = domain({ mode: 'pro', allowDocumentUpload: true })
    const first = await parseDocument(LOCAL, world.deps)
    world.sourceFiles.readFile.mockClear()
    world.fetch.mockClear()
    world.resolveToken.mockClear()
    const second = await parseDocument(LOCAL, world.deps)
    expect(second).toMatchObject({
      cached: true,
      cacheKey: first.cacheKey,
      artifact: { markdown: MARKDOWN },
    })
    expect(world.sourceFiles.readFile).not.toHaveBeenCalled()
    expect(world.fetch).not.toHaveBeenCalled()
    expect(world.resolveToken).not.toHaveBeenCalled()
  })

  it('parses a new generation and keeps the prior artifact available', async () => {
    const world = domain()
    const first = await parseDocument(LOCAL, world.deps)
    const second = await parseDocument(LOCAL, { ...world.deps, generation: NEXT_GENERATION })
    expect(second.cached).toBe(false)
    expect(second.cacheKey).not.toBe(first.cacheKey)
    expect(world.calls.filter((call) => call.init.method === 'POST')).toHaveLength(2)
    expect(await world.store.get(first.cacheKey)).toMatchObject({ markdown: MARKDOWN })
    expect(await world.store.sourceRecord(sourceKeyOf(LOCAL.key))).toMatchObject({
      cacheKey: second.cacheKey,
    })
  })

  it('downloads a public URL through the real source boundary and revalidates with HEAD on retry', async () => {
    const world = domain()
    const first = await parseDocument(URL_INPUT, world.deps)
    expect(first.stamp).toEqual({
      kind: 'url',
      url: URL,
      etag: '"v1"',
      contentLength: PDF.byteLength,
    })
    const second = await parseDocument(URL_INPUT, world.deps)
    expect(second.cached).toBe(true)
    expect(world.calls.filter((call) => call.url === URL).map((call) => call.init.method)).toEqual([
      'GET',
      'HEAD',
    ])
    expect(world.resolveAttachment).not.toHaveBeenCalled()
  })

  it('downloads a linked attachment through its resolved public URL', async () => {
    const world = domain()
    world.resolveAttachment.mockResolvedValue({ kind: 'url', url: URL })
    const result = await parseDocument(LOCAL, world.deps)
    expect(result.stamp).toMatchObject({ kind: 'url', url: URL })
    expect(world.calls.some((call) => call.url === URL && call.init.method === 'GET')).toBe(true)
    expect(world.sourceFiles.readFile).not.toHaveBeenCalled()
  })

  it('hashes supplied bytes instead of trusting an older source stamp', async () => {
    const world = domain()
    const input = {
      ...LOCAL,
      bytes: PDF,
      sourceStamp: { kind: 'file' as const, size: 9, mtimeMs: 99 },
    }
    const first = await parseDocument(input, world.deps)
    expect(first.stamp).toEqual({ kind: 'bytes', fingerprint: contentFingerprintOf(PDF) })
    expect((await parseDocument(input, world.deps)).cached).toBe(true)
    expect(world.resolveAttachment).not.toHaveBeenCalled()
    expect(world.sourceFiles.readFile).not.toHaveBeenCalled()
  })

  it('uses a caller source stamp for the cache probe without resolving the source', async () => {
    const world = domain()
    const first = await parseDocument(LOCAL, world.deps)
    world.resolveAttachment.mockClear()
    world.sourceFiles.stat.mockClear()
    expect((await parseDocument({ ...LOCAL, sourceStamp: first.stamp }, world.deps)).cached).toBe(
      true,
    )
    expect(world.resolveAttachment).not.toHaveBeenCalled()
    expect(world.sourceFiles.stat).not.toHaveBeenCalled()
  })

  it('redacts URL query and fragment from persisted provenance', async () => {
    const world = domain()
    const url = `${URL}?token=secret#location`
    const result = await parseDocument(
      { key: url, source: { kind: 'url', url }, bytes: PDF },
      world.deps,
    )
    expect(result.artifact.meta.identity).toBe('https://example.org/…')
    const meta = await world.fs.deps.readFile(`/parsed/${result.cacheKey}/meta.json`)
    expect(new TextDecoder().decode(meta)).not.toContain('secret')
  })
})
