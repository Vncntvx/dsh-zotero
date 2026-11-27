import type {
  ChatConversationViewNode,
  TurnTailChatData,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import { expect, it } from 'vitest'
import { resultNoteMarkdown, turnAnswer } from '../../../src/client/reader/turn-result-note.ts'
import type { HistoricalPdfCitation } from '../../../src/client/reader/historical-citations.ts'
import { ZOTERO_READER_NOTE_TEXT_CHARS } from '../../../src/constants.ts'
import { chatOf } from '../helpers/sources-tab-harness.tsx'

function snapshot(tail: TurnTailChatData) {
  const node = { kind: 'turn-tail', data: tail, visibility: 'visible' } as ChatConversationViewNode
  const chat = chatOf([node])
  return {
    ...chat,
    locations: { getTurn: (turn: number) => (turn === 3 ? chat.order : []), getStep: () => [] },
  }
}

const tail = (closing: TurnTailChatData['closing']): TurnTailChatData =>
  ({ turn: 3, seq: 8, time: 0, branchUnavailable: false, closing }) as TurnTailChatData

const citation: HistoricalPdfCitation = {
  attachmentRef: 'zotero://user/0/attachment/ABCD1234?server=library-a',
  fingerprint: `sha256:${'a'.repeat(64)}`,
  title: 'Methods paper',
  position: { pageIndex: 4, rects: [] },
}

it('projects only the matching settled turn tail and visible text blocks', () => {
  const state = snapshot(
    tail({
      status: 'settled',
      turn: 3,
      step: 1,
      time: 0,
      blocks: [
        { kind: 'reasoning', text: 'Private reasoning' },
        { kind: 'text', text: ' Finding one ' },
        { kind: 'text', text: 'Finding two ' },
      ],
      finalNode: { kind: 'assistant', seq: 8, turn: 3, step: 1, time: 0, blocks: [] },
    }),
  )
  expect(turnAnswer(state, 3, 8)).toBe('Finding one \n\nFinding two')
  expect(turnAnswer(state, 3, 7)).toBeUndefined()
  expect(turnAnswer(state, 2, 8)).toBeUndefined()
})

it.each(['running', 'interrupted'] as const)(
  'does not expose an unsettled %s answer as a result note',
  (status) => {
    const state = snapshot(
      tail({
        status,
        turn: 3,
        step: 1,
        time: 0,
        blocks: [{ kind: 'text', text: 'Partial answer' }],
        finalNode: { kind: 'assistant', seq: 8, turn: 3, step: 1, time: 0, blocks: [] },
      }),
    )
    expect(turnAnswer(state, 3, 8)).toBeUndefined()
  },
)

it('serializes the cited attachment identity and physical page with the answer', () => {
  const markdown = resultNoteMarkdown('Reviewed finding.', citation)
  const [source, answer] = markdown.split('\n\n')
  expect(JSON.parse(source!.replace(/^```json\n|\n```$/gu, ''))).toEqual({
    attachmentRef: citation.attachmentRef,
    fingerprint: citation.fingerprint,
    page: 5,
  })
  expect(answer).toBe('Reviewed finding.')
})

it('caps long answers without leaving a split Unicode surrogate', () => {
  const answer = 'a'.repeat(ZOTERO_READER_NOTE_TEXT_CHARS) + '𝒳'
  const markdown = resultNoteMarkdown(answer, { ...citation, position: undefined })
  const [source, body] = markdown.split('\n\n')
  const sourceLength = `${source}\n\n`.length
  expect(body).toMatch(/…$/u)
  expect(body).not.toContain('\uD835')
  expect(markdown.length).toBeLessThanOrEqual(ZOTERO_READER_NOTE_TEXT_CHARS)
  expect(source).not.toContain('"page"')
  expect(body!.length).toBeLessThanOrEqual(ZOTERO_READER_NOTE_TEXT_CHARS - sourceLength)
})

it('preserves a complete short answer and omits an invalid negative page', () => {
  const markdown = resultNoteMarkdown('Short answer', { ...citation, position: undefined })
  expect(markdown.endsWith('Short answer')).toBe(true)
  expect(markdown).not.toContain('"page"')
})
