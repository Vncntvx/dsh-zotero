/** Durable result handles are recovered only from recorded tool blocks. */
import { createContext } from 'react'
import { RESULT_RECEIPT_PREFIX } from '../constants.ts'
import { isRecord } from '../json.ts'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'

export const ResultSessionContext = createContext<string | undefined>(undefined)
export interface ResultCoordinates {
  readonly seq: number
  readonly index: number
}

export function receiptOf(block: ToolCallBlock): Record<string, unknown> | null {
  if (!('content' in block) || block.isError) return null
  const file = block.content.find((entry) => entry.type === 'file')
  if (file?.type !== 'file') return null
  for (const entry of block.content) {
    if (entry.type !== 'text' || !entry.text.startsWith(RESULT_RECEIPT_PREFIX)) continue
    try {
      const receipt: unknown = JSON.parse(
        entry.text.slice(RESULT_RECEIPT_PREFIX.length).split('\n')[0]!,
      )
      if (
        isRecord(receipt) &&
        receipt['delivery'] === 'file' &&
        receipt['version'] === 1 &&
        typeof receipt['tool'] === 'string' &&
        receipt['tool'].startsWith('zotero_') &&
        isRecord(receipt['file']) &&
        receipt['file']['attachmentId'] === file.attachment.attachmentId
      )
        return receipt
    } catch {
      /* Malformed persisted projections provide no authority. */
    }
  }
  return null
}

/** response.json waits for EOF, including the AttachmentStore's integrity check. */
export async function readCompleteResult(
  sessionId: string,
  coordinates: ResultCoordinates,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const query = new URLSearchParams({
    sessionId,
    seq: String(coordinates.seq),
    index: String(coordinates.index),
  })
  const response = await fetch(`/api/zotero/result?${query}`, { signal })
  if (!response.ok) throw new Error(`Result read failed (${response.status})`)
  const value: unknown = await response.json()
  if (!isRecord(value) || value['version'] !== 1 || !isRecord(value['data']))
    throw new Error('Invalid complete result')
  return value['data']
}

/** Preserve native export text, including whitespace; citation mode owns per-ref HTML. */
export function rawExportText(data: Record<string, unknown>): string | undefined {
  if (typeof data['text'] === 'string') return data['text']
  const citations = data['citations']
  if (data['format'] !== 'citation' || !Array.isArray(citations)) return undefined
  const rows: string[] = []
  for (const entry of citations) {
    if (!isRecord(entry) || typeof entry['ref'] !== 'string' || typeof entry['text'] !== 'string')
      return undefined
    rows.push(`${entry['ref']}: ${entry['text']}`)
  }
  return rows.join('\n')
}
