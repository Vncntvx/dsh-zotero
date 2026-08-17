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
import { BooleanField } from '../../src/client/fields.tsx'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { createElement } = await import('react')
  return {
    Input: (props: Record<string, unknown>) => createElement('input', props),
  }
})

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
