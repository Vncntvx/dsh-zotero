// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReaderCapture } from '../../../src/client/reader/ReaderCapture.tsx'
import { readerEn } from '../../../src/client/reader/locales.ts'
import { attachmentRef, itemRef } from '../../helpers/server/keys.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'
import { deferred } from '../../helpers/sync.ts'

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

it('cycles focus through the dialog, closes on Escape, and keeps an empty dialog focused', async () => {
  const controller = new AbortController()
  const close = vi.fn()
  const capture = vi.fn().mockResolvedValue(image)
  render(
    <ReaderCapture
      t={t}
      source={source}
      capture={capture}
      onClose={close}
      tabSignal={controller.signal}
    />,
  )
  const overlay = screen.getByRole('dialog', { name: readerEn.capture })
  vi.spyOn(overlay.firstElementChild!, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(10, 20, 100, 80),
  )
  Object.defineProperty(overlay.firstElementChild!, 'setPointerCapture', { value: vi.fn() })
  fireEvent.pointerDown(overlay.firstElementChild!, {
    pointerId: 1,
    isPrimary: true,
    button: 0,
    clientX: 20,
    clientY: 30,
  })
  fireEvent.pointerUp(overlay.firstElementChild!, {
    pointerId: 1,
    clientX: 90,
    clientY: 80,
  })
  await screen.findByRole('img', { name: readerEn.capturePreview })

  const buttons = screen.getAllByRole('button')
  const first = buttons[0]!
  const last = buttons.at(-1)!
  overlay.focus()
  fireEvent.keyDown(overlay, { key: 'Tab' })
  expect(document.activeElement).toBe(first)
  first.focus()
  fireEvent.keyDown(overlay, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(last)
  last.focus()
  fireEvent.keyDown(overlay, { key: 'Tab' })
  expect(document.activeElement).toBe(first)
  fireEvent.keyDown(overlay, { key: 'Escape' })
  expect(close).toHaveBeenCalledOnce()
  fireEvent.keyDown(overlay, { key: 'ArrowRight' })
  expect(close).toHaveBeenCalledOnce()
})

it('ignores non-primary and too-small selections', () => {
  const controller = new AbortController()
  const capture = vi.fn().mockResolvedValue(image)
  render(
    <ReaderCapture
      t={t}
      source={source}
      capture={capture}
      onClose={vi.fn()}
      tabSignal={controller.signal}
    />,
  )
  const frame = screen.getByRole('dialog', { name: readerEn.capture })
  const overlay = frame.firstElementChild!
  vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 100, 80))
  Object.defineProperty(overlay, 'setPointerCapture', { value: vi.fn() })
  fireEvent.pointerDown(overlay, {
    pointerId: 4,
    isPrimary: false,
    button: 0,
    clientX: 30,
    clientY: 50,
  })
  fireEvent.pointerUp(overlay, { pointerId: 4, clientX: 80, clientY: 85 })
  fireEvent.pointerDown(overlay, {
    pointerId: 5,
    isPrimary: true,
    button: 2,
    clientX: 30,
    clientY: 50,
  })
  fireEvent.pointerUp(overlay, { pointerId: 5, clientX: 80, clientY: 85 })
  fireEvent.pointerDown(overlay, {
    pointerId: 6,
    isPrimary: true,
    button: 0,
    clientX: 30,
    clientY: 50,
  })
  fireEvent.pointerUp(overlay, { pointerId: 6, clientX: 32, clientY: 52 })
  expect(capture).not.toHaveBeenCalled()
})

it('cancels rendering when the capture overlay closes', () => {
  const work = deferred<never>()
  const controller = new AbortController()
  const onClose = vi.fn()
  const capture = vi.fn((_region: unknown, signal: AbortSignal) => {
    signal.addEventListener('abort', () => work.reject(signal.reason), { once: true })
    return work.promise
  })
  render(
    <ReaderCapture
      t={t}
      source={source}
      capture={capture}
      onClose={onClose}
      tabSignal={controller.signal}
    />,
  )
  const frame = screen.getByRole('dialog', { name: readerEn.capture })
  const overlay = frame.firstElementChild!
  vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 100, 80))
  Object.defineProperty(overlay, 'setPointerCapture', { value: vi.fn() })
  fireEvent.pointerDown(overlay, {
    pointerId: 4,
    isPrimary: true,
    button: 0,
    clientX: 100,
    clientY: 80,
  })
  fireEvent.pointerUp(overlay, { pointerId: 4, clientX: 0, clientY: 40 })
  const signal = capture.mock.calls[0]?.[1]
  expect(signal?.aborted).toBe(false)
  fireEvent.keyDown(frame, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledOnce()
  cleanup()
  expect(signal?.aborted).toBe(true)
})

it('validates a coordinate selection and previews it without a pointer drag', () => {
  const capture = vi.fn(() => new Promise<never>(() => {}))
  render(
    <ReaderCapture
      t={t}
      source={source}
      capture={capture}
      onClose={vi.fn()}
      tabSignal={new AbortController().signal}
    />,
  )
  const frame = screen.getByRole('dialog', { name: readerEn.capture })
  vi.spyOn(frame.firstElementChild!, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(10, 20, 100, 80),
  )
  const form = screen.getByRole('form', { name: readerEn.captureRegionTitle })
  const width = screen.getByRole('spinbutton', { name: readerEn.captureWidth })
  fireEvent.change(width, { target: { value: '1' } })
  fireEvent.submit(form)
  expect(screen.getByText(readerEn.captureInvalidRegion)).toBeTruthy()
  expect(capture).not.toHaveBeenCalled()

  fireEvent.change(width, { target: { value: '100' } })
  fireEvent.submit(form)
  expect(capture).toHaveBeenCalledExactlyOnceWith(
    { x: 20, y: 28, width: 90, height: 64 },
    expect.any(AbortSignal),
    undefined,
  )
})
