// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReaderTab } from '../../../src/client/reader/ReaderTab.tsx'
import { readerZh } from '../../../src/client/reader/locales.ts'
import { deferred } from '../../helpers/sync.ts'
import type { ZoteroItemDetailView } from '../../../src/contract.ts'
import { pdfRuntime, propsOf, REF, t } from './support/reader-tab.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('keeps the document details drawer when an open split view shrinks', async () => {
  let width = 1_100
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
  const observe = vi.fn()
  const disconnect = vi.fn()
  let resize = () => undefined as void
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback
      }
      observe = observe
      disconnect = disconnect
    },
  )
  const pending = deferred<ZoteroItemDetailView>()
  const { unmount } = render(<ReaderTab {...propsOf({ details: () => pending.promise })} />)
  const outline = await screen.findByRole('button', { name: readerZh.outline })
  const details = screen.getByRole('button', { name: readerZh.details })
  fireEvent.click(outline)
  fireEvent.click(details)
  expect(outline.getAttribute('aria-expanded')).toBe('true')
  expect(details.getAttribute('aria-expanded')).toBe('true')

  width = 560
  act(resize)
  expect(outline.getAttribute('aria-expanded')).toBe('false')
  expect(details.getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(outline)
  expect(outline.getAttribute('aria-expanded')).toBe('true')
  expect(details.getAttribute('aria-expanded')).toBe('false')
  unmount()
  expect(disconnect).toHaveBeenCalledOnce()
})

it('saves the initial page and accrues reading time only while the Reader tab is visible', async () => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(1000)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  const runtime = pdfRuntime(undefined, { sectionTitle: 'Methods' })
  const props = propsOf({ load: async () => runtime })
  const info = props.useTabInfo()
  const tab = render(<ReaderTab {...props} />)
  await act(async () => {})
  act(() =>
    runtime.mountPdf.mock.lastCall![4]!.onPosition({
      pageIndex: 0,
      pageOffset: 0,
      zoom: 1,
      fitMode: 'width',
      rotation: 0,
    }),
  )
  expect(props.history.save).toHaveBeenLastCalledWith(
    expect.objectContaining({ pageIndex: 0, readingSeconds: 0, sectionPath: ['Methods'] }),
  )

  clock.mockReturnValue(3000)
  tab.rerender(
    <ReaderTab {...props} useTabInfo={() => ({ ...info, tab: { ...info.tab, visible: false } })} />,
  )
  const hiddenVisit = vi.mocked(props.history.save).mock.lastCall![0]
  expect(hiddenVisit.readingSeconds).toBe(2)
  clock.mockReturnValue(33_000)
  tab.unmount()
  expect(props.history.save).toHaveBeenLastCalledWith(hiddenVisit)
})

it('restores, moves, and pins an attachment outline while preserving its chosen width', async () => {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  const runtime = pdfRuntime()
  const props = propsOf({ load: async () => runtime })
  const position = { pageIndex: 0, pageOffset: 0, zoom: 1, fitMode: 'width', rotation: 0 } as const
  vi.mocked(props.history.restore).mockReturnValue({
    ...position,
    attachmentRef: REF,
    fingerprint: 'fingerprint',
    lastVisitedAt: 1,
    panels: { outline: true, info: false, outlineLayout: { pinned: false, width: 300 } },
    readingSeconds: 0,
  })
  const { unmount } = render(<ReaderTab {...props} />)
  const outline = await screen.findByRole('navigation', { name: readerZh.outline })
  expect(outline).toBeTruthy()
  act(() => runtime.mountPdf.mock.lastCall![4]!.onPosition(position))
  const resize = screen.getByRole('separator', {
    name: t('panelResize', { panel: readerZh.outline }),
  })
  const shell = resize.parentElement!
  vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue(new DOMRect(50, 20, 300, 400))
  vi.spyOn(shell.parentElement!, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(50, 20, 700, 600),
  )
  const move = screen.getByRole('button', { name: t('panelMove', { panel: readerZh.outline }) })
  Object.defineProperty(move, 'setPointerCapture', { value: vi.fn() })
  fireEvent.pointerDown(move, {
    pointerId: 1,
    isPrimary: true,
    button: 0,
    clientX: 60,
    clientY: 30,
  })
  fireEvent.pointerMove(move, { pointerId: 1, clientX: 260, clientY: 130 })
  expect(shell.style.getPropertyValue('--reader-panel-y')).toBe('0.5')
  fireEvent.pointerUp(move, { pointerId: 1, clientX: 260, clientY: 130 })
  fireEvent.keyDown(resize, { key: 'ArrowRight' })
  expect(resize.getAttribute('aria-valuenow')).toBe('316')
  fireEvent.click(screen.getByRole('button', { name: t('panelPin', { panel: readerZh.outline }) }))
  expect(
    screen.queryByRole('button', { name: t('panelMove', { panel: readerZh.outline }) }),
  ).toBeNull()
  unmount()
  expect(props.history.save).toHaveBeenLastCalledWith(
    expect.objectContaining({
      panels: {
        outline: true,
        info: false,
        outlineLayout: { pinned: true, x: 0.5, y: 0.5, width: 316 },
      },
    }),
  )
})
