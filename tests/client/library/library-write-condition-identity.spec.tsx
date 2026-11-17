// @vitest-environment jsdom
/** Editable search rows retain their DOM identity, focus and selection after deleting a sibling. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LibraryWrite } from '../../../src/client/components/library/LibraryWrite.tsx'
import { zh } from '../../../src/client/locales.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'

afterEach(cleanup)
it('preserves the first and third condition inputs when the middle row is removed', () => {
  render(
    <LibraryWrite
      t={makeTranslate(zh)}
      write={vi.fn()}
      sessionId="session-1"
      sessionRunning
      writeAllowed
      refreshAffected={vi.fn()}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: zh.libraryWriteActions }))
  fireEvent.change(screen.getByLabelText(zh.libraryWriteOperation), {
    target: { value: 'createSavedSearch' },
  })
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: zh.libraryWriteRemoveCondition })
      .disabled,
  ).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: zh.libraryWriteAddCondition }))
  fireEvent.click(screen.getByRole('button', { name: zh.libraryWriteAddCondition }))
  const before = screen.getAllByLabelText<HTMLInputElement>(zh.libraryWriteValue)
  for (const [index, field] of before.entries())
    fireEvent.change(field, { target: { value: `value-${index}` } })
  before[2]!.focus()
  before[2]!.setSelectionRange(2, 5)
  fireEvent.click(screen.getAllByRole('button', { name: zh.libraryWriteRemoveCondition })[1]!)
  const after = screen.getAllByLabelText<HTMLInputElement>(zh.libraryWriteValue)
  expect(after).toHaveLength(2)
  expect(after[0]).toBe(before[0])
  expect(after[1]).toBe(before[2])
  expect(after.map((input) => input.value)).toEqual(['value-0', 'value-2'])
  expect(document.activeElement).toBe(before[2])
  expect([after[1]!.selectionStart, after[1]!.selectionEnd]).toEqual([2, 5])
})
