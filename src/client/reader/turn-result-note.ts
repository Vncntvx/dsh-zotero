import type { ChatSnapshot, TurnTailChatData } from '@deepseek-ai/dsh-client-ui-chat/client'
import { ZOTERO_READER_NOTE_TEXT_CHARS } from '../../constants.ts'
import type { HistoricalPdfCitation } from './historical-citations.ts'

export function turnAnswer(snapshot: ChatSnapshot, turn: number, seq: number) {
  for (const key of snapshot.locations.getTurn(turn)) {
    const node = snapshot.nodes.get(key)
    if (node?.kind !== 'turn-tail' || node.visibility !== 'visible') continue
    const data = node.data as TurnTailChatData
    const answer = data.closing
    if (answer?.finalNode.seq !== seq) continue
    if (answer.status !== 'settled') return undefined
    return (
      answer.blocks
        .filter((block) => block.kind === 'text')
        .map(({ text }) => text)
        .join('\n\n')
        .trim() || undefined
    )
  }
}

export function resultNoteMarkdown(answer: string, citation: HistoricalPdfCitation) {
  const source =
    '```json\n' +
    JSON.stringify({
      attachmentRef: citation.attachmentRef,
      fingerprint: citation.fingerprint,
      ...(citation.position && { page: citation.position.pageIndex + 1 }),
    }) +
    '\n```\n\n'
  const cap = ZOTERO_READER_NOTE_TEXT_CHARS - source.length
  if (answer.length <= cap) return source + answer
  const end = cap - 2
  const edge = answer.charCodeAt(end - 1)
  return source + answer.slice(0, edge >= 0xd800 && edge <= 0xdbff ? end - 1 : end).trimEnd() + '…'
}
