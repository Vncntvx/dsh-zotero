/** Active parse failures and cancellation use real collaborators and controlled external ports. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseDocument } from '../../src/enrichment/parse-document.ts'
import { resolveOutputDir } from '../../src/enrichment/output-dir.ts'
import { sourceKeyOf } from '../../src/enrichment/source-stamp.ts'
import {
  ZOTERO_ENRICHMENT_ARCHIVE_INVALID,
  ZOTERO_ENRICHMENT_OUTPUT_INVALID,
  ZOTERO_ENRICHMENT_TASK_FAILED,
  ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT,
  ZOTERO_PROVIDER_UNAVAILABLE,
  ZoteroError,
} from '../../src/errors.ts'
import { deferred } from '../helpers/sync.ts'
import {
  LOCAL,
  MARKDOWN,
  NEXT_GENERATION,
  PDF,
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

function failedDomain(error: unknown) {
  const world = domain()
  world.fetch.mockRejectedValue(error)
  return world
}

describe('parseDocument source and storage failure boundaries', () => {
  it('validates the output directory before probing or reading the document', async () => {
    const world = domain()
    await expect(
      parseDocument(LOCAL, {
        ...world.deps,
        store: async () => {
          await resolveOutputDir('/definitely/not/a/real/dir')
          return world.store
        },
      }),
    ).rejects.toMatchObject({ code: ZOTERO_ENRICHMENT_OUTPUT_INVALID })
    expect(world.resolveAttachment).not.toHaveBeenCalled()
    expect(world.sourceFiles.readFile).not.toHaveBeenCalled()
    expect(world.fetch).not.toHaveBeenCalled()
  })

  it('wraps output-store I/O failures without acquiring a source', async () => {
    const world = domain()
    const cause = new Error('EACCES: cache root')
    world.storeFactory.mockRejectedValue(cause)
    await expect(parseDocument(LOCAL, world.deps)).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_TASK_FAILED,
      cause,
    })
    expect(world.resolveAttachment).not.toHaveBeenCalled()
    expect(world.fetch).not.toHaveBeenCalled()
  })

  it.each(['malformed JSON', 'invalid record'] as const)(
    'refuses a %s source index without uploading',
    async (kind) => {
      const world = domain()
      await world.fs.deps.writeFile(
        '/parsed/sources/index.json',
        kind === 'malformed JSON' ? '{bad' : JSON.stringify({ version: 2 }),
      )
      await expect(parseDocument(LOCAL, world.deps)).rejects.toMatchObject({
        code: ZOTERO_ENRICHMENT_TASK_FAILED,
      })
      expect(world.resolveAttachment).not.toHaveBeenCalled()
      expect(world.fetch).not.toHaveBeenCalled()
    },
  )

  it('propagates a source-index filesystem failure before resolving a document', async () => {
    const world = domain()
    const cause = new Error('EIO')
    const readFile = vi.spyOn(world.fs.deps, 'readFile').mockRejectedValue(cause)
    try {
      await expect(parseDocument(LOCAL, world.deps)).rejects.toMatchObject({
        code: ZOTERO_ENRICHMENT_TASK_FAILED,
        cause,
      })
      expect(world.resolveAttachment).not.toHaveBeenCalled()
      expect(world.fetch).not.toHaveBeenCalled()
    } finally {
      readFile.mockRestore()
    }
  })

  it('refuses a corrupt committed artifact instead of resubmitting it', async () => {
    const world = domain()
    const first = await parseDocument(LOCAL, world.deps)
    await world.fs.deps.writeFile(`/parsed/${first.cacheKey}/meta.json`, '{bad')
    world.fetch.mockClear()
    await expect(parseDocument(LOCAL, world.deps)).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_TASK_FAILED,
    })
    expect(world.fetch).not.toHaveBeenCalled()
  })

  it('preserves a domain attachment-resolution error', async () => {
    const world = domain()
    const cause = new ZoteroError('The core is unavailable', ZOTERO_PROVIDER_UNAVAILABLE)
    world.resolveAttachment.mockRejectedValue(cause)
    await expect(parseDocument(LOCAL, world.deps)).rejects.toBe(cause)
    expect(world.fetch).not.toHaveBeenCalled()
  })

  it('rejects invalid PDF bytes before submission', async () => {
    const world = domain()
    await expect(
      parseDocument({ ...LOCAL, bytes: new TextEncoder().encode('not a PDF') }, world.deps),
    ).rejects.toMatchObject({ code: ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT })
    expect(world.fetch).not.toHaveBeenCalled()
  })

  it('rejects an oversized attachment before reading it', async () => {
    const world = domain()
    world.sourceFiles.stat.mockResolvedValue({ size: 11 * 1024 * 1024, mtimeMs: 1 })
    await expect(parseDocument(LOCAL, world.deps)).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT,
    })
    expect(world.sourceFiles.readFile).not.toHaveBeenCalled()
    expect(world.fetch).not.toHaveBeenCalled()
  })

  it('does not trust a failing URL revalidation or redownload cached documents', async () => {
    const world = domain()
    await parseDocument(URL_INPUT, world.deps)
    world.fetch.mockRejectedValue(new Error('HEAD offline'))
    const before = world.calls.length
    await expect(parseDocument(URL_INPUT, world.deps)).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_TASK_FAILED,
    })
    expect(world.calls.slice(before).map((call) => call.init.method)).toEqual(['HEAD'])
  })
})

describe('parseDocument parse failures', () => {
  it('preserves stable parser errors', async () => {
    const cause = new ZoteroError('MinerU task failed', ZOTERO_ENRICHMENT_TASK_FAILED)
    const world = failedDomain(cause)
    await expect(parseDocument(LOCAL, world.deps)).rejects.toBe(cause)
  })

  it('converts an unexpected external failure into a stable task error', async () => {
    const cause = new Error('unexpected provider failure')
    const world = failedDomain(cause)
    await expect(parseDocument(LOCAL, world.deps)).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_TASK_FAILED,
      cause,
    })
  })

  it('reports a corrupt precise result archive without advancing the source index', async () => {
    const world = domain({ mode: 'pro', allowDocumentUpload: true })
    const normal = world.fetch.getMockImplementation()!
    world.fetch.mockImplementation(async (url, init) =>
      url.endsWith('result.zip') ? new Response('invalid ZIP') : await normal(url, init),
    )
    await expect(parseDocument(LOCAL, world.deps)).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_ARCHIVE_INVALID,
    })
    expect(await world.store.sourceRecord(sourceKeyOf(LOCAL.key))).toBeUndefined()
  })

  it('retains the last good artifact and index when a new generation fails', async () => {
    const world = domain()
    const first = await parseDocument(LOCAL, world.deps)
    const index = await world.store.sourceRecord(sourceKeyOf(LOCAL.key))
    world.fetch.mockRejectedValue(new Error('new parse failed'))
    await expect(
      parseDocument(LOCAL, { ...world.deps, generation: NEXT_GENERATION }),
    ).rejects.toMatchObject({ code: ZOTERO_ENRICHMENT_TASK_FAILED })
    expect(await world.store.sourceRecord(sourceKeyOf(LOCAL.key))).toEqual(index)
    expect(await world.store.get(first.cacheKey)).toMatchObject({ markdown: MARKDOWN })
  })

  it('fails an empty Markdown result without recording a source', async () => {
    const world = domain()
    const normal = world.fetch.getMockImplementation()!
    world.fetch.mockImplementation(async (url, init) =>
      url.endsWith('/full.md') ? new Response('   ') : await normal(url, init),
    )
    await expect(parseDocument(LOCAL, world.deps)).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_TASK_FAILED,
    })
    expect(await world.store.sourceRecord(sourceKeyOf(LOCAL.key))).toBeUndefined()
  })
})

describe('parseDocument cancellation and progress', () => {
  it('preserves an already-aborted caller reason before any side effect', async () => {
    const world = domain()
    const controller = new AbortController()
    const reason = { cancelledBy: 'caller' }
    controller.abort(reason)
    await expect(parseDocument(LOCAL, world.deps, controller.signal)).rejects.toBe(reason)
    expect(world.storeFactory).not.toHaveBeenCalled()
    expect(world.fetch).not.toHaveBeenCalled()
  })

  it('stops before acquiring bytes when the job cancels at the acquisition boundary', async () => {
    const world = domain()
    const controller = new AbortController()
    const reason = new Error('cancel acquisition')
    await expect(
      parseDocument(
        LOCAL,
        {
          ...world.deps,
          onProgress: (phase) => {
            if (phase === 'acquiring') controller.abort(reason)
          },
        },
        controller.signal,
      ),
    ).rejects.toBe(reason)
    expect(world.resolveAttachment).not.toHaveBeenCalled()
    expect(world.sourceFiles.readFile).not.toHaveBeenCalled()
    expect(world.fetch).not.toHaveBeenCalled()
  })

  it('waits for source-read cleanup before settling cancellation', async () => {
    const world = domain()
    const entered = deferred()
    const release = deferred<typeof PDF>()
    const controller = new AbortController()
    const reason = new Error('cancel source')
    world.sourceFiles.readFile.mockImplementation(async () => {
      entered.resolve()
      return await release.promise
    })
    const pending = parseDocument(LOCAL, world.deps, controller.signal)
    const outcome = pending.catch((error: unknown) => error)
    let settled = false
    void outcome.then(() => {
      settled = true
    })
    await entered.promise
    controller.abort(reason)
    expect(settled).toBe(false)
    release.resolve(PDF)
    expect(await outcome).toBe(reason)
    expect(world.fetch).not.toHaveBeenCalled()
  })

  it('waits for the last shared flight to clean up before settling cancellation', async () => {
    const world = domain()
    const entered = deferred()
    const aborted = deferred()
    const cleanup = deferred()
    const controller = new AbortController()
    const reason = new Error('cancel upload')
    const normal = world.fetch.getMockImplementation()!
    world.fetch.mockImplementation(async (url, init) => {
      if (init?.method !== 'PUT') return await normal(url, init)
      entered.resolve()
      init.signal?.addEventListener('abort', () => aborted.resolve(), { once: true })
      await cleanup.promise
      init.signal?.throwIfAborted()
      return new Response(null)
    })
    const outcome = parseDocument(LOCAL, world.deps, controller.signal).catch(
      (error: unknown) => error,
    )
    let settled = false
    void outcome.then(() => {
      settled = true
    })
    await entered.promise
    controller.abort(reason)
    await aborted.promise
    expect(settled).toBe(false)
    cleanup.resolve()
    expect(await outcome).toBe(reason)
    expect(await world.store.sourceRecord(sourceKeyOf(LOCAL.key))).toBeUndefined()
  })

  it('reports phases only at their actual acquisition, network, validation and persistence boundaries', async () => {
    const world = domain()
    const phases: string[] = []
    await parseDocument(LOCAL, { ...world.deps, onProgress: (phase) => phases.push(phase) })
    expect(phases).toEqual([
      'acquiring',
      'uploading',
      'uploading',
      'waiting',
      'downloading',
      'validating',
      'writing',
      'writing',
    ])
    expect(await world.store.sourceRecord(sourceKeyOf(LOCAL.key))).toBeDefined()
  })
})
