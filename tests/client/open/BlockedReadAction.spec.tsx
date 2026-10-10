// @vitest-environment jsdom
/**
 * BlockedReadAction tests: the mismatch-gated PDF read renders aria-disabled
 * with its reason exposed, and stays inert on click.
 * @module tests/client/open/BlockedReadAction
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlockedReadAction } from '../../../src/client/components/open/BlockedReadAction.tsx'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('../helpers/primitives-stub.ts')
  return primitivesStub()
})

import { mockT } from '../helpers/mock-translate.ts'

const t = mockT

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('BlockedReadAction', () => {
  it('renders aria-disabled button with mismatch description', () => {
    render(<BlockedReadAction label="Blocked Read" t={t} />)
    const button = screen.getByRole('button', { name: 'Blocked Read' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    const descId = button.getAttribute('aria-describedby')
    expect(descId).toBeTruthy()
    const descEl = document.getElementById(descId!)
    expect(descEl?.textContent).toContain(mockT('databaseMismatch'))
  })

  it('prevents default click events on blocked action with custom class', () => {
    render(<BlockedReadAction label="Blocked Custom" className="custom-blocked" t={t} />)
    const button = screen.getByRole('button', { name: 'Blocked Custom' })
    expect(button.className).toContain('custom-blocked')
    const event = fireEvent.click(button)
    expect(event).toBe(false)
  })
})
