// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReaderTab, type ReaderTabFace } from '../../../src/client/reader/ReaderTab.tsx'
import { readerAddress } from '../../../src/client/reader/address.ts'
import { readerZh } from '../../../src/client/reader/locales.ts'
import { itemRef } from '../../helpers/server/keys.ts'
import { inputActionsStub } from '../helpers/zotero-client.ts'
import { propsOf, REF, SESSION } from './support/reader-tab.ts'
import { createHash, webcrypto } from 'node:crypto'

type TextAttachment = Awaited<ReturnType<ReaderTabFace['readTextAttachment']>>

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function open(
  format: TextAttachment['format'],
  text: string,
  eof = true,
  citation?: import('../../../src/client/reader/historical-citations.ts').HistoricalTextCitation,
  overrides: Partial<ReaderTabFace> = {},
) {
  const readTextAttachment = vi.fn<ReaderTabFace['readTextAttachment']>().mockResolvedValue({
    format,
    data: new TextEncoder().encode(text),
    parentRef: itemRef(),
    eof,
  })
  const inputActions = {
    ...inputActionsStub(),
    captureInsertion: vi.fn(() => ({ start: 0, end: 0, draftRev: 0 })),
    addAttachments: vi.fn(),
    removeAttachment: vi.fn(),
    pruneAttachments: vi.fn(),
    insertQuote: vi.fn<(draft: string) => boolean>(() => true),
  }
  const props = propsOf({ readTextAttachment, ...overrides }, readerAddress(SESSION, REF, 'text'))
  render(
    <ReaderTab
      {...props}
      inputActions={inputActions}
      useTabInfo={() => {
        const info = props.useTabInfo()
        return {
          ...info,
          tab: {
            ...info.tab,
            navigation: { ...info.tab.navigation, params: { textCitation: citation } },
          },
        }
      }}
    />,
  )
  return { inputActions, readTextAttachment }
}

function select(node: HTMLElement, start = 0, end = node.textContent!.length) {
  const selection = document.getSelection()!
  selection.removeAllRanges()
  const range = document.createRange()
  range.setStart(node.firstChild!, start)
  range.setEnd(node.firstChild!, end)
  selection.addRange(range)
  fireEvent(document, new Event('selectionchange'))
}

it('recreates HTML snapshot headings without active links, scripts, or image requests', async () => {
  open(
    'html',
    '<title>Metadata</title><h1>Main heading</h1><p><a href="https://example.org/">Link</a><img src="https://example.org/figure"></p><script>Hidden</script>',
  )
  expect(await screen.findByRole('heading', { name: 'Main heading' })).toBeTruthy()
  expect(screen.queryByText('Metadata')).toBeNull()
  expect(screen.queryByText('Hidden')).toBeNull()
  expect(screen.queryByRole('link', { name: 'Link' })).toBeNull()
  expect(screen.queryByRole('img')).toBeNull()
  expect(screen.getByText(readerZh.noteImage)).toBeTruthy()
})

it('renders Markdown headings, reference-image alternatives, and a partial-read notice', async () => {
  open(
    'markdown',
    '# Findings\n\n![Caption][image]\n\n[image]: https://example.org/figure\n\n**Strong**',
    false,
  )
  expect(await screen.findByRole('heading', { name: 'Findings' })).toBeTruthy()
  expect(screen.getByText('Strong').tagName).toBe('STRONG')
  expect(screen.getByText('Caption').tagName).toBe('P')
  expect(screen.queryByRole('img')).toBeNull()
  expect(screen.getByText(readerZh.documentPartial)).toBeTruthy()
})

it('finds text across inline markup and navigates matches in the attachment', async () => {
  class TestHighlight extends Set<Range> {
    constructor(...ranges: Range[]) {
      super(ranges)
    }
  }
  const highlights = new Map()
  vi.stubGlobal('Highlight', TestHighlight)
  vi.stubGlobal('CSS', { highlights })
  open('html', '<p>Same <strong>sentence</strong> appears.</p><p>same sentence appears again.</p>')
  fireEvent.change(await screen.findByRole('searchbox', { name: readerZh.documentFind }), {
    target: { value: 'SAME SENTENCE' },
  })
  expect(await screen.findByText('1 / 2')).toBeTruthy()
  const currentParagraph = () =>
    [...highlights.get('zotero-reader-current-search')!][0]?.startContainer.parentElement?.closest(
      'p',
    )?.textContent
  expect(currentParagraph()).toBe('Same sentence appears.')
  fireEvent.click(screen.getByRole('button', { name: readerZh.findNext }))
  expect(screen.getByText('2 / 2')).toBeTruthy()
  expect(currentParagraph()).toBe('same sentence appears again.')
  fireEvent.click(screen.getByRole('button', { name: readerZh.findPrevious }))
  expect(screen.getByText('1 / 2')).toBeTruthy()
})

it('quotes selected plain text using a UTF-16 range without a PDF page', async () => {
  const { inputActions } = open('text', 'Result: 𝒳 and y')
  const paragraph = await screen.findByText('Result: 𝒳 and y')
  select(paragraph, 8, 10)
  const toolbar = screen.getByRole('group', { name: readerZh.documentSelection })
  fireEvent.click(within(toolbar).getByRole('button', { name: readerZh.quote }))
  const [draft] = inputActions.insertQuote.mock.calls[0]!
  expect(draft).toContain('𝒳')
  expect(JSON.parse(draft.split('\n\n').at(-1)!)).toMatchObject({
    attachmentRef: REF,
    documentType: 'text',
    textRange: { start: 8, end: 10 },
    precision: 'text',
  })
  expect(inputActions.persistDraft).toHaveBeenCalledOnce()
})

it('retries a failed text read through the same attachment resolution', async () => {
  const readTextAttachment = vi
    .fn<ReaderTabFace['readTextAttachment']>()
    .mockRejectedValueOnce(new Error('Attachment unavailable'))
    .mockResolvedValueOnce({
      format: 'text',
      data: new TextEncoder().encode('Recovered text'),
      eof: true,
    })
  open('text', '', true, undefined, { readTextAttachment })
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: readerZh.retry }))
  expect(await screen.findByText('Recovered text')).toBeTruthy()
  expect(readTextAttachment.mock.calls.map(([session, ref]) => [session, ref])).toEqual([
    [SESSION, REF],
    [SESSION, REF],
  ])
  expect(readTextAttachment.mock.calls[0]?.[2].aborted).toBe(true)
})

it('sends a selected text range for in-Reader translation only on explicit submission', async () => {
  const translate = vi.fn<ReaderTabFace['translate']>().mockResolvedValue('Translated text')
  const { inputActions } = open('text', 'Snapshot source', true, undefined, { translate })
  select(await screen.findByText('Snapshot source'), 0, 8)
  fireEvent.click(screen.getByRole('button', { name: readerZh.translation }))
  fireEvent.change(screen.getByRole('combobox', { name: readerZh.translationTarget }), {
    target: { value: 'ja' },
  })
  expect(translate).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: readerZh.translationModel }))
  await screen.findByText('Translated text')
  expect(translate).toHaveBeenCalledExactlyOnceWith(
    { sessionId: SESSION, text: 'Snapshot', target: 'ja' },
    expect.any(AbortSignal),
  )
  fireEvent.click(screen.getByRole('button', { name: readerZh.translationQuote }))
  const [draft] = inputActions.insertQuote.mock.calls[0]!
  expect(draft).toContain(`Snapshot\n\n${readerZh.translationResult}\nTranslated text`)
  expect(JSON.parse(draft.split('\n\n').at(-1)!)).toMatchObject({
    attachmentRef: REF,
    textRange: { start: 0, end: 8 },
    translation: { target: 'ja', engine: 'model' },
  })
})

it('previews a text excerpt image and quotes its original character range', async () => {
  const fillText = vi.fn()
  const canvas = {
    fillRect: vi.fn(),
    fillText,
    measureText: (text: string) => ({ width: text.length * 12 }),
  }
  const getContext = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(canvas as unknown as CanvasRenderingContext2D)
  const png = new Blob(['fixture excerpt bitmap'], { type: 'image/png' })
  const encode = vi
    .spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation((callback) => callback(png))
  const revoke = vi.fn()
  vi.stubGlobal(
    'URL',
    class extends URL {
      static override createObjectURL = () => 'blob:text-excerpt'
      static override revokeObjectURL = revoke
    },
  )
  try {
    const { inputActions } = open('text', 'Local excerpt')
    select(await screen.findByText('Local excerpt'), 6)
    fireEvent.click(screen.getByRole('button', { name: readerZh.documentCapture }))
    const capture = screen.getByRole('region', { name: readerZh.documentCapture })
    const dialog = within(capture)
    expect(document.activeElement).toBe(capture)
    expect((await dialog.findByRole('img')).getAttribute('src')).toBe('blob:text-excerpt')
    expect(fillText).toHaveBeenCalledWith(
      'excerpt',
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    )
    expect(encode).toHaveBeenCalledOnce()
    fireEvent.click(dialog.getByRole('button', { name: readerZh.captureQuote }))
    expect(
      JSON.parse(inputActions.insertQuote.mock.calls[0]![0].split('\n\n').at(-1)!),
    ).toMatchObject({
      attachmentRef: REF,
      textRange: { start: 6, end: 13 },
      sourceType: 'screenshot',
    })
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: readerZh.documentCapture })).toBeNull()
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:text-excerpt')
  } finally {
    getContext.mockRestore()
    encode.mockRestore()
  }
})

it('recovers an exact rendered range across formatting with a matching complete fingerprint', async () => {
  vi.stubGlobal('crypto', webcrypto)
  const ranges = new Set<Range>()
  vi.stubGlobal(
    'Highlight',
    class extends Set<Range> {
      add(range: Range) {
        ranges.add(range)
        return super.add(range)
      }
      delete(range: Range) {
        ranges.delete(range)
        return super.delete(range)
      }
    },
  )
  vi.stubGlobal('CSS', { highlights: new Map() })
  const html = '<p>Start <b>verified</b> result</p>'
  open('html', html, true, {
    attachmentRef: REF,
    title: 'Source',
    documentType: 'html',
    fingerprint: `sha256:${createHash('sha256').update(html).digest('hex')}`,
    textRange: { start: 6, end: 21 },
  })
  await screen.findByText(readerZh.documentCitationFound)
  expect([...ranges].map(String)).toEqual(['verified result'])
  cleanup()
  expect(ranges.size).toBe(0)
})

it.each([
  {
    kind: 'a partial read',
    text: 'Public excerpt',
    eof: false,
    type: 'text',
    pastEnd: false,
    notice: 'documentCitationUnverified',
  },
  {
    kind: 'a changed document format',
    text: 'Public excerpt',
    eof: true,
    type: 'html',
    pastEnd: false,
    notice: 'quoteAttachmentChanged',
  },
  {
    kind: 'an out-of-bounds range',
    text: 'Public excerpt',
    eof: true,
    type: 'text',
    pastEnd: true,
    notice: 'documentCitationMissing',
  },
] as const)(
  'shows a citation status for $kind without highlighting a range',
  async ({ text, eof, type, pastEnd, notice }) => {
    vi.stubGlobal('crypto', webcrypto)
    const highlights = new Map()
    vi.stubGlobal('CSS', { highlights })
    const addHighlight = vi.fn()
    vi.stubGlobal(
      'Highlight',
      class {
        add = addHighlight
      },
    )
    open('text', text, eof, {
      attachmentRef: REF,
      title: 'Source',
      documentType: type,
      fingerprint: `sha256:${createHash('sha256').update(text).digest('hex')}`,
      textRange: pastEnd ? { start: 13, end: 50 } : { start: 0, end: 6 },
    })
    expect(await screen.findByText(readerZh[notice])).toBeTruthy()
    expect(screen.getByText(text)).toBeTruthy()
    expect(highlights.size).toBe(0)
    expect(addHighlight).not.toHaveBeenCalled()
  },
)

it('refuses NUL-containing attachment text before rendering', async () => {
  open('text', 'valid prefix\0binary payload')
  expect((await screen.findByRole('alert')).textContent).toBe(readerZh.documentReadFailed)
  expect(screen.queryByText(/valid prefix|binary payload/)).toBeNull()
})
