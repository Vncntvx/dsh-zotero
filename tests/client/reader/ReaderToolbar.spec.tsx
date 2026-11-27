// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { readerEn } from '../../../src/client/reader/locales.ts'
import { ReaderFloatBar, ReaderToolbar } from '../../../src/client/reader/ReaderToolbar.tsx'
import { makeTranslate } from '../helpers/mock-translate.ts'

const t = makeTranslate(readerEn)
const view = { page: 2, count: 3, label: 'iv', sectionTitle: 'Methods', fingerprint: 'pdf' }

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it('uses physical page numbers for navigation and displays a differing printed label', () => {
  const props = {
    t,
    view,
    pageInput: '3',
    outlineOpen: false,
    onToggleOutline: vi.fn(),
    onGoTo: vi.fn(),
    onPageInput: vi.fn(),
  }
  const { rerender } = render(<ReaderToolbar {...props} />)
  const page = screen.getByRole('textbox', { name: readerEn.page })
  expect(screen.getByText(t('pageLabel', { label: 'iv' }))).toBeTruthy()
  expect(screen.getByText(t('currentSection', { title: 'Methods' }))).toBeTruthy()
  fireEvent.change(page, { target: { value: '4' } })
  expect(props.onPageInput).toHaveBeenLastCalledWith('4')
  fireEvent.submit(page.closest('form')!)
  fireEvent.click(screen.getByRole('button', { name: readerEn.previous }))
  fireEvent.click(screen.getByRole('button', { name: readerEn.next }))
  expect(props.onGoTo.mock.calls).toEqual([[3], [1], [3]])
  rerender(<ReaderToolbar {...props} pageInput="iv" />)
  fireEvent.blur(page)
  expect(props.onPageInput).toHaveBeenLastCalledWith('2')
  expect(props.onGoTo).toHaveBeenCalledTimes(3)
})

function renderFloat(query = 'methods', inert = false) {
  const actions = {
    onQuery: vi.fn(),
    onFind: vi.fn(),
    onZoom: vi.fn(),
    onFit: vi.fn(),
    onRotate: vi.fn(),
    onOpenZotero: vi.fn(),
  }
  const mounted = render(
    <div>
      <ReaderFloatBar t={t} zoom={1.5} fitMode="width" query={query} inert={inert} {...actions} />
    </div>,
  )
  return { ...mounted, ...actions }
}

it('announces PDF search progress, result counts, and misses', () => {
  const props = {
    onQuery: vi.fn(),
    onFind: vi.fn(),
    onZoom: vi.fn(),
    onFit: vi.fn(),
    onRotate: vi.fn(),
    onOpenZotero: vi.fn(),
  }
  const { rerender } = render(
    <ReaderFloatBar
      t={t}
      zoom={1}
      fitMode="width"
      query="methods"
      findStatus={{ state: 'pending', current: 0, total: 0 }}
      {...props}
    />,
  )
  expect(screen.getByRole('status').textContent).toBe(t('findSearching'))
  rerender(
    <ReaderFloatBar
      t={t}
      zoom={1}
      fitMode="width"
      query="methods"
      findStatus={{ state: 'found', current: 2, total: 5 }}
      {...props}
    />,
  )
  expect(screen.getByRole('status').textContent).toBe(t('findResults', { current: 2, total: 5 }))
  rerender(
    <ReaderFloatBar
      t={t}
      zoom={1}
      fitMode="width"
      query="missing"
      findStatus={{ state: 'not-found', current: 0, total: 0 }}
      {...props}
    />,
  )
  expect(screen.getByRole('status').textContent).toBe(t('findNoResults'))
})

it('marks the floating toolbar inert while region capture owns input', () => {
  renderFloat('methods', true)
  const toolbar = screen.getByRole('toolbar', { name: readerEn.readingControls })
  expect(toolbar.hasAttribute('inert')).toBe(true)
})

it('passes find direction and zoom factors through the floating controls', () => {
  const { onQuery, onFind, onZoom } = renderFloat()
  const search = screen.getByRole('searchbox', { name: readerEn.find })
  fireEvent.change(search, { target: { value: 'results' } })
  fireEvent.submit(search.closest('form')!)
  fireEvent.click(screen.getByRole('button', { name: readerEn.findPrevious }))
  fireEvent.click(screen.getByRole('button', { name: readerEn.findNext }))
  fireEvent.click(screen.getByRole('button', { name: readerEn.zoomOut }))
  fireEvent.click(screen.getByRole('button', { name: readerEn.zoomIn }))
  expect(onQuery).toHaveBeenCalledExactlyOnceWith('results')
  expect(onFind.mock.calls).toEqual([[false], [true], [false]])
  expect(onZoom.mock.calls).toEqual([[1 / 1.2], [1.2]])
})

it('routes fit, rotation and Zotero actions through the overflow menu', async () => {
  const { onFit, onRotate, onOpenZotero } = renderFloat()
  const more = screen.getByRole('button', { name: readerEn.toolbarMore })
  for (const name of [
    readerEn.fitWidth,
    readerEn.fitPage,
    readerEn.rotate,
    readerEn.rotateCounterclockwise,
    readerEn.zotero,
  ]) {
    fireEvent.click(more)
    fireEvent.click(await screen.findByText(name))
  }
  expect(onFit.mock.calls).toEqual([['page-width'], ['page-fit']])
  expect(onRotate.mock.calls).toEqual([[1], [-1]])
  expect(onOpenZotero).toHaveBeenCalledOnce()
})

it('releases the idle timer when the floating controls unmount', () => {
  vi.useFakeTimers()
  const { unmount } = renderFloat()
  const toolbar = screen.getByRole('toolbar', { name: readerEn.readingControls })
  act(() => vi.runOnlyPendingTimers())
  fireEvent.pointerMove(toolbar.parentElement!)
  expect(vi.getTimerCount()).toBe(1)
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it('wakes the floating bar on pointer activity and closes its overflow menu on Escape', async () => {
  vi.useFakeTimers()
  const mounted = render(
    <div>
      <ReaderFloatBar
        t={t}
        zoom={1}
        fitMode="width"
        query=""
        onQuery={vi.fn()}
        onFind={vi.fn()}
        onZoom={vi.fn()}
        onFit={vi.fn()}
        onRotate={vi.fn()}
        onOpenZotero={vi.fn()}
      />
    </div>,
  )
  const area = mounted.container.firstElementChild!
  const bar = screen.getByRole('toolbar')
  const before = bar.className
  fireEvent.pointerMove(area)
  fireEvent.pointerEnter(bar, { pointerType: 'touch' })
  fireEvent.pointerEnter(bar, { pointerType: 'mouse' })
  fireEvent.pointerLeave(bar)
  await act(async () => vi.advanceTimersByTime(2_501))
  expect(bar.className).not.toBe(before)
  fireEvent.click(screen.getByRole('button', { name: readerEn.toolbarMore }))
  expect(screen.getByRole('menu')).toBeTruthy()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
})
