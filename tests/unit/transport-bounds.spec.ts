import { describe, expect, it } from 'vitest'
import {
  ResponseTooLargeError,
  readBoundedBytes,
  readBoundedText,
} from '../../src/transport-bounds.js'

/**
 * A response whose body streams `chunks` of `size` bytes.
 * @param chunks - how many chunks to emit.
 * @param size - bytes per chunk.
 * @returns a streaming response.
 */
function streamOf(chunks: number, size: number): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < chunks; i += 1) controller.enqueue(new Uint8Array(size).fill(65))
      controller.close()
    },
  })
  return new Response(body)
}

describe('bounded body readers', () => {
  it('returns the decoded text of a body inside the ceiling', async () => {
    expect(await readBoundedText(streamOf(3, 4), 100)).toBe('A'.repeat(12))
  })

  it('refuses a text body past the ceiling', async () => {
    await expect(readBoundedText(streamOf(3, 4), 10)).rejects.toThrow(ResponseTooLargeError)
  })

  it('returns the bytes of a body inside the ceiling', async () => {
    const bytes = await readBoundedBytes(streamOf(3, 4), 100)
    expect(bytes.byteLength).toBe(12)
  })

  it('refuses a byte body past the ceiling', async () => {
    await expect(readBoundedBytes(streamOf(3, 4), 10)).rejects.toThrow(ResponseTooLargeError)
  })

  it('handles a response with no readable body', async () => {
    // 204 carries no body; the reader must not treat that as a failure.
    const empty = new Response(null, { status: 204 })
    expect(await readBoundedText(empty, 10)).toBe('')
    const emptyBytes = await readBoundedBytes(empty, 10)
    expect(emptyBytes.byteLength).toBe(0)
  })

  it('refuses a byte body without reader past the ceiling', async () => {
    const response = new Response(new Uint8Array(20).fill(1))
    Object.defineProperty(response, 'body', { value: null })
    await expect(readBoundedBytes(response, 10)).rejects.toThrow(ResponseTooLargeError)
  })

  it('refuses a text body without reader past the ceiling', async () => {
    const response = new Response(new Uint8Array(20).fill(65))
    Object.defineProperty(response, 'body', { value: null })
    await expect(readBoundedText(response, 10)).rejects.toThrow(ResponseTooLargeError)
  })

  it('reports the ceiling it enforced', async () => {
    await expect(readBoundedText(streamOf(2, 8), 10)).rejects.toMatchObject({
      maxBytes: 10,
    })
  })

  it('returns a single-chunk byte body without copying it', async () => {
    const bytes = await readBoundedBytes(streamOf(1, 5), 100)
    expect(bytes.byteLength).toBe(5)
  })
})
