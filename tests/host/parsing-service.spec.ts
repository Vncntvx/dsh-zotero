/**
 * The parsing service's enhancer: eligibility gates, the mode/token split
 * (free never reads the token), fail-closed pro credentials, the
 * ok/fatal/fallback outcome classification, and the source-index cache.
 * @module tests/host/parsing-service
 */

import { Context } from '@deepseek-ai/cordis'
import type {
  CredentialInfo,
  CredentialProvider,
  CredentialRef,
  ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import { describe, expect, it, vi } from 'vitest'
import { ParsingService } from '../../src/parsing/index.ts'
import type { ParsedArtifactStore } from '../../src/parsing/artifact-store.ts'
import type { ParsedArtifact } from '../../src/parsing/types.ts'
import {
  ZOTERO_PARSING_ARCHIVE_INVALID,
  ZOTERO_PARSING_CREDENTIAL_UNRESOLVED,
  ZOTERO_PARSING_OUTPUT_INVALID,
  ZOTERO_PARSING_UNSUPPORTED_INPUT,
  ZoteroError,
} from '../../src/errors.ts'

type MineralikeParse = (_input: unknown, _deps: unknown) => Promise<ParsedArtifact>

const encoder = new TextEncoder()
const PDF_BYTES = encoder.encode('%PDF-1.7 body')

const artifact: ParsedArtifact = {
  markdown: `# parsed ${'body '.repeat(120)}`,
  meta: {
    identity: 'x',
    mode: 'free',
    contentFingerprint: 'f',
    taskId: 't',
    files: [],
    pageCount: 3,
  },
}

function fakeStore(lookup?: ParsedArtifact): {
  store: ParsedArtifactStore
  putSource: ReturnType<typeof vi.fn>
  lookupSource: ReturnType<typeof vi.fn>
} {
  const putSource = vi.fn(async () => {})
  const lookupSource = vi.fn(async () => lookup)
  const store = {
    get: async () => undefined,
    put: async () => {},
    lookupSource,
    putSource,
  } as unknown as ParsedArtifactStore
  return { store, putSource, lookupSource }
}

function serviceOf(
  config: ConstructorParameters<typeof ParsingService>[1],
  parse?: MineralikeParse,
  ctx = new Context(),
  store: ParsedArtifactStore = fakeStore().store,
): ParsingService {
  return new ParsingService(ctx, config, {
    client: {} as never,
    parse: (parse ?? (async () => artifact)) as never,
    store: async () => store,
  })
}

function withCredentials(
  resolve: (ref: CredentialRef) => Promise<ResolvedCredential | undefined>,
  ctx = new Context(),
): Context {
  const provider = {
    resolve,
    describe: async (_ref: CredentialRef): Promise<CredentialInfo> => ({
      configured: true,
      writable: true,
    }),
  } as unknown as CredentialProvider
  ctx.provide('credentials', provider)
  return ctx
}

const pdfInput = {
  key: 'zotero://user/0/attachment/ABCD',
  source: { kind: 'local' as const, attachmentRef: 'zotero://user/0/attachment/ABCD' },
  contentType: 'application/pdf',
  bytes: PDF_BYTES,
}

describe('ParsingService.enhancer', () => {
  it('installs the enhancer into the core slot and configures its settings namespace', async () => {
    const ctx = new Context()
    const setFulltextEnhancer = vi.fn()
    ctx.provide('zotero', {
      setFulltextEnhancer,
      resolveAttachment: async () => ({ kind: 'file' as const, path: '/tmp/a.pdf' }),
    } as never)
    const owners: unknown[] = []
    ctx.provide('settings', {
      configure: (presentation: { auto: boolean }, owner: unknown) => {
        owners.push([presentation, owner])
      },
    } as never)

    const service = serviceOf({}, undefined, ctx)

    await vi.waitFor(() => expect(setFulltextEnhancer).toHaveBeenCalledWith(service.enhancer))
    await vi.waitFor(() => expect(owners).toHaveLength(1))
    expect(owners[0]).toEqual([{ auto: false }, ctx.fiber])
  })

  it('configures its settings page even when the core is not composed', async () => {
    const ctx = new Context()
    const owners: unknown[] = []
    ctx.provide('settings', {
      configure: (presentation: { auto: boolean }, owner: unknown) => {
        owners.push([presentation, owner])
      },
    } as never)

    serviceOf({}, undefined, ctx)

    await vi.waitFor(() => expect(owners).toHaveLength(1))
    expect(owners[0]).toEqual([{ auto: false }, ctx.fiber])
  })

  it('declines a non-PDF candidate without touching the network', async () => {
    const service = serviceOf({})
    await expect(
      service.enhancer.enhance({ ...pdfInput, contentType: 'text/html' }),
    ).resolves.toMatchObject({ kind: 'fallback', reason: expect.stringContaining('only PDF') })
  })

  it('accepts an empty content type as an unknown PDF candidate', async () => {
    const service = serviceOf({ allowParsingUpload: true })
    await expect(service.enhancer.enhance({ ...pdfInput, contentType: '' })).resolves.toMatchObject(
      {
        kind: 'ok',
        text: artifact.markdown,
      },
    )
  })

  it('declines while data-egress authorization is off', async () => {
    const service = serviceOf({ allowParsingUpload: false })
    await expect(service.enhancer.enhance(pdfInput)).resolves.toMatchObject({
      kind: 'fallback',
      reason: expect.stringContaining('allowParsingUpload'),
    })
  })

  it('fails closed when pro mode has no token reference', async () => {
    const service = serviceOf({ mode: 'pro', allowParsingUpload: true })
    await expect(service.enhancer.enhance(pdfInput)).resolves.toMatchObject({
      kind: 'fatal',
      error: expect.objectContaining({ code: ZOTERO_PARSING_CREDENTIAL_UNRESOLVED }),
    })
  })

  it('fails closed when the pro token reference resolves to nothing', async () => {
    const ctx = withCredentials(async () => undefined)
    const service = serviceOf(
      { mode: 'pro', allowParsingUpload: true, mineruTokenRef: 'MINERU_API_TOKEN' },
      undefined,
      ctx,
    )
    await expect(service.enhancer.enhance(pdfInput)).resolves.toMatchObject({
      kind: 'fatal',
      error: expect.objectContaining({ code: ZOTERO_PARSING_CREDENTIAL_UNRESOLVED }),
    })
  })

  it('parses in free mode without reading any credential', async () => {
    const resolve = vi.fn()
    const ctx = withCredentials(resolve as never)
    const parse = vi.fn(async (_input: unknown, _deps: unknown) => artifact)
    const service = serviceOf({ mode: 'free', allowParsingUpload: true }, parse, ctx)

    await expect(service.enhancer.enhance(pdfInput)).resolves.toMatchObject({
      kind: 'ok',
      text: artifact.markdown,
      pageCount: 3,
      source: 'MinerU (free)',
    })
    expect(resolve).not.toHaveBeenCalled()
    expect(parse).toHaveBeenCalledTimes(1)
  })

  it('passes the resolved token and labels pro provenance', async () => {
    const ctx = withCredentials(async () => ({ value: 'token', source: 'test' }))
    const parse = vi.fn(async (_input: unknown, _deps: unknown) => artifact)
    const service = serviceOf(
      { mode: 'pro', allowParsingUpload: true, mineruTokenRef: 'MINERU_API_TOKEN' },
      parse,
      ctx,
    )

    await expect(service.enhancer.enhance(pdfInput)).resolves.toMatchObject({
      kind: 'ok',
      source: 'MinerU (pro)',
    })
    expect(parse.mock.calls[0]![0]).toMatchObject({ mode: 'pro', token: 'token' })
  })

  it('reports a runtime parse failure as a coded fallback', async () => {
    const service = serviceOf({ mode: 'free', allowParsingUpload: true }, async () => {
      throw new ZoteroError('MinerU parse failed: rate limited', 'ZOTERO_PARSING_TASK_FAILED')
    })
    await expect(service.enhancer.enhance(pdfInput)).resolves.toMatchObject({
      kind: 'fallback',
      reason: expect.stringContaining('ZOTERO_PARSING_TASK_FAILED'),
    })
  })

  it('reports a corrupt result archive as a fallback, not a fatal', async () => {
    const service = serviceOf({ mode: 'free', allowParsingUpload: true }, async () => {
      throw new ZoteroError('MinerU result archive is invalid', ZOTERO_PARSING_ARCHIVE_INVALID)
    })
    await expect(service.enhancer.enhance(pdfInput)).resolves.toMatchObject({
      kind: 'fallback',
      reason: expect.stringContaining(ZOTERO_PARSING_ARCHIVE_INVALID),
    })
  })

  it('reports an oversized or non-PDF payload as a coded fallback', async () => {
    const parse = vi.fn(async () => artifact)
    const service = serviceOf({ mode: 'free', allowParsingUpload: true }, parse)
    await expect(
      service.enhancer.enhance({ ...pdfInput, bytes: encoder.encode('not a pdf') }),
    ).resolves.toMatchObject({
      kind: 'fallback',
      reason: expect.stringContaining(ZOTERO_PARSING_UNSUPPORTED_INPUT),
    })
    expect(parse).not.toHaveBeenCalled()
  })

  it('treats an invalid output directory as a fatal configuration failure', async () => {
    const service = new ParsingService(
      new Context(),
      { mode: 'free', allowParsingUpload: true, outputDir: '/definitely/not/a/real/dir' },
      { client: {} as never, parse: (async () => artifact) as never },
    )
    await expect(service.enhancer.enhance(pdfInput)).resolves.toMatchObject({
      kind: 'fatal',
      error: expect.objectContaining({ code: ZOTERO_PARSING_OUTPUT_INVALID }),
    })
  })

  it('serves a source-index hit without parsing or credentials', async () => {
    const { store, lookupSource } = fakeStore(artifact)
    const parse = vi.fn(async () => artifact)
    const service = serviceOf(
      { mode: 'pro', allowParsingUpload: false },
      parse,
      new Context(),
      store,
    )
    await expect(service.enhancer.enhance(pdfInput)).resolves.toMatchObject({
      kind: 'ok',
      text: artifact.markdown,
      source: 'MinerU (pro)',
    })
    expect(lookupSource).toHaveBeenCalledTimes(1)
    expect(parse).not.toHaveBeenCalled()
  })

  it('treats a short cached artifact as a fallback', async () => {
    const short: ParsedArtifact = {
      ...artifact,
      markdown: '# short',
    }
    const { store } = fakeStore(short)
    const service = serviceOf({ allowParsingUpload: true }, undefined, new Context(), store)
    await expect(service.enhancer.enhance(pdfInput)).resolves.toMatchObject({
      kind: 'fallback',
      reason: expect.stringContaining('below the 500-character threshold'),
    })
  })

  it('redacts a URL query from the artifact provenance identity', async () => {
    const parse = vi.fn(async (input: unknown) => {
      expect(input).toMatchObject({ metaIdentity: 'https://example.org/paper.pdf' })
      return artifact
    })
    const service = serviceOf({ mode: 'free', allowParsingUpload: true }, parse as never)
    await service.enhancer.enhance({
      key: 'https://example.org/paper.pdf?token=secret',
      source: { kind: 'url', url: 'https://example.org/paper.pdf?token=secret' },
      contentType: 'application/pdf',
      bytes: PDF_BYTES,
    })
  })

  it('reports an unresolvable local attachment as a fallback', async () => {
    const service = serviceOf({ mode: 'free', allowParsingUpload: true })
    await expect(
      service.enhancer.enhance({
        key: 'local',
        source: { kind: 'local', attachmentRef: 'zotero://user/0/attachment/NOPE' },
        contentType: 'application/pdf',
      }),
    ).resolves.toMatchObject({ kind: 'fallback' })
  })

  it('resolves the configured output directory when no store is injected', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'dsh-zotero-parsing-dir-'))
    try {
      const service = new ParsingService(
        new Context(),
        { mode: 'free', allowParsingUpload: true, outputDir: dir },
        {
          client: {} as never,
          parse: (async () => artifact) as never,
        },
      )
      await expect(service.enhancer.enhance(pdfInput)).resolves.toMatchObject({ kind: 'ok' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('lookup returns a cache hit without reading bytes', async () => {
    const { store, lookupSource } = fakeStore(artifact)
    const service = serviceOf({ allowParsingUpload: false }, undefined, new Context(), store)
    await expect(service.enhancer.lookup(pdfInput)).resolves.toMatchObject({
      outcome: { kind: 'ok', text: artifact.markdown, source: 'MinerU (free)' },
      stamp: { kind: 'bytes' },
    })
    expect(lookupSource).toHaveBeenCalledTimes(1)
  })

  it('lookup reports a miss with the probed stamp', async () => {
    const { store } = fakeStore()
    const service = serviceOf({ allowParsingUpload: true }, undefined, new Context(), store)
    await expect(service.enhancer.lookup(pdfInput)).resolves.toEqual({
      stamp: { kind: 'bytes', fingerprint: expect.any(String) },
    })
  })

  it('lookup declines a non-PDF candidate', async () => {
    const service = serviceOf({})
    await expect(
      service.enhancer.lookup({ ...pdfInput, contentType: 'text/html' }),
    ).resolves.toEqual({})
  })

  it('lookup reports an invalid output directory as fatal', async () => {
    const service = new ParsingService(
      new Context(),
      { mode: 'free', allowParsingUpload: true, outputDir: '/definitely/not/a/real/dir' },
      { client: {} as never, parse: (async () => artifact) as never },
    )
    await expect(service.enhancer.lookup(pdfInput)).resolves.toMatchObject({
      outcome: { kind: 'fatal', error: { code: ZOTERO_PARSING_OUTPUT_INVALID } },
    })
  })

  it('lookup turns a probe failure into a plain miss', async () => {
    const { store } = fakeStore()
    const service = serviceOf({ allowParsingUpload: true }, undefined, new Context(), store)
    await expect(
      service.enhancer.lookup({
        key: 'local',
        source: { kind: 'local', attachmentRef: 'zotero://user/0/attachment/NOPE' },
        contentType: 'application/pdf',
      }),
    ).resolves.toEqual({})
  })

  it('lookup treats a short cached artifact as a fallback', async () => {
    const { store } = fakeStore({ ...artifact, markdown: '# short' })
    const service = serviceOf({ allowParsingUpload: true }, undefined, new Context(), store)
    await expect(service.enhancer.lookup(pdfInput)).resolves.toMatchObject({
      outcome: { kind: 'fallback' },
    })
  })

  it('lookup reports a malformed config as fatal', async () => {
    const service = serviceOf({ mode: 'turbo' as never })
    await expect(service.enhancer.lookup(pdfInput)).resolves.toMatchObject({
      outcome: { kind: 'fatal' },
    })
  })

  it('enhance reports a malformed config as fatal', async () => {
    const service = serviceOf({ mode: 'turbo' as never })
    await expect(service.enhancer.enhance(pdfInput)).resolves.toMatchObject({ kind: 'fatal' })
  })

  it('enhance falls back for a non-configuration store failure', async () => {
    const service = new ParsingService(
      new Context(),
      { mode: 'free', allowParsingUpload: true },
      {
        client: {} as never,
        parse: (async () => artifact) as never,
        store: async () => {
          throw new Error('EACCES: cache root')
        },
      },
    )
    await expect(service.enhancer.enhance(pdfInput)).resolves.toMatchObject({
      kind: 'fallback',
      reason: expect.stringContaining('EACCES'),
    })
  })

  it('enhance treats parse-time output and credential errors as fatal', async () => {
    const codes = [ZOTERO_PARSING_OUTPUT_INVALID, ZOTERO_PARSING_CREDENTIAL_UNRESOLVED] as const
    for (const code of codes) {
      const service = serviceOf({ mode: 'free', allowParsingUpload: true }, async () => {
        throw new ZoteroError('blocked', code)
      })
      await expect(service.enhancer.enhance(pdfInput)).resolves.toMatchObject({
        kind: 'fatal',
        error: { code },
      })
    }
  })

  it('enhance continues when the source-index lookup rejects or the index write fails', async () => {
    const store = {
      get: async () => undefined,
      put: async () => {},
      lookupSource: vi.fn(async () => {
        throw new Error('EIO')
      }),
      putSource: vi.fn(async () => {
        throw new Error('ENOSPC')
      }),
    } as unknown as ParsedArtifactStore
    const parse = vi.fn(async () => artifact)
    const service = serviceOf(
      { mode: 'free', allowParsingUpload: true },
      parse,
      new Context(),
      store,
    )
    await expect(service.enhancer.enhance(pdfInput)).resolves.toMatchObject({ kind: 'ok' })
    expect(parse).toHaveBeenCalledTimes(1)
  })

  it('enhance uses a caller-supplied source stamp instead of probing', async () => {
    const stamp = { kind: 'file' as const, size: 10, mtimeMs: 20 }
    const { store, lookupSource } = fakeStore(artifact)
    const service = serviceOf({ allowParsingUpload: true }, undefined, new Context(), store)
    await expect(
      service.enhancer.enhance({ ...pdfInput, sourceStamp: stamp }),
    ).resolves.toMatchObject({ kind: 'ok' })
    expect(lookupSource).toHaveBeenCalledWith(expect.any(String), stamp)
  })
})
