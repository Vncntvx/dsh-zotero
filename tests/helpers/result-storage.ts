/** External immutable-file and durable-index boundaries for delivery composition tests. */
import type { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { vi } from 'vitest'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'

export function resultStorage(ctx: Context) {
  const files = new Map<string, Uint8Array>()
  const receipts = new Map<string, unknown>()
  const put = vi.fn(async (key: string, value: unknown) => {
    receipts.set(key, value)
  })
  const save = vi.fn(
    async (input: { data: AsyncIterable<Uint8Array>; name?: string; signal?: AbortSignal }) => {
      const chunks: Uint8Array[] = []
      for await (const chunk of input.data) {
        input.signal?.throwIfAborted()
        chunks.push(chunk)
      }
      const bytes = Buffer.concat(chunks)
      const attachmentId = createHash('sha256').update(bytes).digest('hex')
      files.set(attachmentId, bytes)
      return {
        attachmentId,
        name: input.name ?? 'result.json',
        bytes: bytes.length,
      } as FileAttachmentRef
    },
  )
  ctx.provide('attachments', {
    saveFileStream: save,
    async *readFileStream(ref: FileAttachmentRef, signal?: AbortSignal) {
      const bytes = files.get(ref.attachmentId)
      if (
        !bytes ||
        bytes.length !== ref.bytes ||
        createHash('sha256').update(bytes).digest('hex') !== ref.attachmentId
      )
        throw new Error('Corrupt result file')
      signal?.throwIfAborted()
      yield bytes
    },
  } as never) // Only external service operations consumed by production are substituted.
  ctx.provide('storageDomain', {
    open: vi.fn(async () => ({
      table: () => ({ get: (key: string) => receipts.get(key), put }),
      close: async () => {},
    })),
  } as never)
  return { files, receipts, put, save }
}
