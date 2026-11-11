/**
 * The per-service single-flight coordinator: one shared task, independent
 * caller cancellation, and isolation between service instances.
 * @module tests/host/enrichment-parse-flight
 */

import { describe, expect, it, vi } from 'vitest'
import { ParseFlight } from '../../src/enrichment/parse-once.ts'
import type { ParsedArtifact } from '../../src/enrichment/types.ts'

const artifact: ParsedArtifact = {
  markdown: '# parsed',
  meta: { identity: 'x', mode: 'free', contentFingerprint: 'f', taskId: 't', files: [] },
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('ParseFlight', () => {
  it('runs one shared task for two callers', async () => {
    const flight = new ParseFlight()
    const gate = deferred<ParsedArtifact>()
    const task = vi.fn(async () => await gate.promise)

    const first = flight.run('key', undefined, task)
    const second = flight.run('key', undefined, task)
    gate.resolve(artifact)

    await expect(first).resolves.toBe(artifact)
    await expect(second).resolves.toBe(artifact)
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('rejects only the caller whose signal aborted', async () => {
    const flight = new ParseFlight()
    const gate = deferred<ParsedArtifact>()
    const task = vi.fn(async () => await gate.promise)
    const leader = new AbortController()

    const first = flight.run('key', leader.signal, task)
    const second = flight.run('key', undefined, task)
    leader.abort(new Error('leader cancelled'))

    await expect(first).rejects.toThrow('leader cancelled')
    gate.resolve(artifact)
    await expect(second).resolves.toBe(artifact)
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('aborts the shared task when every waiter has left', async () => {
    const flight = new ParseFlight()
    const task = vi.fn(
      async (signal: AbortSignal) =>
        await new Promise<ParsedArtifact>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    )
    const a = new AbortController()
    const b = new AbortController()

    const first = flight.run('key', a.signal, task)
    const second = flight.run('key', b.signal, task)
    a.abort(new Error('a'))
    b.abort(new Error('b'))

    await expect(first).rejects.toThrow('a')
    await expect(second).rejects.toThrow('b')
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('does not share work between service instances', async () => {
    const first = new ParseFlight()
    const second = new ParseFlight()
    const a = vi.fn(async () => artifact)
    const b = vi.fn(async () => artifact)

    await first.run('key', undefined, a)
    await second.run('key', undefined, b)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })
})
