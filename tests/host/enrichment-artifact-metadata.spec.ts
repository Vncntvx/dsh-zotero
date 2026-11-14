/** Lease-free metadata and batched freshness probes over committed artifacts. */
import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ParsedArtifactStore } from '../../src/enrichment/artifact-store.ts'
import { probeAttachments, storedMetadata } from '../../src/enrichment/artifact-metadata.ts'
import type { ArtifactMetadataDeps } from '../../src/enrichment/artifact-metadata.ts'
import { MineruClient } from '../../src/enrichment/transport.ts'
import { memoryFiles } from './support/enrichment-parse-domain.ts'
import { ARTIFACT, CACHE_KEY, SOURCE_RECORD } from './support/enrichment-artifacts.ts'
import { sourceKeyOf } from '../../src/enrichment/source-stamp.ts'
import { attachmentRef } from '../helpers/server/keys.ts'
import { ENRICHMENT_DEFAULTS } from '../../src/enrichment-preferences.ts'

const REF = attachmentRef()
const SIGNAL = new AbortController().signal
const config = ENRICHMENT_DEFAULTS
const URL = 'https://papers.example.org/a.pdf'
const URL_ARTIFACT = {
  ...ARTIFACT,
  meta: { ...ARTIFACT.meta, identity: 'https://papers.example.org/…', sourceUrl: URL },
}

function client() {
  return new MineruClient({
    resolver: async () => [],
    dispatcher: () => ({ dispatcher: {} as never, close: async () => {} }),
    fetch: async () => new Response(null, { status: 200 }),
  })
}

function depsFor(
  store: ParsedArtifactStore,
  resolveAttachment: ArtifactMetadataDeps['resolveAttachment'],
): ArtifactMetadataDeps {
  return { store: async () => store, resolveAttachment, client: client() }
}

function memoryResolveAttachment(path = '/private/zotero/attachment.pdf') {
  return vi.fn(async (ref: string, _signal?: AbortSignal) => ({
    ref,
    title: 'Selected PDF',
    contentType: 'application/pdf',
    kind: 'file' as const,
    path,
  }))
}

describe('stored parsed artifact metadata', () => {
  it('answers metadata by artifact id with the committed Markdown title', async () => {
    const world = memoryResolveAttachment()
    const store = new ParsedArtifactStore('/root', memoryFiles().deps)
    await store.put(CACHE_KEY, ARTIFACT)
    const result = await storedMetadata(
      depsFor(store, world),
      config,
      { sessionId: 's1', op: 'meta', target: { kind: 'artifact', artifactId: CACHE_KEY } },
      SIGNAL,
    )
    if (!('metadata' in result)) throw new Error('expected metadata')
    expect(result.metadata.artifactId).toBe(CACHE_KEY)
    expect(result.metadata.title).toBe('Parsed body')
    expect(result.metadata.targetLabel).toBe(ARTIFACT.meta.identity)
  })

  it('answers metadata by attachment ref without resolving the attachment', async () => {
    const resolveAttachment = memoryResolveAttachment()
    const store = new ParsedArtifactStore('/root', memoryFiles().deps)
    await store.put(CACHE_KEY, ARTIFACT)
    await store.putSources([sourceKeyOf(REF)], SOURCE_RECORD)
    const result = await storedMetadata(
      depsFor(store, resolveAttachment),
      config,
      { sessionId: 's1', op: 'meta', target: { kind: 'attachment', ref: REF } },
      SIGNAL,
    )
    if (!('metadata' in result)) throw new Error('expected metadata')
    expect(result.metadata.artifactId).toBe(CACHE_KEY)
    expect(resolveAttachment).not.toHaveBeenCalled()
  })

  it('answers metadata by URL target and missing for unindexed sources', async () => {
    const resolveAttachment = memoryResolveAttachment()
    const store = new ParsedArtifactStore('/root', memoryFiles().deps)
    await store.put(CACHE_KEY, URL_ARTIFACT)
    await store.putSources([sourceKeyOf(URL)], SOURCE_RECORD)
    const hit = await storedMetadata(
      depsFor(store, resolveAttachment),
      config,
      { sessionId: 's1', op: 'meta', target: { kind: 'url', url: URL } },
      SIGNAL,
    )
    if (!('metadata' in hit)) throw new Error('expected metadata')
    expect(hit.metadata.artifactId).toBe(CACHE_KEY)
    const unindexed = await storedMetadata(
      depsFor(store, resolveAttachment),
      config,
      {
        sessionId: 's1',
        op: 'meta',
        target: { kind: 'url', url: 'https://other.example.org/b.pdf' },
      },
      SIGNAL,
    )
    expect(unindexed).toEqual({ kind: 'missing' })
    const unknown = await storedMetadata(
      depsFor(store, resolveAttachment),
      config,
      { sessionId: 's1', op: 'meta', target: { kind: 'artifact', artifactId: 'e'.repeat(64) } },
      SIGNAL,
    )
    expect(unknown).toEqual({ kind: 'missing' })
  })
})

describe('batched attachment freshness probe', () => {
  interface ProbedWorld {
    readonly deps: ArtifactMetadataDeps
    readonly store: ParsedArtifactStore
    readonly resolveAttachment: ReturnType<typeof memoryResolveAttachment>
    readonly path: string
    readonly cleanup: () => Promise<void>
  }

  /** A real temp source file, so the probe's stat arm answers with a true stamp. */
  async function probedWorld(
    options: {
      stamp?: { kind: 'file'; size: number; mtimeMs: number }
      indexedRefs?: readonly string[]
    } = {},
  ): Promise<ProbedWorld> {
    const dir = await mkdtemp(join(tmpdir(), 'zotero-probe-'))
    const path = join(dir, 'attachment.pdf')
    await writeFile(path, new TextEncoder().encode('%PDF-1.4 real body'))
    const info = await stat(path)
    const resolveAttachment = memoryResolveAttachment(path)
    const store = new ParsedArtifactStore('/root', memoryFiles().deps)
    await store.put(CACHE_KEY, ARTIFACT)
    const stamp = options.stamp ?? { kind: 'file' as const, size: info.size, mtimeMs: info.mtimeMs }
    for (const ref of options.indexedRefs ?? [REF])
      await store.putSources([sourceKeyOf(ref)], { ...SOURCE_RECORD, cacheKey: CACHE_KEY, stamp })
    return {
      deps: depsFor(store, resolveAttachment),
      store,
      resolveAttachment,
      path,
      cleanup: async () => {
        await rm(dir, { recursive: true, force: true })
      },
    }
  }

  it('marks a probed row ready when the source still matches its stamp', async () => {
    const world = await probedWorld()
    const result = await probeAttachments(
      world.deps,
      config,
      { sessionId: 's1', op: 'probe', refs: [REF] },
      SIGNAL,
    )
    expect(result).toEqual({ kind: 'probed', results: [{ ref: REF, state: 'ready' }] })
    await world.cleanup()
  })

  it('marks a probed row expired when the source changed', async () => {
    const world = await probedWorld({ stamp: { kind: 'file', size: 999, mtimeMs: 1 } })
    const result = await probeAttachments(
      world.deps,
      config,
      { sessionId: 's1', op: 'probe', refs: [REF] },
      SIGNAL,
    )
    expect(result.results[0]).toEqual({ ref: REF, state: 'expired' })
    await world.cleanup()
  })

  it('answers missing without resolving for rows without a committed artifact', async () => {
    const world = await probedWorld()
    const unindexed = attachmentRef('PDFZZZZ1')
    const result = await probeAttachments(
      world.deps,
      config,
      { sessionId: 's1', op: 'probe', refs: [unindexed, 'zotero://user/0/item/I1'] },
      SIGNAL,
    )
    expect(result.results).toEqual([
      { ref: unindexed, state: 'missing' },
      { ref: 'zotero://user/0/item/I1', state: 'missing' },
    ])
    expect(world.resolveAttachment).not.toHaveBeenCalled()
    await world.cleanup()
  })

  it('answers missing for a readable row whose attachment resolution fails', async () => {
    const resolveAttachment = memoryResolveAttachment('/private/zotero/gone.pdf')
    const store = new ParsedArtifactStore('/root', memoryFiles().deps)
    await store.put(CACHE_KEY, ARTIFACT)
    await store.putSources([sourceKeyOf(REF)], SOURCE_RECORD)
    const result = await probeAttachments(
      depsFor(store, resolveAttachment),
      config,
      { sessionId: 's1', op: 'probe', refs: [REF] },
      SIGNAL,
    )
    expect(result.results).toEqual([{ ref: REF, state: 'missing' }])
    expect(resolveAttachment).toHaveBeenCalledTimes(1)
  })

  it('marks a probed row expired when its committed meta vanished', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zotero-probe-'))
    const path = join(dir, 'attachment.pdf')
    await writeFile(path, new TextEncoder().encode('%PDF-1.4 body'))
    const info = await stat(path)
    const resolveAttachment = memoryResolveAttachment(path)
    const store = new ParsedArtifactStore('/root', memoryFiles().deps)
    await store.putSources([sourceKeyOf(REF)], {
      ...SOURCE_RECORD,
      cacheKey: CACHE_KEY,
      stamp: { kind: 'file' as const, size: info.size, mtimeMs: info.mtimeMs },
    })
    const result = await probeAttachments(
      depsFor(store, resolveAttachment),
      config,
      { sessionId: 's1', op: 'probe', refs: [REF] },
      SIGNAL,
    )
    expect(result.results[0]).toEqual({ ref: REF, state: 'expired' })
    await rm(dir, { recursive: true, force: true })
  })

  it('bounds the per-ref concurrency of one batch', async () => {
    const refs = [...Array(20)].map((_, index) => attachmentRef(String(index).padStart(8, '0')))
    const world = await probedWorld({ indexedRefs: refs })
    let inFlight = 0
    let peak = 0
    const deps: ArtifactMetadataDeps = {
      ...world.deps,
      resolveAttachment: async (ref, signal) => {
        inFlight++
        peak = Math.max(peak, inFlight)
        try {
          return await world.resolveAttachment(ref, signal)
        } finally {
          inFlight--
        }
      },
    }
    const result = await probeAttachments(
      deps,
      config,
      { sessionId: 's1', op: 'probe', refs },
      SIGNAL,
    )
    expect(result.results).toHaveLength(20)
    expect(result.results.every((row) => row.state === 'ready')).toBe(true)
    expect(peak).toBeLessThanOrEqual(8)
    await world.cleanup()
  })
})
