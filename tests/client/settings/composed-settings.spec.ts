// @vitest-environment node
/**
 * The composed-form semantics used by the Literature panel tab: served
 * sections decide availability, one save follows the merged state and writes
 * each dirty section, and unmount discards every draft unless a write is in
 * flight. Mirrors the harness's Subagent settings-card composition.
 * @module tests/client/settings/composed-settings
 */

import { describe, expect, it, vi } from 'vitest'
import type { SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  composedSettingsShell,
  composeSettingsForm,
  type ComposedSettingsPart,
} from '../../../src/client/composed-settings.ts'

const settled: SettingsFormShell = {
  available: true,
  writable: true,
  dirty: false,
  invalid: false,
  saving: false,
  failed: false,
}

function part(state: Partial<SettingsFormShell> = {}) {
  return {
    state: { ...settled, ...state },
    save: vi.fn(),
    discard: vi.fn(),
  } satisfies ComposedSettingsPart
}

describe('composed settings form', () => {
  it('counts served sections for availability and settlement', () => {
    expect(
      composedSettingsShell([
        {
          ...settled,
          available: false,
          writable: false,
          dirty: true,
          invalid: true,
          saving: true,
          failed: true,
        },
        { ...settled, writable: false, dirty: true },
      ]),
    ).toEqual({
      available: true,
      writable: false,
      dirty: true,
      invalid: false,
      saving: false,
      failed: false,
    })
  })

  it('is unavailable when no section is served', () => {
    expect(composedSettingsShell([{ ...settled, available: false }])).toEqual({
      available: false,
      writable: true,
      dirty: false,
      invalid: false,
      saving: false,
      failed: false,
    })
  })

  it.each([
    ['unavailable', { available: false }],
    ['read-only', { writable: false }],
    ['clean', { dirty: false }],
    ['invalid', { dirty: true, invalid: true }],
    ['saving', { dirty: true, saving: true }],
  ])('does not save while the tab is %s', (_label, state) => {
    const only = part(state)
    composeSettingsForm([only]).save()
    expect(only.save).not.toHaveBeenCalled()
  })

  it('saves only the served sections that hold staged edits', () => {
    const dirty = part({ dirty: true })
    const clean = part()
    const unavailable = part({ available: false, dirty: true })
    composeSettingsForm([dirty, clean, unavailable]).save()
    expect(dirty.save).toHaveBeenCalledOnce()
    expect(clean.save).not.toHaveBeenCalled()
    expect(unavailable.save).not.toHaveBeenCalled()
  })

  it('discards every draft unless a save is crossing the wire', () => {
    const idle = [part(), part()]
    composeSettingsForm(idle).discard()
    expect(idle[0]!.discard).toHaveBeenCalledOnce()
    expect(idle[1]!.discard).toHaveBeenCalledOnce()

    const saving = [part({ saving: true }), part()]
    composeSettingsForm(saving).discard()
    expect(saving[0]!.discard).not.toHaveBeenCalled()
    expect(saving[1]!.discard).not.toHaveBeenCalled()
  })
})
