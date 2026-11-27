// @vitest-environment jsdom
/**
 * The shared overflow trigger: it renders an icon-only labelled button with a
 * tooltip and forwards its optional data rows and selection callback to the
 * host menu. Both omitted-prop arms are driven here so the wrapper's defaults
 * stay covered.
 * @module tests/client/components/MoreActionsMenu
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MoreActionsMenu } from '../../../src/client/components/MoreActionsMenu.tsx'

afterEach(cleanup)

describe('MoreActionsMenu', () => {
  it('renders a labelled trigger with no rows or selection callback', () => {
    render(<MoreActionsMenu label="More actions" />)
    const trigger = screen.getByRole('button', { name: 'More actions' })
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens rows and reports the selected id', () => {
    const onSelect = vi.fn()
    render(
      <MoreActionsMenu
        label="More actions"
        items={[{ id: 'copy', label: 'Copy' }]}
        onSelect={onSelect}
      />,
    )
    const trigger = screen.getByRole('button', { name: 'More actions' })
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }))
    expect(onSelect).toHaveBeenCalledWith('copy')
  })

  it('renders stateful children when no data rows are supplied', () => {
    render(
      <MoreActionsMenu label="More actions" onSelect={vi.fn()}>
        <button type="button">Child action</button>
      </MoreActionsMenu>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.getByRole('button', { name: 'Child action' })).toBeDefined()
  })
})

it('closes the open menu through its close handler', () => {
  render(<MoreActionsMenu label="More actions" items={[{ id: 'copy', label: 'Copy' }]} />)
  const trigger = screen.getByRole('button', { name: 'More actions' })
  fireEvent.click(trigger)
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
})
