/**
 * The per-service single-flight coordinator: one shared task, independent
 * caller cancellation, and isolation between service instances.
 * @module tests/host/enrichment-parse-flight
 */

import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { cacheKeyOf, ParseFlight, type ParseOnceResult } from '../../src/enrichment/parse-once.ts'
import { attachmentRef } from '../helpers/server/keys.ts'
import { deferred } from '../helpers/sync.ts'

const input = {
  identity: attachmentRef(),
  generation: '7e8148b0-924e-4d05-9c87-1d56792df325',
  bytes: new TextEncoder().encode('%PDF-1.7 body'),
  mode: 'free' as const,
}
const result: ParseOnceResult = {
  artifact: {
    markdown: '# parsed',
    meta: {
      version: 2,
      parser: 'mineru',
      format: 'markdown',
      sourceId: createHash('sha256').update(input.identity).digest('hex'),
      generation: input.generation,
      identity: input.identity,
      mode: input.mode,
      contentFingerprint: createHash('sha256').update(input.bytes).digest('hex'),
      taskId: 't',
      files: ['full.md'],
    },
  },
  cacheKey: cacheKeyOf(input),
  cached: false,
}

describe('ParseFlight', () => {
  it.each([false, true])(
    'shares the complete result with cached=%s between callers',
    async (cached) => {
      const flight = new ParseFlight()
      const gate = deferred<ParseOnceResult>()
      const task = vi.fn(async () => await gate.promise)
      const shared = { ...result, cached }

      const first = flight.run('key', undefined, task)
      const second = flight.run('key', undefined, task)
      gate.resolve(shared)

      await expect(first).resolves.toBe(shared)
      await expect(second).resolves.toBe(shared)
      expect(task).toHaveBeenCalledTimes(1)
    },
  )

  it('rejects only the caller whose signal aborted', async () => {
    const flight = new ParseFlight()
    const gate = deferred<ParseOnceResult>()
    const task = vi.fn(async () => await gate.promise)
    const leader = new AbortController()

    const first = flight.run('key', leader.signal, task)
    const second = flight.run('key', undefined, task)
    leader.abort(new Error('leader cancelled'))

    await expect(first).rejects.toThrow('leader cancelled')
    gate.resolve(result)
    await expect(second).resolves.toBe(result)
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('aborts the shared task when every waiter has left', async () => {
    const flight = new ParseFlight()
    const settled = deferred()
    const task = vi.fn(async (signal: AbortSignal) => {
      try {
        return await new Promise<ParseOnceResult>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      } finally {
        settled.resolve()
      }
    })
    const a = new AbortController()
    const b = new AbortController()

    const first = flight.run('key', a.signal, task)
    const second = flight.run('key', b.signal, task)
    a.abort(new Error('a'))
    b.abort(new Error('b'))

    await expect(first).rejects.toThrow('a')
    await expect(second).rejects.toThrow('b')
    await settled.promise
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('does not share work between generation keys', async () => {
    const flight = new ParseFlight()
    const gate = deferred<ParseOnceResult>()
    const generation = 'f05ae92a-7ed7-4f86-9a13-1051122dfdeb'
    const nextResult: ParseOnceResult = {
      ...result,
      artifact: { ...result.artifact, meta: { ...result.artifact.meta, generation } },
      cacheKey: cacheKeyOf({ ...input, generation }),
    }
    const firstTask = vi.fn(async () => await gate.promise)
    const nextTask = vi.fn(async () => nextResult)

    const first = flight.run(result.cacheKey, undefined, firstTask)
    const next = flight.run(nextResult.cacheKey, undefined, nextTask)
    gate.resolve(result)

    await expect(first).resolves.toBe(result)
    await expect(next).resolves.toBe(nextResult)
    expect(firstTask).toHaveBeenCalledTimes(1)
    expect(nextTask).toHaveBeenCalledTimes(1)
  })

  it('does not share work between service instances', async () => {
    const first = new ParseFlight()
    const second = new ParseFlight()
    const a = vi.fn(async () => result)
    const b = vi.fn(async () => result)

    await expect(first.run('key', undefined, a)).resolves.toBe(result)
    await expect(second.run('key', undefined, b)).resolves.toBe(result)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })
})
