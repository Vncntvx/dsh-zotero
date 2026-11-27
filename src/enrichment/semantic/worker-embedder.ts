/** Hard model-open and inference deadlines terminate the entire owned WASM runtime. */
import { Worker } from 'node:worker_threads'
import { asRecord } from '../../json.js'
import type { SemanticModelEntry } from '../../enrichment-model-catalog.js'
import type { Embedder } from './session.js'
import type { BundleSnapshot } from '../model-installation.js'
import { workerEntryUrl } from '../worker-bootstrap.js'
import { SemanticBundleFailure } from './bundle-failure.js'

export const SEMANTIC_OPEN_DEADLINE_MS = 180_000
export const SEMANTIC_RUN_DEADLINE_MS = 120_000
export type SemanticWorkerFactory = (spec: SemanticModelEntry, dir: string) => Worker

const spawnSemanticWorker: SemanticWorkerFactory = (spec, dir) => {
  const entry = workerEntryUrl(new URL('./model-worker.js', import.meta.url), [
    '@deepseek-ai/dsh-error',
    '@deepseek-ai/dsh-tools',
    '@deepseek-ai/dsh-typert-protocol',
  ])
  return new Worker(entry, {
    workerData: { spec, dir },
    execArgv: [],
    resourceLimits: { maxOldGenerationSizeMb: 1024, maxYoungGenerationSizeMb: 64, stackSizeMb: 8 },
  })
}

interface Pending {
  readonly count: number
  readonly finish: (error: unknown, vectors?: Float32Array[]) => void
  readonly cleanup: () => void
}

export async function openWorkerEmbedder(
  spec: SemanticModelEntry,
  dir: string,
  factory: SemanticWorkerFactory = spawnSemanticWorker,
  signal?: AbortSignal,
): Promise<Embedder> {
  signal?.throwIfAborted()
  const worker = factory(spec, dir)
  const pending = new Map<number, Pending>()
  let nextId = 1,
    ready = false,
    closed = false
  let termination: Promise<void> | undefined
  let openResolve: (embedder: Embedder) => void = () => {}
  let openReject: (error: unknown) => void = () => {}
  const opening = new Promise<Embedder>((resolve, reject) => {
    openResolve = resolve
    openReject = reject
  })
  const stop = (
    reason: unknown = new Error('The semantic model worker has been terminated'),
  ): Promise<void> => {
    if (termination !== undefined) return termination
    closed = true
    signal?.removeEventListener('abort', abortOpening)
    clearTimeout(openTimer)
    const interrupted = [...pending.values()]
    for (const request of interrupted) request.cleanup()
    pending.clear()
    worker.removeAllListeners('message')
    termination = worker
      .terminate()
      .then(() => {})
      .finally(() => {
        worker.removeAllListeners()
        for (const request of interrupted) request.finish(reason)
      })
    return termination
  }
  const fail = (error: unknown): void => {
    // A serialized model switch can advance only after its predecessor has exited.
    void stop(error).then(
      () => openReject(error),
      () => openReject(error),
    )
  }
  const openTimer = setTimeout(
    () => fail(new Error('Semantic model opening exceeded its 180-second deadline')),
    SEMANTIC_OPEN_DEADLINE_MS,
  )
  const abortOpening = (): void => fail(signal!.reason)
  signal?.addEventListener('abort', abortOpening, { once: true })
  const embedder: Embedder = {
    dimension: spec.dimension,
    get unavailable() {
      return closed
    },
    async embed(texts, side, signal) {
      signal?.throwIfAborted()
      if (closed) throw new Error('The semantic model worker is unavailable')
      const id = nextId++
      return await new Promise<Float32Array[]>((resolve, reject) => {
        let settled = false
        const finish = (error: unknown, vectors?: Float32Array[]): void => {
          if (settled) return
          settled = true
          if (error !== undefined) reject(error)
          else resolve(vectors!)
        }
        const abort = (): void => {
          finish(signal!.reason)
          try {
            worker.postMessage({ op: 'cancel', id })
          } catch (error) {
            fail(error)
          }
        }
        const timer = setTimeout(
          () => fail(new Error('Semantic inference exceeded its 120-second deadline')),
          SEMANTIC_RUN_DEADLINE_MS,
        )
        const cleanup = (): void => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', abort)
        }
        pending.set(id, { count: texts.length, finish, cleanup })
        signal?.addEventListener('abort', abort, { once: true })
        try {
          worker.postMessage({ op: 'embed', id, texts: [...texts], side })
        } catch (error) {
          pending.delete(id)
          cleanup()
          finish(error)
          fail(error)
        }
      })
    },
    dispose: async () => await stop(),
  }
  worker.on('error', fail)
  worker.on('exit', (code) => {
    if (!closed) fail(new Error(`Semantic model worker exited unexpectedly (${code})`))
  })
  worker.on('message', (message: unknown) => {
    const row = asRecord(message)
    if (row?.type === 'ready' && !ready && row.dimension === spec.dimension) {
      ready = true
      signal?.removeEventListener('abort', abortOpening)
      clearTimeout(openTimer)
      openResolve(embedder)
      return
    }
    if (row?.type === 'fatal') {
      const message = typeof row.message === 'string' ? row.message : 'Semantic worker failed'
      const bundle = asRecord(row.bundle)
      const snapshot = asRecord(bundle?.snapshot)
      fail(
        !ready &&
          (bundle?.kind === 'missing' || bundle?.kind === 'corrupt') &&
          typeof snapshot?.dir === 'string' &&
          typeof snapshot.catalogFingerprint === 'string' &&
          typeof snapshot.identityFingerprint === 'string'
          ? new SemanticBundleFailure(message, bundle.kind, bundle.snapshot as BundleSnapshot)
          : new Error(message),
      )
      return
    }
    const request = typeof row?.id === 'number' ? pending.get(row.id) : undefined
    if (!ready || request === undefined) {
      fail(new Error('Semantic model worker returned an invalid response'))
      return
    }
    pending.delete(row!.id as number)
    request.cleanup()
    if (row?.type === 'error' && typeof row.message === 'string') {
      request.finish(new Error(row.message))
      return
    }
    const vectors = row?.vectors
    if (
      row?.type !== 'result' ||
      !Array.isArray(vectors) ||
      vectors.length !== request.count ||
      vectors.some(
        (vector) =>
          !(vector instanceof Float32Array) ||
          vector.length !== spec.dimension ||
          !vector.every(Number.isFinite),
      )
    ) {
      const error = new Error('Semantic model worker returned invalid embedding vectors')
      request.finish(error)
      fail(error)
      return
    }
    request.finish(undefined, vectors)
  })
  if (signal?.aborted) abortOpening()
  return await opening
}
