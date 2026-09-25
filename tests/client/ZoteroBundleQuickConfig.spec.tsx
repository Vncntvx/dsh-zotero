// @vitest-environment jsdom
/**
 * Unit tests for ZoteroBundleQuickConfig component (plugins.bundle.config slot).
 * @module tests/client/ZoteroBundleQuickConfig
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZoteroBundleQuickConfig } from '../../src/client/components/plugin/ZoteroBundleQuickConfig.tsx'
import { fakeScope } from './helpers/fake-scope.ts'

// The real primitives bundle pulls a second React through Modal; stub the
// DOM faces this spec asserts on (Switch + RiskConfirmation).
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('./helpers/primitives-stub.ts')
  return primitivesStub()
})

import { mockT } from './helpers/mock-translate.ts'
const t = mockT

afterEach(cleanup)

describe('ZoteroBundleQuickConfig', () => {
  it('renders quick config title, hints, and switches with default state', () => {
    const form = fakeScope()
    render(<ZoteroBundleQuickConfig form={form} t={t} />)

    expect(screen.getByText(t('quickConfigTitle'))).toBeDefined()
    expect(screen.getByText(t('quickConfigHint'))).toBeDefined()
    expect(screen.getByText(t('webEnabled'))).toBeDefined()
    expect(screen.getByText(t('writeEnabled'))).toBeDefined()

    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(2)

    // webEnabled defaults to true
    expect(switches[0].getAttribute('aria-checked')).toBe('true')
    // writeEnabled defaults to false
    expect(switches[1].getAttribute('aria-checked')).toBe('false')
  })

  it('triggers form mutation when toggling webEnabled', () => {
    const form = fakeScope({ value: { webEnabled: true } })
    render(<ZoteroBundleQuickConfig form={form} t={t} />)

    const switches = screen.getAllByRole('switch')
    fireEvent.click(switches[0])

    expect(form.writes).toEqual([{ op: 'set', field: 'webEnabled', value: false }])
  })

  it('does not enable writeEnabled on a bare toggle', () => {
    const form = fakeScope({ value: { writeEnabled: false } })
    render(<ZoteroBundleQuickConfig form={form} t={t} />)

    const switches = screen.getAllByRole('switch')
    fireEvent.click(switches[1])

    expect(form.writes).toEqual([])
    expect(screen.getByRole('dialog', { name: t('writeRiskTitle') })).toBeDefined()
  })

  it('disables switches when form is not ready', () => {
    const form = fakeScope({ status: 'loading' })
    render(<ZoteroBundleQuickConfig form={form} t={t} />)

    const switches = screen.getAllByRole('switch')
    expect(switches[0].hasAttribute('disabled')).toBe(true)
    expect(switches[1].hasAttribute('disabled')).toBe(true)
  })

  it('gates enabling writeEnabled behind the risk acknowledgement', () => {
    const form = fakeScope({ value: { writeEnabled: false } })
    render(<ZoteroBundleQuickConfig form={form} t={t} />)

    const writeSwitch = screen.getAllByRole('switch')[1]
    fireEvent.click(writeSwitch)
    // Nothing staged until the dialog is acknowledged and confirmed.
    expect(form.writes).toEqual([])
    expect(screen.getByRole('dialog', { name: t('writeRiskTitle') })).toBeDefined()
    expect(screen.getByText(t('writeRiskDescription'))).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: t('writeRiskConfirm') }))
    // Confirm is still disabled without the acknowledgement.
    expect(form.writes).toEqual([])

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: t('writeRiskConfirm') }))
    expect(form.writes).toEqual([{ op: 'set', field: 'writeEnabled', value: true }])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('cancelling the write risk dialog leaves the flag off', () => {
    const form = fakeScope({ value: { writeEnabled: false } })
    render(<ZoteroBundleQuickConfig form={form} t={t} />)

    fireEvent.click(screen.getAllByRole('switch')[1])
    fireEvent.click(screen.getByRole('button', { name: t('writeRiskCancel') }))
    expect(form.writes).toEqual([])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('turns writeEnabled off without a dialog', () => {
    const form = fakeScope({ value: { writeEnabled: true } })
    render(<ZoteroBundleQuickConfig form={form} t={t} />)

    fireEvent.click(screen.getAllByRole('switch')[1])
    expect(form.writes).toEqual([{ op: 'set', field: 'writeEnabled', value: false }])
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
