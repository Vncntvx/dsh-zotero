/** Authenticated, event-addressed reads; clients cannot supply paths or attachment IDs. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-session-query'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ResultDelivery } from './result-delivery.js'
import { RESULT_RECEIPT_PREFIX } from './constants.js'
import { asRecord } from './json.js'

export async function readResult(
  ctx: Context,
  delivery: ResultDelivery,
  request: Request,
): Promise<Response> {
  const query = new URL(request.url).searchParams
  const id = query.get('sessionId')
  const seq = coordinate(query.get('seq'))
  const index = coordinate(query.get('index'))
  if (!id || seq === undefined || index === undefined)
    return new Response('Invalid result coordinates', { status: 400 })
  try {
    const { target } = await ctx.sessionQuery.readEvent(
      { sessionId: id as SessionId, seq: seq as SessionSeq, before: 0, after: 0 },
      request.signal,
    )
    const data = asRecord(target.data)
    const message = asRecord(data?.message)
    const content = message?.content ?? data?.content
    const blocks = Array.isArray(content) ? content : []
    const files = blocks.filter((block) => asRecord(block)?.type === 'file')
    const meta = asRecord(data?.meta)
    let attachment = asRecord(asRecord(files[index])?.attachment)
    // Standard blocks remain readable after replay/fork without a running job registry.
    const announced = blocks.some((block) => {
      const text = asRecord(block)?.text
      if (typeof text !== 'string' || !text.startsWith(RESULT_RECEIPT_PREFIX)) return false
      try {
        const receipt = asRecord(
          JSON.parse(text.slice(RESULT_RECEIPT_PREFIX.length).split('\n')[0]!),
        )
        return (
          receipt?.delivery === 'file' &&
          asRecord(receipt.file)?.attachmentId === attachment?.attachmentId
        )
      } catch {
        return false
      }
    })
    if (!announced) attachment = undefined
    // An original background acknowledgement is also a durable owning-call coordinate.
    if (
      !attachment &&
      index === 0 &&
      target.type === 'tool/result' &&
      typeof meta?.resultSessionId === 'string' &&
      typeof message?.toolCallId === 'string' &&
      ['background', 'promoted'].includes(String(meta.kind))
    ) {
      const receipt = await delivery.receipt(meta.resultSessionId, message.toolCallId)
      if (receipt && receipt.jobId === meta.jobId) attachment = receipt.file
    }
    if (!attachment || !['tool/result', 'tool/ptc-dispatch', 'user/message'].includes(target.type))
      return new Response('Result file not found', { status: 404 })
    const source = ctx.attachments
      .readFileStream(attachment as unknown as FileAttachmentRef, request.signal)
      [Symbol.asyncIterator]()
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await source.next()
          if (chunk.done) controller.close()
          else controller.enqueue(chunk.value)
        } catch (error) {
          controller.error(error)
        }
      },
      async cancel() {
        await source.return?.()
      },
    })
    return new Response(stream, {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  } catch {
    request.signal.throwIfAborted()
    return new Response('Result unavailable', { status: 404 })
  }
}
function coordinate(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : undefined
}
export function registerResultRoute(ctx: Context, delivery: ResultDelivery): void {
  ctx.inject(['connection', 'sessionQuery', 'attachments'], (host) => {
    host.connection.fetch.register({
      path: '/api/zotero/result',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: (request) => readResult(host, delivery, request),
    })
  })
}
