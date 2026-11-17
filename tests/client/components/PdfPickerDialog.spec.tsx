// @vitest-environment jsdom
/** The shared PDF chooser owns busy gating and recoverable choice errors. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PdfPickerDialog } from '../../../src/client/components/PdfPickerDialog.tsx'
import { mockT } from '../helpers/mock-translate.ts'

afterEach(cleanup)

function options() {
  return [
    { key: 'paper', title: 'paper.pdf', action: 'Read', onSelect: vi.fn() },
    { key: 'supplement', title: 'supplement.pdf', action: 'Read', onSelect: vi.fn() },
  ]
}

it('disables every PDF choice while the selected action is running', () => {
  const choices = options()
  render(
    <PdfPickerDialog open onClose={vi.fn()} t={mockT} title="Choose PDF" options={choices} busy />,
  )
  for (const choice of choices) {
    const button = screen.getByRole('button', { name: `${choice.title} ${choice.action}` })
    expect(button).toHaveProperty('disabled', true)
    fireEvent.click(button)
    expect(choice.onSelect).not.toHaveBeenCalled()
  }
})

it('keeps a failed choice visible and permits selecting another PDF', () => {
  const choices = options()
  render(
    <PdfPickerDialog
      open
      onClose={vi.fn()}
      t={mockT}
      title="Choose PDF"
      options={choices}
      error="PDF could not be opened"
    />,
  )
  expect(screen.getByRole('alert').textContent).toBe('PDF could not be opened')
  for (const choice of choices)
    expect(screen.getByRole('button', { name: `${choice.title} ${choice.action}` })).toHaveProperty(
      'disabled',
      false,
    )
  fireEvent.click(screen.getByRole('button', { name: 'supplement.pdf Read' }))
  expect(choices[1]!.onSelect).toHaveBeenCalledOnce()
  expect(choices[0]!.onSelect).not.toHaveBeenCalled()
})
