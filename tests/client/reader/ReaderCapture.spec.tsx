// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReaderCapture } from '../../../src/client/reader/ReaderCapture.tsx'
import { readerEn } from '../../../src/client/reader/locales.ts'
import { attachmentRef, itemRef } from '../../helpers/server/keys.ts'
import { deferred } from '../../helpers/sync.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'

const t = makeTranslate(readerEn)
const source = {
  attachmentRef: attachmentRef(),
  itemRef: itemRef(),
  libraryRef: 'zotero://user/0/',
  fingerprint: 'reader-fixture',
  title: 'Study PDF',
}
const image = {
  png: new Blob(['image fixture'], { type: 'image/png' }),
  width: 200,
  height: 80,
  regions: [{ pageIndex: 1, pageLabel: 'vi', rects: [{ x: 2, y: 4, width: 15, height: 10 }] }],
  text: 'The selected passage',
  textIncomplete: false,
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function prepare(
  capture: Parameters<typeof ReaderCapture>[0]['capture'],
  inputActions?: Parameters<typeof ReaderCapture>[0]['inputActions'],
  locateInParsed?: Parameters<typeof ReaderCapture>[0]['locateInParsed'],
  readParsedText?: Parameters<typeof ReaderCapture>[0]['readParsedText'],
  defaultIncludeSource = false,
) {
  const controller = new AbortController()
  const onClose = vi.fn()
  const view = render(
    <ReaderCapture
      t={t}
      defaultIncludeSource={defaultIncludeSource}
      source={source}
      capture={capture}
      inputActions={inputActions}
      locateInParsed={locateInParsed}
      readParsedText={readParsedText}
      onClose={onClose}
      tabSignal={controller.signal}
    />,
  )
  const frame = screen.getByRole('dialog', { name: readerEn.capture })
  const overlay = frame.firstElementChild!
  vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 100, 80))
  Object.defineProperty(overlay, 'setPointerCapture', { value: vi.fn() })
  const drag = () => {
    fireEvent.pointerDown(overlay, {
      pointerId: 4,
      isPrimary: true,
      button: 0,
      clientX: 100,
      clientY: 80,
    })
    fireEvent.pointerUp(overlay, { pointerId: 4, clientX: 0, clientY: 40 })
  }
  return { ...view, drag, onClose, frame, overlay }
}

it('clamps a backward drag to the page area and releases the confirmed preview on close', async () => {
  const create = vi.fn(() => 'blob:reader-capture')
  const revoke = vi.fn()
  vi.stubGlobal(
    'URL',
    class extends URL {
      static override createObjectURL = create
      static override revokeObjectURL = revoke
    },
  )
  const capture = vi.fn().mockResolvedValue(image)
  const { drag, unmount } = prepare(capture)
  drag()
  expect(capture).toHaveBeenCalledExactlyOnceWith(
    { x: 10, y: 40, width: 90, height: 40 },
    expect.any(AbortSignal),
    undefined,
  )
  const preview = await screen.findByRole('img', { name: readerEn.capturePreview })
  expect(preview.getAttribute('src')).toBe('blob:reader-capture')
  expect(screen.getByText('Study PDF · Physical pages 2')).toBeTruthy()
  unmount()
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:reader-capture')
})

it('cancels parsed-region navigation when the capture preview closes', async () => {
  const answer = deferred<boolean>()
  const locate = vi
    .fn<NonNullable<Parameters<typeof ReaderCapture>[0]['locateInParsed']>>()
    .mockReturnValue(answer.promise)
  const { drag, unmount, onClose } = prepare(vi.fn().mockResolvedValue(image), undefined, locate)
  drag()
  const open = await screen.findByRole('button', { name: readerEn.locateInParsed })
  fireEvent.click(open)
  fireEvent.click(open)
  expect(locate).toHaveBeenCalledExactlyOnceWith(image.regions, image.text, expect.any(AbortSignal))
  expect(open.matches(':disabled')).toBe(true)
  const signal = locate.mock.calls[0]![2]
  unmount()
  expect(signal.aborted).toBe(true)
  await act(async () => answer.resolve(true))
  expect(onClose).not.toHaveBeenCalled()
})

it('previews cached scan text only on request and identifies it in the quoted draft', async () => {
  const text = 'Text recovered from the scan'
  const work = deferred<{ text: string; incomplete: boolean }>()
  const read = vi
    .fn<NonNullable<Parameters<typeof ReaderCapture>[0]['readParsedText']>>()
    .mockReturnValue(work.promise)
  const input = { insertQuote: vi.fn().mockReturnValue(true), persistDraft: vi.fn() }
  const { drag } = prepare(
    vi.fn().mockResolvedValue({ ...image, text: '', textIncomplete: true }),
    input,
    undefined,
    read,
  )
  drag()
  const action = await screen.findByRole('button', { name: readerEn.captureExtractParsed })
  expect(read).not.toHaveBeenCalled()
  fireEvent.click(action)
  fireEvent.click(action)
  expect(read).toHaveBeenCalledExactlyOnceWith(image.regions, expect.any(AbortSignal))
  await act(async () => work.resolve({ text, incomplete: true }))
  expect((await screen.findByText(text)).closest('details')?.open).toBe(true)
  expect(screen.getByText(readerEn.captureTextIncomplete)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: readerEn.captureQuote }))
  const [draft] = input.insertQuote.mock.calls[0] ?? []
  expect(draft).toContain(text)
  expect(JSON.parse(draft.split('\n\n').at(-1))).toEqual({
    ...source,
    sourceType: 'screenshot',
    pages: image.regions,
    textSource: 'cached-mineru',
    textIncomplete: true,
  })
})

it('aborts a cached text read when the capture closes', async () => {
  const work = deferred<{ text: string; incomplete: boolean }>()
  const read = vi
    .fn<NonNullable<Parameters<typeof ReaderCapture>[0]['readParsedText']>>()
    .mockReturnValue(work.promise)
  const { drag, unmount } = prepare(
    vi.fn().mockResolvedValue({ ...image, text: '' }),
    undefined,
    undefined,
    read,
  )
  drag()
  fireEvent.click(await screen.findByRole('button', { name: readerEn.captureExtractParsed }))
  unmount()
  expect(read.mock.calls[0]![1].aborted).toBe(true)
  await act(async () => work.resolve({ text: 'Late OCR', incomplete: false }))
})

it('reports empty and failed cached text reads and permits retrying', async () => {
  vi.stubGlobal(
    'URL',
    class extends URL {
      static override createObjectURL = () => 'blob:reader-capture'
      static override revokeObjectURL = vi.fn()
    },
  )
  const read = vi
    .fn<NonNullable<Parameters<typeof ReaderCapture>[0]['readParsedText']>>()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('cache unavailable'))
  const { drag } = prepare(
    vi.fn().mockResolvedValue({ ...image, text: '', textIncomplete: true }),
    undefined,
    undefined,
    read,
  )
  drag()
  const action = await screen.findByRole('button', { name: readerEn.captureExtractParsed })
  fireEvent.click(action)
  await screen.findByText(readerEn.captureParsedEmpty)
  fireEvent.click(action)
  await screen.findByText(readerEn.captureParsedFailed)
  expect(read).toHaveBeenCalledTimes(2)
})

it('puts the region text and qualified source record in a draft for review', async () => {
  vi.stubGlobal(
    'URL',
    class extends URL {
      static override createObjectURL = () => 'blob:reader-capture'
      static override revokeObjectURL = vi.fn()
    },
  )
  const input = { insertQuote: vi.fn().mockReturnValue(true), persistDraft: vi.fn() }
  const capture = vi.fn().mockResolvedValue(image)
  const { drag } = prepare(capture, input)
  fireEvent.click(screen.getByRole('checkbox', { name: readerEn.captureIncludeSource }))
  drag()
  fireEvent.click(await screen.findByRole('button', { name: readerEn.captureQuote }))
  expect(capture.mock.calls[0]?.[2]).toBe(source.title)
  const [draft] = input.insertQuote.mock.calls[0] ?? []
  expect(draft).toContain(image.text)
  expect(JSON.parse(draft.split('\n\n').at(-1))).toEqual({
    ...source,
    sourceType: 'screenshot',
    pages: image.regions,
  })
  expect(input.persistDraft).toHaveBeenCalledOnce()
  expect(screen.getByText(readerEn.captureQuoteAdded)).toBeTruthy()
})

it('keeps the capture open when the composer rejects a quote', async () => {
  vi.stubGlobal(
    'URL',
    class extends URL {
      static override createObjectURL = () => 'blob:reader-capture'
      static override revokeObjectURL = vi.fn()
    },
  )
  const input = { insertQuote: vi.fn().mockReturnValue(false), persistDraft: vi.fn() }
  const { drag } = prepare(vi.fn().mockResolvedValue(image), input)
  drag()
  fireEvent.click(await screen.findByRole('button', { name: readerEn.captureQuote }))
  expect(await screen.findByText(readerEn.captureQuoteFailed)).toBeTruthy()
  expect(input.persistDraft).not.toHaveBeenCalled()
})

it('copies the preview PNG only after the user requests it', async () => {
  vi.stubGlobal(
    'URL',
    class extends URL {
      static override createObjectURL = () => 'blob:reader-capture'
      static override revokeObjectURL = vi.fn()
    },
  )
  const createItem = vi.fn()
  vi.stubGlobal(
    'ClipboardItem',
    class {
      constructor(items: Record<string, Blob>) {
        createItem(items)
      }
    },
  )
  const write = vi.fn(async () => undefined)
  vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: { write } } }))
  const { drag } = prepare(vi.fn().mockResolvedValue(image))
  drag()
  const copy = await screen.findByRole('button', { name: readerEn.captureCopyImage })
  expect(write).not.toHaveBeenCalled()
  fireEvent.click(copy)
  expect(createItem).toHaveBeenCalledExactlyOnceWith({ 'image/png': image.png })
  expect(write).toHaveBeenCalledOnce()
  expect(await screen.findByText(readerEn.captureImageCopied)).toBeTruthy()
})

it('copies the qualified region record and readable text through separate actions', async () => {
  vi.stubGlobal(
    'URL',
    class extends URL {
      static override createObjectURL = () => 'blob:reader-capture'
      static override revokeObjectURL = vi.fn()
    },
  )
  const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: { writeText } } }))
  const { drag } = prepare(vi.fn().mockResolvedValue(image))
  drag()

  fireEvent.click(await screen.findByRole('button', { name: readerEn.captureCopySource }))
  expect(await screen.findByText(readerEn.captureSourceCopied)).toBeTruthy()
  expect(JSON.parse(writeText.mock.calls[0]![0])).toEqual({
    ...source,
    sourceType: 'screenshot',
    pages: image.regions,
  })
  fireEvent.click(screen.getByRole('button', { name: readerEn.captureCopyText }))
  expect(await screen.findByText(readerEn.captureTextCopied)).toBeTruthy()
  expect(writeText.mock.calls[1]).toEqual([image.text])
})

it('keeps an image-only preview downloadable after clipboard access is denied', async () => {
  const create = vi
    .fn<(blob: Blob) => string>()
    .mockReturnValueOnce('blob:reader-preview')
    .mockReturnValueOnce('blob:reader-download')
  const revoke = vi.fn()
  vi.stubGlobal(
    'URL',
    class extends URL {
      static override createObjectURL = create
      static override revokeObjectURL = revoke
    },
  )
  vi.stubGlobal('ClipboardItem', class {})
  const write = vi
    .fn()
    .mockRejectedValue(new DOMException('No clipboard access', 'NotAllowedError'))
  vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: { write } } }))
  const download = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    download(this.download, this.href, this.isConnected)
  })
  const { drag } = prepare(vi.fn().mockResolvedValue({ ...image, text: '' }))
  drag()

  fireEvent.click(await screen.findByRole('button', { name: readerEn.captureCopyImage }))
  expect(await screen.findByText(readerEn.copyFailed)).toBeTruthy()
  expect(screen.queryByRole('button', { name: readerEn.captureCopyText })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: readerEn.captureSave }))
  expect(download).toHaveBeenCalledExactlyOnceWith(
    'zotero-pages-2.png',
    'blob:reader-download',
    true,
  )
  expect(create.mock.calls[1]).toEqual([image.png])
  await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:reader-download'))
  expect(screen.getByRole('img', { name: readerEn.capturePreview }).getAttribute('src')).toBe(
    'blob:reader-preview',
  )
})

it('ignores a cancelled drag and allows a new screenshot after a failed render', async () => {
  vi.stubGlobal(
    'URL',
    class extends URL {
      static override createObjectURL = () => 'blob:reader-capture'
      static override revokeObjectURL = vi.fn()
    },
  )
  const capture = vi
    .fn()
    .mockRejectedValueOnce(new Error('Canvas was recycled'))
    .mockResolvedValueOnce(image)
  const { drag, overlay } = prepare(capture)
  fireEvent.pointerDown(overlay, {
    pointerId: 4,
    isPrimary: true,
    button: 0,
    clientX: 30,
    clientY: 50,
  })
  fireEvent.pointerMove(overlay, { pointerId: 4, clientX: 80, clientY: 85 })
  fireEvent.lostPointerCapture(overlay, { pointerId: 4 })
  fireEvent.pointerUp(overlay, { pointerId: 4, clientX: 80, clientY: 85 })
  expect(capture).not.toHaveBeenCalled()

  drag()
  await screen.findByText(readerEn.captureFailed)
  drag()
  await screen.findByRole('img', { name: readerEn.capturePreview })
  expect(screen.queryByText(readerEn.captureFailed)).toBeNull()
})

it('uses exact geometry and withholds incomplete region text when opening a cached parse', async () => {
  vi.stubGlobal(
    'URL',
    class extends URL {
      static override createObjectURL = () => 'blob:reader-capture'
      static override revokeObjectURL = vi.fn()
    },
  )
  const locate = vi
    .fn<NonNullable<Parameters<typeof ReaderCapture>[0]['locateInParsed']>>()
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true)
  const capture = vi.fn().mockResolvedValue({ ...image, textIncomplete: true })
  const { drag, onClose } = prepare(capture, undefined, locate)
  drag()
  expect(await screen.findByText(readerEn.captureTextIncomplete)).toBeTruthy()
  const open = screen.getByRole('button', { name: readerEn.locateInParsed })
  fireEvent.click(open)
  await screen.findByText(readerEn.parsedOpenFailed)
  fireEvent.click(open)
  await screen.findByText(readerEn.parsedMissing)
  expect(onClose).not.toHaveBeenCalled()

  await act(async () => fireEvent.click(open))
  expect(onClose).toHaveBeenCalledOnce()
  expect(locate.mock.calls.map(([regions, text]) => [regions, text])).toEqual(
    Array.from({ length: 3 }, () => [image.regions, undefined]),
  )
})
