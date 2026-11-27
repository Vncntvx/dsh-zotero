// @vitest-environment jsdom
import { formatQuoteText } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ChatConversationViewNode,
  TurnTailChatData,
  UserMessageNode,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReaderTurnCitations } from '../../../src/client/reader/ReaderTurnCitations.tsx'
import { turnCitations } from '../../../src/client/reader/historical-citations.ts'
import { readerShellEn } from '../../../src/client/reader/shell-locales.ts'
import { deferred } from '../../helpers/sync.ts'
import { chatOf } from '../helpers/sources-tab-harness.tsx'
import { makeTranslate } from '../helpers/mock-translate.ts'
import { ReaderNoteMutation } from '../../../src/client/reader/ReaderNote.tsx'
import { readerEn } from '../../../src/client/reader/locales.ts'

const REF = 'zotero://group/12/attachment/ABCD1234?server=library-a'
const VERSION = `sha256:${'a'.repeat(64)}`
const rects = [{ x: 1, y: 2, width: 3, height: 4 }]
const source = {
  attachmentRef: REF,
  fingerprint: VERSION,
  instanceId: 'library-a',
  libraryRef: 'zotero://group/12/',
  title: 'Cited paper',
  pages: [{ pageIndex: 2, pageLabel: 'iv', rects }],
}
const location = {
  attachmentRef: REF,
  fingerprint: VERSION,
  title: 'Cited paper',
  position: { pageIndex: 2, rects },
}
const quoteOf = (value: object) => formatQuoteText(`Quoted passage\n\n${JSON.stringify(value)}`)

function snapshot(text: string, tail?: TurnTailChatData) {
  const user: UserMessageNode = {
    kind: 'user',
    source: null,
    time: 0,
    seq: 1,
    content: [{ type: 'text', text }],
  }
  const chat = chatOf([
    { kind: 'user', data: user, visibility: 'visible' } as ChatConversationViewNode,
    ...(tail
      ? [{ kind: 'turn-tail', data: tail, visibility: 'visible' } as ChatConversationViewNode]
      : []),
  ])
  return {
    ...chat,
    locations: { getTurn: (turn: number) => (turn === 1 ? chat.order : []), getStep: () => [] },
  }
}

afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

it('reads persisted Composer quotes from the selected turn and validates their library binding', () => {
  const state = snapshot(
    [
      JSON.stringify(source),
      quoteOf({ ...source, instanceId: 'mismatched' }),
      quoteOf(source),
      quoteOf({ ...source, title: 'Reference only', pages: [] }),
      'Human question',
    ].join('\n\n'),
  )
  expect(turnCitations(state, 1)).toEqual([
    location,
    { attachmentRef: REF, fingerprint: VERSION, title: 'Reference only' },
  ])
  expect(turnCitations(state, 2)).toEqual([])
})

it('ignores provenance-looking text inside a longer quote and downgrades invalid rectangles', () => {
  const state = snapshot(
    [
      formatQuoteText(`Paragraph\n${JSON.stringify(source)}\nMore document text`),
      quoteOf({
        ...source,
        pages: [{ ...source.pages[0], rects: [{ x: 1, y: 2, width: -3, height: 4 }] }],
      }),
    ].join('\n\n'),
  )
  expect(turnCitations(state, 1)).toEqual([{ ...location, position: { pageIndex: 2, rects: [] } }])
})

it('reopens the PDF sources in one batch quote while rejecting a different instance', () => {
  const state = snapshot(
    quoteOf([
      source,
      { ...source, instanceId: 'wrong-instance' },
      { ...source, pages: [{ pageIndex: 4 }] },
    ]),
  )
  expect(turnCitations(state, 1)).toEqual([
    location,
    { ...location, position: { pageIndex: 4, rects: [] } },
  ])
})

it('keeps a PDF.js-only fingerprint when reopening a saved page citation', async () => {
  const legacy = { ...source, fingerprint: 'pdfjs:legacy-file-id' }
  const state = snapshot(quoteOf(legacy))
  type Props = Parameters<typeof ReaderTurnCitations>[0]
  const openCitation = vi.fn().mockResolvedValue(true)
  const props = {
    openCitation,
    sessionId: 's',
    turn: { turn: 1 },
    seq: 2,
    useChat: ((select) => select(state)) as Props['useChat'],
    useAccess: () => true,
    useRemoteAccess: () => true,
    t: makeTranslate(readerShellEn),
  } as Props
  render(<ReaderTurnCitations {...props} />)

  fireEvent.click(screen.getByRole('button', { name: 'Cited paper · page 3' }))

  expect(openCitation).toHaveBeenCalledExactlyOnceWith(
    's',
    {
      attachmentRef: REF,
      fingerprint: 'pdfjs:legacy-file-id',
      title: 'Cited paper',
      position: { pageIndex: 2, rects },
    },
    expect.any(AbortSignal),
  )
  await act(async () => {})
})

it('keeps exact text ranges for cached parsed citations and rejects malformed artifact identities', () => {
  const parsed = {
    sourceType: 'translation',
    documentType: 'parsed',
    artifactId: 'e'.repeat(64),
    fingerprint: 'f'.repeat(64),
    title: 'Cached passage',
    textRange: { start: 12, end: 27 },
    textPrefix: 'Cached passage',
  }
  const invalid = [
    { ...parsed, artifactId: '../other' },
    { ...parsed, fingerprint: 'changed' },
    { ...parsed, attachmentRef: 'https://example.org/article' },
    { ...parsed, textRange: { start: 12, end: 12 } },
    { ...parsed, textRange: { start: 12, end: 100_000 } },
    { ...parsed, textPrefix: 'longer than the selected text' },
    { ...parsed, textPrefix: false },
  ]
  const state = snapshot(quoteOf([parsed, { ...parsed, attachmentRef: REF }, ...invalid]))
  const { documentType: _type, sourceType: _source, ...citation } = parsed
  expect(turnCitations(state, 1)).toEqual([citation, { ...citation, attachmentRef: REF }])
})

it('reads MinerU boxes from valid quotes and downgrades malformed boxes to the physical page', () => {
  const first = { pageIndex: 3, artifactBox: [100, 200, 300, 400] }
  const state = snapshot(
    [
      quoteOf({ ...source, sourceType: 'mineru', pages: [first] }),
      quoteOf({
        ...source,
        sourceType: 'mineru',
        pages: [{ pageIndex: 8, artifactBox: [100, 200, 1_001, 400] }],
      }),
    ].join('\n\n'),
  )
  expect(turnCitations(state, 1)).toEqual([
    {
      ...location,
      position: { pageIndex: 3, rects: [] },
      artifactRegion: { pageIndex: 3, box: first.artifactBox },
    },
    { ...location, position: { pageIndex: 8, rects: [] }, artifactRegion: { pageIndex: 8 } },
  ])
})

it('reopens text and note citations with independent note access', async () => {
  const noteRef = 'zotero://group/12/item/DCBA4321?server=library-a'
  const state = snapshot(
    quoteOf({
      attachmentRef: REF,
      documentType: 'html',
      fingerprint: VERSION,
      textRange: { start: 8, end: 10 },
      title: 'Snapshot',
    }) +
      '\n\n' +
      quoteOf([{ noteRef, sourceType: 'note', noteVersion: 7, title: 'Source note' }]),
  )
  expect(turnCitations(state, 1)).toEqual([
    {
      attachmentRef: REF,
      documentType: 'html',
      fingerprint: VERSION,
      title: 'Snapshot',
      textRange: { start: 8, end: 10 },
    },
    { noteRef, noteVersion: 7, title: 'Source note' },
  ])
  type Props = Parameters<typeof ReaderTurnCitations>[0]
  const openCitation = vi.fn().mockResolvedValue(true)
  const props = {
    openCitation,
    sessionId: 's',
    turn: { turn: 1 },
    seq: 2,
    useChat: ((select) => select(state)) as Props['useChat'],
    useAccess: () => false,
    useRemoteAccess: () => true,
    t: makeTranslate(readerShellEn),
  } as Props
  render(<ReaderTurnCitations {...props} />)
  expect(screen.queryByRole('button', { name: 'Snapshot' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Source note' }))
  expect(openCitation).toHaveBeenCalledExactlyOnceWith(
    's',
    { noteRef, noteVersion: 7, title: 'Source note' },
    expect.any(AbortSignal),
  )
  await act(async () => {})
})

it('cancels the historical attachment lookup when session access is revoked', async () => {
  const state = snapshot(quoteOf(source))
  type Props = Parameters<typeof ReaderTurnCitations>[0]
  const request = deferred<boolean>()
  const openCitation = vi
    .fn<Props['openCitation']>()
    .mockReturnValueOnce(request.promise)
    .mockResolvedValue(false)
  const props = {
    openCitation,
    useChat: ((select) => select(state)) as Props['useChat'],
    t: makeTranslate(readerShellEn),
    sessionId: 's',
    turn: { turn: 1 },
    useAccess: () => true,
    useRemoteAccess: () => true,
  } as Props
  const { rerender } = render(<ReaderTurnCitations {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Cited paper · page 3' }))
  expect(openCitation).toHaveBeenCalledExactlyOnceWith('s', location, expect.any(AbortSignal))
  const signal = openCitation.mock.calls[0]![2]
  rerender(<ReaderTurnCitations {...props} useRemoteAccess={() => false} />)
  expect(signal.aborted).toBe(true)
  await act(async () => request.resolve(false))
  expect(screen.queryByText(readerShellEn.unavailable)).toBeNull()
  rerender(<ReaderTurnCitations {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Cited paper · page 3' }))
  await screen.findByText(readerShellEn.unavailable)
})

it('lets the user edit the settled answer and sends the result only on explicit note submission', async () => {
  const attachment = 'zotero://user/0/attachment/ABCD1234?server=library-a'
  const parent = 'zotero://user/0/item/DCBA4321?server=library-a'
  const state = snapshot(
    quoteOf({
      ...source,
      attachmentRef: attachment,
      libraryRef: 'zotero://user/0/',
    }),
    {
      turn: 1,
      seq: 6,
      time: 0,
      branchUnavailable: false,
      closing: {
        status: 'settled',
        turn: 1,
        step: 1,
        time: 0,
        blocks: [
          { kind: 'reasoning', text: 'Private process' },
          { kind: 'text', text: 'Model response' },
        ],
        finalNode: { kind: 'assistant', seq: 5, turn: 1, step: 1, time: 0, blocks: [] },
      },
    },
  )
  type Props = Parameters<typeof ReaderTurnCitations>[0]
  const write = vi.fn().mockResolvedValue({ kind: 'applied', message: 'Saved by Zotero' })
  const props = {
    openCitation: vi.fn(),
    useChat: ((select) => select(state)) as Props['useChat'],
    t: makeTranslate(readerShellEn),
    sessionId: 's',
    turn: { turn: 1 },
    seq: 5,
    useAccess: () => true,
    useRemoteAccess: () => true,
    prepareNote: vi.fn().mockResolvedValue({
      ref: parent,
      title: 'Parent paper',
      Editor: ReaderNoteMutation,
      write,
      t: makeTranslate(readerEn),
    }),
  } as Props
  render(<ReaderTurnCitations {...props} />)
  fireEvent.click(screen.getByRole('button', { name: readerShellEn.turnResultNote }))
  const input = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Markdown' })
  expect(input.value).toContain(`"attachmentRef":"${attachment}"`)
  expect(input.value).toContain('Model response')
  expect(input.value).not.toContain('Private process')
  expect(write).not.toHaveBeenCalled()
  const markdown = input.value.replace('Model response', 'Reviewed result')
  fireEvent.change(input, { target: { value: markdown } })
  fireEvent.submit(screen.getByRole('form', { name: readerEn.noteCreate }))
  expect(write).toHaveBeenCalledExactlyOnceWith(
    { operation: 'create', ref: parent, sessionId: 's', markdown },
    expect.any(AbortSignal),
  )
  await screen.findByText('Saved by Zotero')
})
