/** Real archive Worker plus deterministic admission and cancellation. */
import { Worker } from 'node:worker_threads'
import { build } from 'esbuild'
import { zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { ArchiveProcessor, type ArchiveWorkerFactory } from '../../src/enrichment/archive-worker.ts'
import { ARTIFACT_READER_DEFAULTS } from '../../src/artifact-reader-preferences.ts'
import { deferred } from '../helpers/sync.ts'

const encoder = new TextEncoder()
const archive = () =>
  zipSync({
    'full.md': encoder.encode('# Worker\n\n![kept](images/kept.png)'),
    'images/kept.png': new Uint8Array([137, 80, 78, 71]),
    'images/unused.png': new Uint8Array([1, 2, 3]),
    'content_list.json': encoder.encode('[{"type":"image"}]'),
  })

async function actualFactory(): Promise<ArchiveWorkerFactory> {
  const result = await build({
    entryPoints: ['src/enrichment/zip-worker.ts'],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    target: 'node24',
    packages: 'bundle',
  })
  const source = result.outputFiles[0]!.text
  return (_entry, bytes) =>
    new Worker(source, {
      eval: true,
      execArgv: [],
      workerData: bytes,
      transferList: [bytes.buffer as ArrayBuffer],
    })
}

describe('archive Worker', () => {
  it('executes the actual entry, returns only referenced figures and transfers owned buffers', async () => {
    const input = archive()
    const processor = new ArchiveProcessor(undefined, await actualFactory())
    const files = await processor.run(new AbortController().signal, async () =>
      processor.extract(input, new AbortController().signal),
    )
    expect(files.markdown).toContain('# Worker')
    expect(files.contentList).toBe('[{"type":"image"}]')
    expect(files.images.map((image) => image.name)).toEqual(['images/kept.png'])
    expect(files.images[0]!.data).toEqual(new Uint8Array([137, 80, 78, 71]))
    // The download's borrowed source remains intact; only the owned copy moves.
    expect(input.byteLength).toBeGreaterThan(0)
  })

  it('runs the source entry under Node without a test loader', async () => {
    const processor = new ArchiveProcessor()
    const signal = new AbortController().signal
    const files = await processor.run(signal, async () => processor.extract(archive(), signal))
    expect(files.images).toHaveLength(1)
  })

  it('returns archive validation failures through the typed Host boundary', async () => {
    const processor = new ArchiveProcessor(undefined, await actualFactory())
    await expect(
      processor.extract(new Uint8Array([1, 2, 3]), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'ZOTERO_ENRICHMENT_ARCHIVE_INVALID' })
  })

  it('waits for terminate on cancellation and never falls back to synchronous extraction', async () => {
    const worker = new Worker('setInterval(()=>{},1000)', { eval: true, execArgv: [] })
    const terminate = vi.spyOn(worker, 'terminate')
    const factory = vi.fn<ArchiveWorkerFactory>(() => worker)
    const processor = new ArchiveProcessor(undefined, factory)
    const abort = new AbortController()
    const operation = processor.extract(archive(), abort.signal)
    const verdict = expect(operation).rejects.toMatchObject({ name: 'AbortError' })
    abort.abort()
    await verdict
    expect(terminate).toHaveBeenCalledOnce()
    expect(worker.threadId).toBe(-1)
  })

  it('reports invalid messages and exits without a result', async () => {
    for (const source of ["require('node:worker_threads').parentPort.postMessage({ok:true})", '']) {
      const processor = new ArchiveProcessor(
        undefined,
        () => new Worker(source, { eval: true, execArgv: [] }),
      )
      await expect(
        processor.extract(archive(), new AbortController().signal),
      ).rejects.toMatchObject({ code: 'ZOTERO_ENRICHMENT_TASK_FAILED' })
    }
  })

  it('never spawns after prior cancellation and preserves spawn failures', async () => {
    const factory = vi.fn<ArchiveWorkerFactory>(() => {
      throw new Error('spawn refused')
    })
    const processor = new ArchiveProcessor(undefined, factory)
    const signal = AbortSignal.abort()
    await expect(processor.extract(archive(), signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(factory).not.toHaveBeenCalled()
    await expect(processor.extract(archive(), new AbortController().signal)).rejects.toThrow(
      'spawn refused',
    )
  })
})

describe('archive admission', () => {
  it('holds a slot through persistence, bounds waiting, and cancels a queued operation', async () => {
    const processor = new ArchiveProcessor(() => ({
      ...ARTIFACT_READER_DEFAULTS,
      archiveConcurrency: 1,
      archiveQueueLimit: 1,
    }))
    const entered = deferred<void>()
    const persisted = deferred<void>()
    const first = processor.run(new AbortController().signal, async () => {
      entered.resolve()
      await persisted.promise
    })
    await entered.promise
    const abort = new AbortController()
    const queued = vi.fn(async () => {})
    const second = processor.run(abort.signal, queued)
    const verdict = expect(second).rejects.toMatchObject({ name: 'AbortError' })
    await expect(processor.run(new AbortController().signal, queued)).rejects.toMatchObject({
      code: 'ZOTERO_ENRICHMENT_TASK_FAILED',
    })
    abort.abort()
    await verdict
    persisted.resolve()
    await first
    await processor.run(new AbortController().signal, queued)
    expect(queued).toHaveBeenCalledOnce()
  })
})
