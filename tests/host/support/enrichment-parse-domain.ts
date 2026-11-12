/** Real parse domain with scripted HTTP, source filesystem and credential ports. */
import { Context } from '@deepseek-ai/cordis'
import type {
  CredentialProvider,
  CredentialRef,
  ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import { zipSync } from 'fflate'
import type { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { raceWithSignal } from '../../../src/race-signal.ts'
import { deferred } from '../../helpers/sync.ts'
import { vi } from 'vitest'
import {
  ParsedArtifactStore,
  type ArtifactStoreDeps,
} from '../../../src/enrichment/artifact-store.ts'
import { resolveEnrichmentConfig, type EnrichmentConfig } from '../../../src/enrichment/config.ts'
import { resolveMineruToken } from '../../../src/enrichment/credentials.ts'
import { ParseFlight } from '../../../src/enrichment/parse-once.ts'
import type { ParseDocumentDeps } from '../../../src/enrichment/parse-document.ts'
import type { ParseSourceInput } from '../../../src/enrichment/types.ts'
import { attachmentRef } from '../../helpers/server/keys.ts'
import { clientOf } from './mineru-transport.ts'

export const GENERATION = '11111111-1111-4111-8111-111111111111'
export const NEXT_GENERATION = '22222222-2222-4222-8222-222222222222'
export const PDF = new TextEncoder().encode('%PDF-1.7 synthetic active document')
export const MARKDOWN = '# Parsed document'
export const LOCAL: ParseSourceInput = {
  key: attachmentRef(),
  source: { kind: 'local', attachmentRef: attachmentRef() },
  contentType: 'application/pdf',
}
export const URL = 'https://example.org/paper.pdf'
export const URL_INPUT: ParseSourceInput = { key: URL, source: { kind: 'url', url: URL } }

export function memoryFiles() {
  const files = new Map<string, Uint8Array>()
  const locks = new Map<string, Promise<void>>()
  const withSourceLock: typeof withFileLock = async (path, operation, options) => {
    const previous = locks.get(path) ?? Promise.resolve()
    const release = deferred()
    const queued = previous.then(async () => await release.promise)
    locks.set(path, queued)
    try {
      const signal = options?.signal
      await (signal === undefined ? previous : raceWithSignal(previous, signal))
      signal?.throwIfAborted()
      return await operation()
    } finally {
      release.resolve()
      if (locks.get(path) === queued) {
        void queued.then(() => {
          if (locks.get(path) === queued) locks.delete(path)
        })
      }
    }
  }
  const deps: ArtifactStoreDeps = {
    withSourceLock,
    mkdir: vi.fn(async () => {}),
    readFile: vi.fn(async (path) => {
      const value = files.get(path)
      if (value === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return value
    }),
    writeFile: vi.fn(async (path, data) => {
      files.set(path, typeof data === 'string' ? new TextEncoder().encode(data) : data)
    }),
    rename: vi.fn(async (from, to) => {
      const value = files.get(from)
      if (value === undefined) throw new Error('ENOENT')
      files.set(to, value)
      files.delete(from)
    }),
    rm: vi.fn(async (path, options) => {
      for (const key of files.keys()) {
        if (key === path || (options.recursive && key.startsWith(`${path}/`))) files.delete(key)
      }
    }),
  }
  return { files, deps }
}

export function parseDomain(config: EnrichmentConfig = {}) {
  const fs = memoryFiles()
  const store = new ParsedArtifactStore('/parsed', fs.deps)
  const ctx = new Context()
  const credential = vi.fn(
    async (_ref: CredentialRef): Promise<ResolvedCredential | undefined> => ({
      value: 'token',
      source: 'synthetic',
    }),
  )
  // Only this external provider's resolve port is consumed by resolveMineruToken.
  ctx.provide('credentials', { resolve: credential } as unknown as CredentialProvider)
  const stampHeaders = { etag: '"v1"', 'content-length': String(PDF.byteLength) }
  const fetch = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    if (init?.method === 'HEAD') return new Response(null, { headers: stampHeaders })
    if (init?.method === 'POST') {
      return new Response(
        JSON.stringify({
          code: 0,
          data: url.includes('/api/v4/')
            ? { batch_id: 'batch-1', file_urls: ['https://upload.example/document'] }
            : { task_id: 'task-1', file_url: 'https://upload.example/document' },
        }),
      )
    }
    if (init?.method === 'PUT') return new Response(null)
    if (url.includes('/api/v4/extract-results/')) {
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            batch_id: 'batch-1',
            extract_result: [
              {
                file_name: 'document.pdf',
                state: 'done',
                full_zip_url: 'https://cdn.example/result.zip',
                extract_progress: { total_pages: 3 },
              },
            ],
          },
        }),
      )
    }
    if (url.includes('/api/v1/agent/parse/')) {
      return new Response(
        JSON.stringify({
          code: 0,
          data: { task_id: 'task-1', state: 'done', markdown_url: 'https://cdn.example/full.md' },
        }),
      )
    }
    if (url === 'https://cdn.example/full.md') return new Response(MARKDOWN)
    if (url === 'https://cdn.example/result.zip') {
      return new Response(
        new Uint8Array(
          zipSync({
            'full.md': new TextEncoder().encode(MARKDOWN),
            'document_content_list.json': new TextEncoder().encode('[]'),
          }),
        ).buffer,
      )
    }
    return new Response(new Uint8Array(PDF).buffer, { headers: stampHeaders })
  })
  const { client, calls } = clientOf(fetch)
  const resolveAttachment = vi.fn<ParseDocumentDeps['resolveAttachment']>(async () => ({
    kind: 'file',
    path: '/source.pdf',
  }))
  const sourceFiles = {
    stat: vi.fn(async () => ({ size: PDF.byteLength, mtimeMs: 1 })),
    readFile: vi.fn(async () => PDF),
  }
  const resolveToken = vi.fn(async (reference: string) => await resolveMineruToken(ctx, reference))
  const storeFactory = vi.fn(async () => store)
  const deps: ParseDocumentDeps = {
    config: resolveEnrichmentConfig(config),
    generation: GENERATION,
    client,
    store: storeFactory,
    flight: new ParseFlight(),
    resolveAttachment,
    resolveToken,
    sourceFiles,
  }
  return {
    deps,
    store,
    storeFactory,
    fs,
    ctx,
    fetch,
    calls,
    credential,
    resolveToken,
    resolveAttachment,
    sourceFiles,
    dispose: async () => await ctx.fiber.dispose(),
  }
}
