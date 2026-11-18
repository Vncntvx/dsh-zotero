/** Serialized inference and cancellation on the model worker's owned port. */
import type { MessagePort } from 'node:worker_threads'
import { openSemanticEmbedder } from './bundle.js'
import type { SemanticModelEntry } from '../../enrichment-model-catalog.js'
import type { EmbeddingSide } from './tokenizer.js'
import type { Embedder } from './session.js'
import { SemanticBundleFailure } from './bundle-failure.js'

type Request =
  { op: 'embed'; id: number; texts: string[]; side: EmbeddingSide } | { op: 'cancel'; id: number }
export async function serveModelWorker(
  port: MessagePort,
  target: { spec: SemanticModelEntry; dir: string },
  open: (spec: SemanticModelEntry, dir: string) => Promise<Embedder> = openSemanticEmbedder,
): Promise<() => Promise<void>> {
  let queue: Promise<void> = Promise.resolve()
  let closing: Promise<void> | undefined
  let closed = false
  const controllers = new Map<number, AbortController>()
  try {
    const embedder = await open(target.spec, target.dir)
    const dispose = (): Promise<void> => {
      closing ??= (async () => {
        closed = true
        port.off('message', receive)
        for (const controller of controllers.values())
          controller.abort(new Error('Semantic worker port closed'))
        await queue
        await embedder.dispose()
      })()
      return closing
    }
    const receive = (message: Request): void => {
      if (message.op === 'cancel') {
        controllers.get(message.id)?.abort(new Error('Embedding request cancelled'))
        return
      }
      const controller = new AbortController()
      controllers.set(message.id, controller)
      queue = queue.then(async () => {
        try {
          controller.signal.throwIfAborted()
          const vectors = await embedder.embed(message.texts, message.side, controller.signal)
          controller.signal.throwIfAborted()
          const buffers = [...new Set(vectors.map((vector) => vector.buffer as ArrayBuffer))]
          port.postMessage({ type: 'result', id: message.id, vectors }, buffers)
        } catch (error) {
          if (!closed)
            port.postMessage({
              type: 'error',
              id: message.id,
              message: error instanceof Error ? error.message : String(error),
            })
        } finally {
          controllers.delete(message.id)
        }
      })
    }
    port.on('message', receive)
    port.once('close', () => {
      void dispose().catch(() => {})
    })
    port.postMessage({ type: 'ready', dimension: embedder.dimension })
    return dispose
  } catch (error) {
    port.postMessage({
      type: 'fatal',
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof SemanticBundleFailure
        ? { bundle: { kind: error.kind, snapshot: error.snapshot } }
        : {}),
    })
    return async () => {}
  }
}
