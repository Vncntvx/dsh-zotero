/** Real threads prove hard termination without loading a model or contacting the network. */
import { Worker, MessageChannel } from 'node:worker_threads'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  openWorkerEmbedder,
  SEMANTIC_OPEN_DEADLINE_MS,
  SEMANTIC_RUN_DEADLINE_MS,
  type SemanticWorkerFactory,
} from '../../src/enrichment/semantic/worker-embedder.js'
import { SemanticEmbedderLoader } from '../../src/enrichment/semantic/loader.js'
import { tinyModel } from '../helpers/semantic-model-bundle.js'
import { deferred } from '../helpers/sync.js'
import type { Embedder } from '../../src/enrichment/semantic/session.js'

const workers: Worker[] = []
const models: Embedder[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.allSettled(models.splice(0).map((model) => model.dispose()))
  await Promise.allSettled(workers.splice(0).map((worker) => worker.terminate()))
})
function workerOf(
  source: string,
  data?: unknown,
  transferList: import('node:worker_threads').Transferable[] = [],
): Worker {
  const worker = new Worker(
    new URL(
      `data:text/javascript,${encodeURIComponent("import {parentPort,workerData} from 'node:worker_threads';\n" + source)}`,
    ),
    { execArgv: [], workerData: data, transferList },
  )
  workers.push(worker)
  return worker
}
const good: SemanticWorkerFactory = () =>
  workerOf(
    `parentPort.on('message',m=>{if(m.op==='embed')parentPort.postMessage({type:'result',id:m.id,vectors:m.texts.map(text=>new Float32Array([text.length,1]))})});parentPort.postMessage({type:'ready',dimension:2});`,
  )
async function opened(factory: SemanticWorkerFactory = good): Promise<Embedder> {
  const model = await openWorkerEmbedder(tinyModel, '/synthetic/no-model', factory)
  models.push(model)
  return model
}

describe('isolated semantic runtime lifecycle', () => {
  it('boots the real source worker and refuses a missing bundle before loading the runtime', async () => {
    await expect(openWorkerEmbedder(tinyModel, '/synthetic/absent-model-bundle')).rejects.toThrow(
      /not installed|missing|unusable/i,
    )
  })
  it('returns ordered typed vectors through the actual thread channel and terminates once', async () => {
    const model = await opened()
    expect((await model.embed(['a', 'longer'], 'document')).map((vector) => [...vector])).toEqual([
      [1, 1],
      [6, 1],
    ])
    const terminate = vi.spyOn(workers[0]!, 'terminate')
    await Promise.all([model.dispose(), model.dispose()])
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(model.unavailable).toBe(true)
    await expect(model.embed(['later'], 'document')).rejects.toThrow('unavailable')
  })

  it('terminates an uncooperative model open before rejecting and permits the next queued model', async () => {
    vi.useFakeTimers()
    const started = deferred<void>()
    let exited = false
    const blocked: SemanticWorkerFactory = () => {
      const worker = workerOf('while(true){}')
      worker.once('online', () => started.resolve())
      worker.once('exit', () => {
        exited = true
      })
      return worker
    }
    const loader = new SemanticEmbedderLoader({
      open: async (target) =>
        await openWorkerEmbedder(
          target.spec,
          target.dir,
          target.dir.endsWith('/blocked') ? blocked : good,
        ),
    })
    const first = loader.scope({ spec: tinyModel, dir: '/synthetic/blocked' })
    const second = loader.scope({ spec: tinyModel, dir: '/synthetic/good' })
    const rejected = expect(first.embedder()).rejects.toThrow('180-second deadline')
    const following = second.embedder()
    await started.promise
    await vi.advanceTimersByTimeAsync(SEMANTIC_OPEN_DEADLINE_MS)
    await rejected
    expect(exited).toBe(true)
    const model = await following
    expect((await model.embed(['next'], 'query'))[0]).toEqual(new Float32Array([4, 1]))
    first.release()
    second.release()
    await loader.dispose()
  })

  it('terminates a blocked WASM run and settles every admitted call with the deadline reason', async () => {
    vi.useFakeTimers()
    const channel = new MessageChannel()
    const running = deferred<void>()
    channel.port1.once('message', () => running.resolve())
    const model = await opened(() =>
      workerOf(
        `parentPort.on('message',m=>{if(m.op==='embed'){workerData.trace.postMessage('running');while(true){}}});parentPort.postMessage({type:'ready',dimension:2})`,
        { trace: channel.port2 },
        [channel.port2],
      ),
    )
    let exited = false
    workers[0]!.once('exit', () => {
      exited = true
    })
    const first = expect(model.embed(['one'], 'query')).rejects.toThrow('120-second deadline')
    const second = expect(model.embed(['two'], 'document')).rejects.toThrow('120-second deadline')
    await running.promise
    await vi.advanceTimersByTimeAsync(SEMANTIC_RUN_DEADLINE_MS)
    await Promise.all([first, second])
    expect(exited).toBe(true)
    await model.dispose()
    expect(model.unavailable).toBe(true)
    channel.port1.close()
  })

  it('aborts abandoned opening work and skips abandoned queued targets during disposal', async () => {
    const started = deferred<void>(),
      exited = deferred<void>()
    let opens = 0
    const factory: SemanticWorkerFactory = () => {
      opens++
      const worker = workerOf('while(true){}')
      worker.once('online', () => started.resolve())
      worker.once('exit', () => exited.resolve())
      return worker
    }
    const loader = new SemanticEmbedderLoader({
      open: async (target, signal) =>
        await openWorkerEmbedder(target.spec, target.dir, factory, signal),
    })
    const first = loader.scope({ spec: tinyModel, dir: '/synthetic/blocked' })
    const refused = expect(first.embedder()).rejects.toThrow('No ranking scope retains')
    await started.promise
    const queued = loader.scope({ spec: tinyModel, dir: '/synthetic/unneeded' })
    queued.release()
    first.release()
    await loader.dispose()
    await refused
    await exited.promise
    expect(opens).toBe(1)
  })

  it('settles caller cancellation promptly and still consumes the late owned response safely', async () => {
    const channel = new MessageChannel()
    const running = deferred<void>()
    channel.port1.once('message', () => running.resolve())
    const model = await opened(() =>
      workerOf(
        `let held;workerData.trace.on('message',()=>{parentPort.postMessage({type:'result',id:held.id,vectors:[new Float32Array([1,1])]})});parentPort.on('message',m=>{if(m.op==='embed'){held=m;workerData.trace.postMessage('running')}});parentPort.postMessage({type:'ready',dimension:2})`,
        { trace: channel.port2 },
        [channel.port2],
      ),
    )
    const controller = new AbortController(),
      reason = new Error('caller deadline')
    const pending = expect(model.embed(['one'], 'query', controller.signal)).rejects.toBe(reason)
    await running.promise
    controller.abort(reason)
    await pending
    const delivered = deferred<void>()
    workers[0]!.once('message', () => delivered.resolve())
    channel.port1.postMessage('finish')
    await delivered.promise
    expect(model.unavailable).toBe(false)
    await model.dispose()
    channel.port1.close()
  })

  it.each([
    '[new Float32Array([NaN,1])]',
    '[new Float32Array([1])]',
    '[]',
    '[new Int32Array([1,1])]',
  ])('refuses invalid worker vectors %s without retaining the model', async (vectors) => {
    const model = await opened(() =>
      workerOf(
        `parentPort.on('message',m=>{if(m.op==='embed')parentPort.postMessage({type:'result',id:m.id,vectors:${vectors}})});parentPort.postMessage({type:'ready',dimension:2})`,
      ),
    )
    await expect(model.embed(['one'], 'query')).rejects.toThrow('invalid embedding vectors')
    await model.dispose()
    expect(model.unavailable).toBe(true)
  })

  it.each([
    "parentPort.postMessage({type:'ready',dimension:3})",
    "parentPort.postMessage({type:'result',id:1,vectors:[]})",
    'parentPort.postMessage(null)',
    "parentPort.postMessage({type:'fatal'})",
    "throw new Error('Runtime crashed while opening')",
    'process.exit(7)',
  ])('refuses malformed startup or a crashed runtime: %s', async (source) => {
    let exited = false
    const opening = openWorkerEmbedder(tinyModel, '/synthetic/no-model', () => {
      const worker = workerOf(source)
      worker.once('exit', () => {
        exited = true
      })
      return worker
    })
    await expect(opening).rejects.toThrow(
      /invalid response|worker failed|Runtime crashed|unexpectedly/,
    )
    expect(exited).toBe(true)
  })

  it('rejects an unowned response and terminates all outstanding requests', async () => {
    const model = await opened(() =>
      workerOf(
        `parentPort.on('message',m=>{if(m.op==='embed')parentPort.postMessage({type:'result',id:m.id+10,vectors:[new Float32Array([1,1])]})});parentPort.postMessage({type:'ready',dimension:2})`,
      ),
    )
    await expect(model.embed(['one'], 'query')).rejects.toThrow('invalid response')
    expect(model.unavailable).toBe(true)
  })

  it('keeps a healthy worker after an owned inference error', async () => {
    const model = await opened(() =>
      workerOf(
        `let first=true;parentPort.on('message',m=>{if(m.op!=='embed')return;if(first){first=false;parentPort.postMessage({type:'error',id:m.id,message:'Input was rejected'})}else parentPort.postMessage({type:'result',id:m.id,vectors:[new Float32Array([2,1])]})});parentPort.postMessage({type:'ready',dimension:2})`,
      ),
    )
    await expect(model.embed(['first'], 'query')).rejects.toThrow('Input was rejected')
    expect(model.unavailable).toBe(false)
    expect(await model.embed(['second'], 'query')).toEqual([new Float32Array([2, 1])])
  })

  it('does not launch a pre-cancelled model and terminates cancellation during worker creation', async () => {
    const controller = new AbortController(),
      reason = new Error('Opening owner left')
    controller.abort(reason)
    const factory = vi.fn(good)
    await expect(
      openWorkerEmbedder(tinyModel, '/synthetic/no-model', factory, controller.signal),
    ).rejects.toBe(reason)
    expect(factory).not.toHaveBeenCalled()
    const during = new AbortController()
    await expect(
      openWorkerEmbedder(
        tinyModel,
        '/synthetic/no-model',
        () => {
          const worker = workerOf('while(true){}')
          during.abort(reason)
          return worker
        },
        during.signal,
      ),
    ).rejects.toBe(reason)
  })

  it('settles a failed request dispatch and stops the worker', async () => {
    const model = await opened(),
      error = new Error('Worker channel is closed')
    vi.spyOn(workers[0]!, 'postMessage').mockImplementationOnce(() => {
      throw error
    })
    await expect(model.embed(['one'], 'query')).rejects.toBe(error)
    expect(model.unavailable).toBe(true)
  })

  it('preserves caller cancellation when sending cancellation to the worker fails', async () => {
    const channel = new MessageChannel(),
      started = deferred<void>()
    channel.port1.once('message', () => started.resolve())
    const model = await opened(() =>
      workerOf(
        `parentPort.on('message',m=>{if(m.op==='embed')workerData.trace.postMessage('started')});parentPort.postMessage({type:'ready',dimension:2})`,
        { trace: channel.port2 },
        [channel.port2],
      ),
    )
    const controller = new AbortController(),
      reason = new Error('Caller cancelled')
    const refused = expect(model.embed(['one'], 'query', controller.signal)).rejects.toBe(reason)
    await started.promise
    vi.spyOn(workers[0]!, 'postMessage').mockImplementationOnce(() => {
      throw new Error('Closed channel')
    })
    controller.abort(reason)
    await refused
    await model.dispose()
    expect(model.unavailable).toBe(true)
    channel.port1.close()
  })

  it('reopens a terminated resident worker for the next scope of the same model', async () => {
    let opens = 0
    const loader = new SemanticEmbedderLoader({
      open: async (target) => {
        opens++
        return await openWorkerEmbedder(target.spec, target.dir, good)
      },
    })
    const target = { spec: tinyModel, dir: '/synthetic/reopen' }
    const first = loader.scope(target),
      borrowed = await first.embedder()
    await workers[0]!.terminate()
    const exited = deferred<void>()
    // The actual worker has exited; its owning listener has marked it unavailable.
    queueMicrotask(() => exited.resolve())
    await exited.promise
    const next = loader.scope(target)
    const second = await next.embedder()
    expect((await second.embed(['next'], 'query'))[0]).toEqual(new Float32Array([4, 1]))
    expect(opens).toBe(2)
    await expect(borrowed.embed(['old'], 'query')).rejects.toThrow('unavailable')
    first.release()
    next.release()
    await loader.dispose()
  })
})
