// @vitest-environment jsdom
/**
 * The boolean toggle control's override marker: the badge with its reset
 * button renders when the field state marks an override. Value inputs ride
 * the harness's own `SettingsValueField`, so only the toggle lives here.
 * @module tests/client/fields
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BooleanField } from '../../src/client/fields.tsx'

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

  it('requires risk acknowledgement before staging an enable', () => {
    const onEdit = vi.fn()
    const risk = {
      title: t('writeRiskTitle'),
      description: t('writeRiskDescription'),
      acknowledgeLabel: t('writeRiskAcknowledge'),
      cancelLabel: t('writeRiskCancel'),
      closeLabel: t('writeRiskClose'),
      confirmLabel: t('writeRiskConfirm'),
    }
    render(<BooleanField {...base} text="false" overridden={false} risk={risk} onEdit={onEdit} />)

    fireEvent.click(screen.getByLabelText(base.label))
    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: risk.title })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: risk.confirmLabel }))
    expect(onEdit).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText(risk.acknowledgeLabel))
    fireEvent.click(screen.getByRole('button', { name: risk.confirmLabel }))
    expect(onEdit).toHaveBeenCalledWith('true')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('disables without the risk dialog when the toggle is already on', () => {
    const onEdit = vi.fn()
    const risk = {
      title: t('writeRiskTitle'),
      description: t('writeRiskDescription'),
      acknowledgeLabel: t('writeRiskAcknowledge'),
      cancelLabel: t('writeRiskCancel'),
      closeLabel: t('writeRiskClose'),
      confirmLabel: t('writeRiskConfirm'),
    }
    render(<BooleanField {...base} text="true" overridden={false} risk={risk} onEdit={onEdit} />)

    fireEvent.click(screen.getByLabelText(base.label))
    expect(onEdit).toHaveBeenCalledWith('false')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
