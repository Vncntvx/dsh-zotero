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

afterEach(cleanup)

const base = {
  id: 'field-test',
  label: 'Test toggle',
  hintLabel: 'A hint.',
  text: 'true',
  overridden: true,
  invalid: false,
  overriddenLabel: '已覆盖',
  resetLabel: '恢复默认',
  disabled: false,
  onEdit: () => {},
  onReset: () => {},
}

describe('BooleanField', () => {
  it('renders the override marker with its reset button', () => {
    render(<BooleanField {...base} />)
    expect(screen.getByText('已覆盖')).toBeDefined()
    expect(screen.getByText('恢复默认')).toBeDefined()
  })

  it('routes the reset button to the reset action', () => {
    const onReset = vi.fn()
    render(<BooleanField {...base} onReset={onReset} />)
    fireEvent.click(screen.getByText('恢复默认'))
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('renders no marker while the field is not overridden', () => {
    render(<BooleanField {...base} overridden={false} />)
    expect(screen.queryByText('已覆盖')).toBeNull()
    expect(screen.queryByText('恢复默认')).toBeNull()
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
    overriddenLabel: '已覆盖',
    resetLabel: '恢复默认',
    invalidLabel: '请填数字。',
    disabled: false,
    onEdit: () => {},
    onReset: () => {},
  }

  it('renders a native input with the override badge and hint', () => {
    const { container } = render(<ValueField {...valueBase} />)
    expect(container.querySelector('input#field-value')).not.toBeNull()
    expect(screen.getByText('已覆盖')).toBeDefined()
    expect(screen.getByText('Loopback only.')).toBeDefined()
  })

  it('marks invalid drafts with the official invalid input and copy', () => {
    const { container } = render(<ValueField {...valueBase} invalid text="abc" />)
    const input = container.querySelector('input#field-value')
    expect(input?.getAttribute('aria-invalid')).toBe('true')
    expect(input?.className).toMatch(/inputInvalid/)
    expect(screen.getByText('请填数字。')).toBeDefined()
  })
})
