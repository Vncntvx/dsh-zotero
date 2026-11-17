/** Real message ports exercise the production dispatcher over an injected model boundary. */
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { serveModelWorker } from '../../src/enrichment/semantic/worker-runtime.js'
import { tinyModel } from '../helpers/semantic-model-bundle.js'
import { deferred } from '../helpers/sync.js'
import type { Embedder } from '../../src/enrichment/semantic/session.js'

const ports: MessagePort[] = []
const disposers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.allSettled(disposers.splice(0).map((dispose) => dispose()))
  for (const port of ports.splice(0)) port.close()
})
function channel() {
  const pair = new MessageChannel()
  ports.push(pair.port1, pair.port2)
  return pair
}
function message(port: MessagePort): Promise<Record<string, unknown>> {
  return new Promise((resolve) => port.once('message', resolve))
}
const target = { spec: tinyModel, dir: '/synthetic/no-model' }
async function serve(port: MessagePort, embed: Embedder['embed'], dispose = vi.fn(async () => {})) {
  const close = await serveModelWorker(port, target, async () => ({ dimension: 2, embed, dispose }))
  disposers.push(close)
  return { close, dispose }
}

describe('semantic worker inference dispatcher', () => {
  it('reports readiness and transfers the ordered vector buffers', async () => {
    const pair = channel(),
      ready = message(pair.port1)
    const vectors = [new Float32Array([1, 2]), new Float32Array([3, 4])]
    const embed = vi.fn(async () => vectors)
    await serve(pair.port2, embed)
    expect(await ready).toEqual({ type: 'ready', dimension: 2 })
    const result = message(pair.port1)
    pair.port1.postMessage({ op: 'embed', id: 1, texts: ['one', 'two'], side: 'document' })
    expect(await result).toEqual({
      type: 'result',
      id: 1,
      vectors: [new Float32Array([1, 2]), new Float32Array([3, 4])],
    })
    expect(embed).toHaveBeenCalledWith(['one', 'two'], 'document', expect.any(AbortSignal))
    expect(vectors.map((vector) => vector.byteLength)).toEqual([0, 0])
  })

  it('serializes two requests and cancels a queued request before inference starts', async () => {
    const pair = channel(),
      started = deferred<void>(),
      finish = deferred<Float32Array[]>()
    const ready = message(pair.port1)
    const embed = vi.fn(async () => {
      started.resolve()
      return await finish.promise
    })
    await serve(pair.port2, embed)
    await ready
    const replies: unknown[] = []
    const two = deferred<void>()
    pair.port1.on('message', (reply) => {
      replies.push(reply)
      if (replies.length === 2) two.resolve()
    })
    pair.port1.postMessage({ op: 'embed', id: 1, texts: ['one'], side: 'query' })
    await started.promise
    pair.port1.postMessage({ op: 'embed', id: 2, texts: ['two'], side: 'document' })
    pair.port1.postMessage({ op: 'cancel', id: 2 })
    // Observe the owned cancellation message after the production listener processes it.
    const seen = deferred<void>()
    const observe = (message: { op: string; id: number }) => {
      if (message.op === 'cancel' && message.id === 2) {
        pair.port2.off('message', observe)
        seen.resolve()
      }
    }
    pair.port2.on('message', observe)
    await seen.promise
    finish.resolve([new Float32Array([1, 1])])
    await two.promise
    expect(embed).toHaveBeenCalledTimes(1)
    expect(replies).toEqual([
      { type: 'result', id: 1, vectors: [new Float32Array([1, 1])] },
      { type: 'error', id: 2, message: 'Embedding request cancelled' },
    ])
  })

  it.each([new Error('Model rejected input'), 'non-error failure'])(
    'reports an inference failure and serves the next request',
    async (error) => {
      const pair = channel(),
        ready = message(pair.port1)
      const embed = vi
        .fn<Embedder['embed']>()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce([new Float32Array([2, 1])])
      await serve(pair.port2, embed)
      await ready
      const first = message(pair.port1)
      pair.port1.postMessage({ op: 'embed', id: 1, texts: ['one'], side: 'query' })
      expect(await first).toEqual({
        type: 'error',
        id: 1,
        message: error instanceof Error ? error.message : error,
      })
      const second = message(pair.port1)
      pair.port1.postMessage({ op: 'embed', id: 2, texts: ['two'], side: 'query' })
      expect(await second).toMatchObject({ type: 'result', id: 2 })
    },
  )

  it('aborts active work on disposal, drains it and disposes its model once', async () => {
    const pair = channel(),
      ready = message(pair.port1),
      started = deferred<void>()
    const embed: Embedder['embed'] = async (_texts, _side, signal) =>
      await new Promise((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })
        started.resolve()
      })
    const { close, dispose } = await serve(pair.port2, embed)
    await ready
    pair.port1.postMessage({ op: 'embed', id: 1, texts: ['one'], side: 'query' })
    await started.promise
    await Promise.all([close(), close()])
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it.each([new Error('Missing bundle'), 'failed to open'])(
    'reports a model-opening failure without installing an inference listener',
    async (error) => {
      const pair = channel(),
        fatal = message(pair.port1)
      const close = await serveModelWorker(pair.port2, target, async () => {
        throw error
      })
      disposers.push(close)
      expect(await fatal).toEqual({
        type: 'fatal',
        message: error instanceof Error ? error.message : error,
      })
      expect(pair.port2.listenerCount('message')).toBe(0)
    },
  )
})
