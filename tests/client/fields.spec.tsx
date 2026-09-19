// @vitest-environment jsdom
/**
 * The boolean toggle control's override marker: the badge with its reset
 * button renders when the field state marks an override. The card form opts
 * the web tab toggle out of the marker; that opt-out is covered by the card's
 * own spec, so this file exercises the marker itself.
 * @module tests/client/fields
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BooleanField, ValueField } from '../../src/client/fields.tsx'

// The real primitives bundle pulls heavy dependencies (katex, shiki); the
// fields only need the shared tag capsule, so stub it with its DOM face.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('./helpers/primitives-stub.ts')
  return primitivesStub()
})

import { mockT } from './helpers/mock-translate.ts'
const t = mockT

afterEach(cleanup)

const base = {
  id: 'field-test',
  label: 'Test toggle',
  hint: 'A hint.',
  text: 'true',
  overridden: true,
  overriddenLabel: t('overridden'),
  resetLabel: t('reset'),
  // A shortened stand-in for the shipped `invalidNumber` copy: this file pins
  // the control's invalid face, not the sentence the card passes in.
  invalidLabel: '请填数字。',
  disabled: false,
  onEdit: () => {},
  onReset: () => {},
}

describe('BooleanField', () => {
  it('renders the override marker with its reset button', () => {
    render(<BooleanField {...base} />)
    expect(screen.getByText(t('overridden'))).toBeDefined()
    expect(screen.getByText(t('reset'))).toBeDefined()
  })

  it('routes the reset button to the reset action', () => {
    const onReset = vi.fn()
    render(<BooleanField {...base} onReset={onReset} />)
    fireEvent.click(screen.getByText(t('reset')))
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('renders no marker while the field is not overridden', () => {
    render(<BooleanField {...base} overridden={false} />)
    expect(screen.queryByText(t('overridden'))).toBeNull()
    expect(screen.queryByText(t('reset'))).toBeNull()
  })
})

describe('ValueField', () => {
  const valueBase = {
    id: 'field-value',
    label: 'Base URL',
    hint: 'Loopback only.',
    text: 'http://127.0.0.1:23119',
    overridden: true,
    invalid: false,
    overriddenLabel: t('overridden'),
    resetLabel: t('reset'),
    invalidLabel: '请填数字。',
    disabled: false,
    onEdit: () => {},
    onReset: () => {},
  }

  it('renders a native input with the override badge and hint', () => {
    const { container } = render(<ValueField {...valueBase} />)
    expect(container.querySelector('input#field-value')).not.toBeNull()
    expect(screen.getByText(t('overridden'))).toBeDefined()
    expect(screen.getByText('Loopback only.')).toBeDefined()
  })

  it('marks invalid drafts with the official invalid input and copy', () => {
    const { container } = render(<ValueField {...valueBase} invalid text="abc" />)
    const input = container.querySelector('input#field-value')
    expect(input?.getAttribute('aria-invalid')).toBe('true')
    // Official face: the control always carries `css.input`; invalid rides
    // `aria-invalid` (and CSS `[aria-invalid='true']`), not a second class.
    expect(input?.className).toMatch(/input/)
    expect(input?.className).not.toMatch(/inputInvalid/)
    expect(screen.getByText('请填数字。')).toBeDefined()
  })

  it('discloses optional help beside the label when the control receives one', () => {
    render(<ValueField {...valueBase} help={{ label: '规则', content: <p>Loopback only.</p> }} />)
    const button = screen.getByLabelText('规则')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('region', { name: '规则' })).toBeDefined()
  })
})
