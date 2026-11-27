// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReaderCapture } from '../../../src/client/reader/ReaderCapture.tsx'
import { readerEn } from '../../../src/client/reader/locales.ts'
import { attachmentRef, itemRef } from '../../helpers/server/keys.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'

afterEach(cleanup)

it('uses the configured source label as the default for each capture', () => {
  const source = {
    attachmentRef: attachmentRef(),
    itemRef: itemRef(),
    libraryRef: 'zotero://user/0/',
    fingerprint: 'reader-fixture',
    title: 'Study PDF',
  }
  const capture = vi.fn().mockResolvedValue({
    png: new Blob(['image fixture'], { type: 'image/png' }),
    width: 200,
    height: 80,
    regions: [],
    text: 'Selected passage',
    textIncomplete: false,
  })
  render(
    <ReaderCapture
      t={makeTranslate(readerEn)}
      source={source}
      capture={capture}
      defaultIncludeSource
      onClose={vi.fn()}
      tabSignal={new AbortController().signal}
    />,
  )
  const frame = screen.getByRole('dialog', { name: readerEn.capture })
  const overlay = frame.firstElementChild!
  vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 100, 80))
  Object.defineProperty(overlay, 'setPointerCapture', { value: vi.fn() })
  expect(
    (screen.getByRole('checkbox', { name: readerEn.captureIncludeSource }) as HTMLInputElement)
      .checked,
  ).toBe(true)
  fireEvent.pointerDown(overlay, {
    pointerId: 4,
    isPrimary: true,
    button: 0,
    clientX: 100,
    clientY: 80,
  })
  fireEvent.pointerUp(overlay, { pointerId: 4, clientX: 0, clientY: 40 })
  expect(capture).toHaveBeenCalledExactlyOnceWith(
    { x: 10, y: 40, width: 90, height: 40 },
    expect.any(AbortSignal),
    'Study PDF',
  )
})
