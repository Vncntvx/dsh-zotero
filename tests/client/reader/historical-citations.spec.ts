import type {
  ChatConversationViewNode,
  UserMessageNode,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import { expect, it } from 'vitest'
import { turnCitations } from '../../../src/client/reader/historical-citations.ts'
import { NOTE_KEY, itemRef } from '../../helpers/server/keys.ts'
import { chatOf } from '../helpers/sources-tab-harness.tsx'

const REF = 'zotero://group/12/attachment/ABCD1234?server=library-a'
const DIGEST = 'a'.repeat(64)
const NOTE = `${itemRef(NOTE_KEY)}?server=library-a`

function snapshot(text: string, extra: UserMessageNode['content'] = []) {
  const user: UserMessageNode = {
    kind: 'user',
    source: null,
    time: 0,
    seq: 1,
    content: [{ type: 'text', text }, ...(extra as UserMessageNode['content'])],
  }
  const chat = chatOf([
    { kind: 'user', data: user, visibility: 'visible' } as ChatConversationViewNode,
  ])
  return {
    ...chat,
    locations: { getTurn: (turn: number) => (turn === 1 ? chat.order : []), getStep: () => [] },
  }
}

const quote = (value: unknown) => `> ${JSON.stringify(value)}\n`
const base = {
  attachmentRef: REF,
  libraryRef: 'zotero://group/12/',
  instanceId: 'library-a',
  fingerprint: `sha256:${DIGEST}`,
}

it('projects valid note, parsed, text and page citations and skips malformed records', () => {
  const state = snapshot(
    [
      quote({ noteRef: NOTE, sourceType: 'note', noteVersion: 3 }),
      quote({
        ...base,
        title: 'Page paper',
        pages: [{ pageIndex: 2, rects: [null, { x: 1, y: 2, width: 0, height: 4 }] }],
      }),
      quote({
        ...base,
        title: 'Page paper',
        pages: [{ pageIndex: 2, rects: [{ x: 1, y: 2, width: 3, height: 4 }] }],
      }),
      quote({
        attachmentRef: REF,
        documentType: 'parsed',
        artifactId: DIGEST,
        fingerprint: DIGEST,
      }),
      quote({
        attachmentRef: REF,
        documentType: 'parsed',
        artifactId: DIGEST,
        fingerprint: DIGEST,
        textRange: { start: 2, end: 2 },
      }),
      quote({ attachmentRef: REF, documentType: 'text', textRange: { start: 1, end: 2 } }),
      quote({ attachmentRef: REF, documentType: 'text', textRange: { start: 2, end: 1 } }),
    ].join('\n'),
  )
  expect(turnCitations(state, 1)).toEqual([
    { noteRef: NOTE, title: NOTE, noteVersion: 3 },
    {
      attachmentRef: REF,
      fingerprint: `sha256:${DIGEST}`,
      title: 'Page paper',
      position: { pageIndex: 2, rects: [] },
    },
    {
      attachmentRef: REF,
      fingerprint: `sha256:${DIGEST}`,
      title: 'Page paper',
      position: { pageIndex: 2, rects: [{ x: 1, y: 2, width: 3, height: 4 }] },
    },
    { attachmentRef: REF, title: REF, documentType: 'text', textRange: { start: 1, end: 2 } },
  ])
})

it('ignores non-text blocks and caps a turn at 32 citations', () => {
  const citations = Array.from({ length: 40 }, (_, index) =>
    quote({ ...base, title: `Paper ${index}`, pages: [{ pageIndex: 0, rects: [] }] }),
  ).join('\n')
  const state = snapshot(citations, [{ type: 'reasoning', text: 'private' }])
  expect(turnCitations(state, 1)).toHaveLength(32)
})

it('falls back to the note and attachment refs when titles are absent', () => {
  const state = snapshot(
    quote({ noteRef: NOTE, sourceType: 'note' }) +
      '\n' +
      quote({ attachmentRef: REF, documentType: 'text', textRange: { start: 0, end: 3 } }) +
      '\n' +
      quote({
        attachmentRef: REF,
        documentType: 'parsed',
        artifactId: DIGEST,
        fingerprint: DIGEST,
        textRange: { start: 0, end: 2 },
      }),
  )
  expect(turnCitations(state, 1).map((citation) => citation.title)).toEqual([NOTE, REF, DIGEST])
})
