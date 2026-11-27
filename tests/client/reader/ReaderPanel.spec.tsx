// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReaderPanel } from '../../../src/client/reader/ReaderPanel.tsx'
import { readerEn } from '../../../src/client/reader/locales.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'

afterEach(cleanup)

it('pins and moves a floating panel, then saves keyboard resizing', () => {
  const save = vi.fn()
  const rect = new DOMRect(10, 20, 300, 400)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
  try {
    render(
      <ReaderPanel
        t={makeTranslate(readerEn)}
        side="left"
        label={readerEn.outline}
        layout={{ pinned: false, width: 288, x: 0.2, y: 0.1 }}
        save={save}
      >
        <p>Outline</p>
      </ReaderPanel>,
    )
    const move = screen.getByRole('button', {
      name: readerEn.panelMove.replace('{panel}', readerEn.outline),
    })
    fireEvent.pointerDown(move, {
      button: 0,
      isPrimary: true,
      pointerId: 1,
      clientX: 20,
      clientY: 30,
    })
    fireEvent.pointerMove(move, { pointerId: 1, clientX: 60, clientY: 70 })
    fireEvent.pointerUp(move, { pointerId: 1, clientX: 60, clientY: 70 })
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
    )

    fireEvent.click(
      screen.getByRole('button', { name: readerEn.panelPin.replace('{panel}', readerEn.outline) }),
    )
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ pinned: true }))

    const separator = screen.getByRole('separator')
    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ width: 316 }))
  } finally {
    vi.restoreAllMocks()
  }
})

it('ignores secondary pointers and commits no-op gestures', () => {
  const save = vi.fn()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 300, 400),
  )
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
  try {
    render(
      <ReaderPanel t={makeTranslate(readerEn)} side="right" label="Info" save={save}>
        <p>Info</p>
      </ReaderPanel>,
    )
    const separator = screen.getByRole('separator')
    fireEvent.pointerDown(separator, { button: 2, isPrimary: true, pointerId: 1 })
    fireEvent.pointerDown(separator, { button: 0, isPrimary: false, pointerId: 2 })
    fireEvent.pointerDown(separator, {
      button: 0,
      isPrimary: true,
      pointerId: 3,
      clientX: 0,
      clientY: 0,
    })
    fireEvent.pointerUp(separator, { pointerId: 3, clientX: 0, clientY: 0 })
    expect(save).not.toHaveBeenCalled()
  } finally {
    vi.restoreAllMocks()
  }
})

it('moves the floating panel with the keyboard and clears a lost resize gesture', () => {
  const save = vi.fn()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.dataset.floating === 'true'
      ? new DOMRect(200, 100, 300, 400)
      : new DOMRect(0, 0, 1000, 900)
  })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
  try {
    render(
      <ReaderPanel
        t={makeTranslate(readerEn)}
        side="left"
        label={readerEn.outline}
        layout={{ pinned: false, width: 300, x: 0.2, y: 0.1 }}
        save={save}
      >
        <p>Outline</p>
      </ReaderPanel>,
    )
    const move = screen.getByRole('button', {
      name: readerEn.panelMove.replace('{panel}', readerEn.outline),
    })
    fireEvent.keyDown(move, { key: 'ArrowDown' })
    expect(save).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ x: 200 / 700, y: 116 / 500 }),
    )

    const separator = screen.getByRole('separator')
    fireEvent.pointerDown(separator, {
      button: 0,
      isPrimary: true,
      pointerId: 4,
      clientX: 50,
      clientY: 60,
    })
    fireEvent.pointerMove(separator, { pointerId: 4, clientX: 70, clientY: 60 })
    expect(separator.getAttribute('aria-valuenow')).toBe('320')
    fireEvent.lostPointerCapture(separator, { pointerId: 4 })
    expect(separator.getAttribute('aria-valuenow')).toBe('300')
    fireEvent.pointerUp(separator, { pointerId: 4, clientX: 70, clientY: 60 })
    expect(save).toHaveBeenCalledOnce()
  } finally {
    vi.restoreAllMocks()
  }
})

it('grows a right-pinned panel when its left edge moves left and clamps its width', () => {
  const save = vi.fn()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.getAttribute('role') === 'separator'
      ? new DOMRect(700, 0, 6, 600)
      : new DOMRect(700, 0, 300, 600)
  })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
  try {
    render(
      <ReaderPanel t={makeTranslate(readerEn)} side="right" label="Info" save={save}>
        <p>Info</p>
      </ReaderPanel>,
    )
    const separator = screen.getByRole('separator')
    fireEvent.pointerDown(separator, {
      button: 0,
      isPrimary: true,
      pointerId: 8,
      clientX: 700,
      clientY: 300,
    })
    fireEvent.pointerMove(separator, { pointerId: 8, clientX: 100, clientY: 300 })
    expect(separator.getAttribute('aria-valuenow')).toBe('560')
    fireEvent.pointerUp(separator, { pointerId: 8, clientX: 100, clientY: 300 })
    expect(save).toHaveBeenCalledExactlyOnceWith({ width: 560 })
  } finally {
    vi.restoreAllMocks()
  }
})
