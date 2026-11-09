// @vitest-environment jsdom
/**
 * The parsing settings page: the free/pro switch is independent of the token,
 * the egress switch needs an acknowledgement, and the output-directory field
 * stages a path that reset clears back to the default.
 * @module tests/client/parsing/parsing-settings-form
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ParsingSettingsSection } from '../../../src/client/ParsingSettingsSection.tsx'
import type { ParsingSettingsSectionProps } from '../../../src/client/ParsingSettingsSection.tsx'
import {
  ParsingFormController,
  type ParsingCardFace,
  type ParsingCardState,
} from '../../../src/client/parsing-form-controller.ts'
import { en, zh } from '../../../src/client/locales.ts'
import { fakeScope } from '../helpers/fake-scope.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async (importOriginal) => {
  const { primitivesWithRealForm } = await import('../helpers/primitives-stub.ts')
  return primitivesWithRealForm(importOriginal)
})

afterEach(() => {
  cleanup()
})

interface Harness {
  readonly face: ParsingCardFace
  readonly snapshot: () => ParsingCardState
  readonly writes: () => Array<{ op: string; field: string; value?: unknown }>
}

function mountHarness(
  options: Parameters<typeof fakeScope>[0] = {},
  view: 'summary' | 'page' = 'page',
): Harness {
  const scope = fakeScope(options)
  const controller = new ParsingFormController(scope, {
    describe: async () => ({ ok: true, value: {} }),
    set: async () => ({ ok: true, value: undefined }),
  })
  const face = controller.inject()

  function Section() {
    const state = useSyncExternalStore(
      face.hooks.parsingCard.subscribe,
      face.hooks.parsingCard.getSnapshot,
    )
    const props = {
      view,
      t: makeTranslate(zh),
      useParsingCard: (selector: (snapshot: ParsingCardState) => unknown) => selector(state),
      edit: face.edit,
      resetField: face.resetField,
      save: face.save,
      discard: face.discard,
    } as unknown as ParsingSettingsSectionProps
    return <ParsingSettingsSection {...props} />
  }
  render(<Section />)
  return {
    face,
    snapshot: () => face.hooks.parsingCard.getSnapshot(),
    writes: () => scope.writes,
  }
}

describe('ParsingSettingsSection', () => {
  it('renders the summary copy in the summary view', () => {
    mountHarness({}, 'summary')
    expect(screen.getByText(zh.tabParsingDesc)).toBeDefined()
  })

  it('renders the free/pro switch with free selected and no token required', () => {
    mountHarness()
    const tablist = screen.getByRole('tablist', { name: zh.parsingMode })
    expect(
      within(tablist).getByRole('tab', { name: zh.parsingModeFree }).getAttribute('aria-selected'),
    ).toBe('true')
    expect(
      within(tablist).getByRole('tab', { name: zh.parsingModePro }).getAttribute('aria-selected'),
    ).toBe('false')
  })

  it('stages pro when the switch is used, even with a token configured', () => {
    const harness = mountHarness({ value: { mineruTokenRef: 'MINERU_API_TOKEN' } })
    fireEvent.click(screen.getByRole('tab', { name: zh.parsingModePro }))
    expect(harness.snapshot().mode.text).toBe('pro')
    expect(harness.snapshot().mineruTokenRef.text).toBe('MINERU_API_TOKEN')
  })

  it('switches back from pro to free without clearing the token reference', () => {
    const harness = mountHarness({ value: { mode: 'pro', mineruTokenRef: 'MINERU_API_TOKEN' } })
    fireEvent.click(screen.getByRole('tab', { name: zh.parsingModeFree }))
    expect(harness.snapshot().mode.text).toBe('free')
    expect(harness.snapshot().mineruTokenRef.text).toBe('MINERU_API_TOKEN')
  })

  it('stages a typed output directory and restores the default on reset', () => {
    const harness = mountHarness()
    const input = screen.getByLabelText(zh.parsingOutputDir) as HTMLInputElement
    fireEvent.change(input, { target: { value: '/tmp/parsed' } })
    expect(harness.snapshot().outputDir.text).toBe('/tmp/parsed')
    fireEvent.change(input, { target: { value: '' } })
    expect(harness.snapshot().outputDir.text).toBe('')
  })

  it('requires an acknowledgement before the egress switch turns on', () => {
    const harness = mountHarness()
    fireEvent.click(screen.getByLabelText(zh.parsingAllowUpload))
    expect(screen.getByRole('dialog', { name: zh.parsingUploadRiskTitle })).toBeDefined()
    // Confirm is disabled until the acknowledgement checkbox is ticked.
    const dialog = screen.getByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: zh.parsingUploadRiskConfirm })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(confirm)
    expect(harness.snapshot().allowParsingUpload.text).toBe('true')
  })

  it('stages the token reference and the secret value through their controls', () => {
    const harness = mountHarness({ value: { mineruTokenRef: 'MINERU_API_TOKEN' } })
    fireEvent.change(screen.getByLabelText(zh.parsingTokenRef), {
      target: { value: 'MINERU_API_TOKEN' },
    })
    expect(harness.snapshot().mineruTokenRef.text).toBe('MINERU_API_TOKEN')

    const secret = document.getElementById('parsing-settings-token') as HTMLInputElement
    fireEvent.change(secret, { target: { value: 'token-value' } })
    expect(harness.snapshot().mineruToken.text).toBe('token-value')
  })

  it('resets every overridden field through the rendered reset controls', () => {
    const harness = mountHarness({
      value: {
        mode: 'pro',
        mineruTokenRef: 'MINERU_API_TOKEN',
        outputDir: '/tmp/parsed',
        allowParsingUpload: true,
      },
      user: {
        mode: 'pro',
        mineruTokenRef: 'MINERU_API_TOKEN',
        outputDir: '/tmp/parsed',
        allowParsingUpload: true,
      },
    })
    const resetButtons = screen.getAllByRole('button', { name: zh.reset })
    expect(resetButtons.length).toBeGreaterThanOrEqual(4)
    for (const button of resetButtons) fireEvent.click(button)
    const state = harness.snapshot()
    expect(state.mode.overridden).toBe(false)
    expect(state.mineruTokenRef.overridden).toBe(false)
    expect(state.outputDir.overridden).toBe(false)
    expect(state.allowParsingUpload.overridden).toBe(false)
  })

  it('falls back to free when the committed mode is outside the closed set', () => {
    mountHarness({ value: { mode: 'turbo' } })
    const tablist = screen.getByRole('tablist', { name: zh.parsingMode })
    expect(
      within(tablist).getByRole('tab', { name: zh.parsingModeFree }).getAttribute('aria-selected'),
    ).toBe('true')
  })

  it('keeps the token control disabled for an invalid committed reference', () => {
    mountHarness({ value: { mineruTokenRef: 'not a ref' } })
    const secret = document.getElementById('parsing-settings-token') as HTMLInputElement
    expect(secret.disabled).toBe(true)
  })

  it('keeps the token control disabled until a valid reference is set', () => {
    mountHarness()
    const secret = document.querySelector('[data-secret-field="parsing-settings-token"]')
    expect(secret?.textContent).toContain(zh.parsingTokenNeedsReference)
  })

  it('renders the English dictionary without falling back to a key', () => {
    const scope = fakeScope()
    const controller = new ParsingFormController(scope, {
      describe: async () => ({ ok: true, value: {} }),
      set: async () => ({ ok: true, value: undefined }),
    })
    const face = controller.inject()
    function Section() {
      const state = useSyncExternalStore(
        face.hooks.parsingCard.subscribe,
        face.hooks.parsingCard.getSnapshot,
      )
      const props = {
        view: 'page',
        t: makeTranslate(en),
        useParsingCard: (selector: (snapshot: ParsingCardState) => unknown) => selector(state),
        edit: face.edit,
        resetField: face.resetField,
        save: face.save,
        discard: face.discard,
      } as unknown as ParsingSettingsSectionProps
      return <ParsingSettingsSection {...props} />
    }
    render(<Section />)
    expect(screen.getByText(en.groupParsingMode)).toBeDefined()
    controller.dispose()
  })
})
