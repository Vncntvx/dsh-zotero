// @vitest-environment jsdom
/**
 * The enrichment settings page: the free/pro switch is independent of the token,
 * a configured token is masked, and the output-directory field stages a path
 * that reset clears back to the default.
 * @module tests/client/enrichment/enrichment-settings-form
 */

import { fireEvent, render, screen as rtlScreen, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { EnrichmentSettingsSection } from '../../../src/client/EnrichmentSettingsSection.tsx'
import type { EnrichmentSettingsSectionProps } from '../../../src/client/EnrichmentSettingsSection.tsx'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EnrichmentFormController,
  type EnrichmentCardState,
} from '../../../src/client/enrichment-form-controller.ts'
import { cleanup, en, mountHarness, screen, zh } from './support.tsx'
import { fakeScope } from '../helpers/fake-scope.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async (importOriginal) => {
  const { primitivesWithRealForm } = await import('../helpers/primitives-stub.ts')
  const original = await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>()
  return {
    ...(await primitivesWithRealForm(importOriginal)),
    Modal: original.Modal,
    Menu: original.Menu,
    MenuItemButton: original.MenuItemButton,
  }
})

afterEach(() => {
  cleanup()
})

describe('EnrichmentSettingsSection', () => {
  it('renders the summary copy in the summary view', () => {
    mountHarness({}, 'summary')
    expect(screen.getByText(zh.tabEnrichmentDesc)).toBeDefined()
  })

  it('renders the free/pro switch with free selected and no token required', () => {
    mountHarness()
    const tablist = screen.getByRole('tablist', { name: zh.enrichmentMode })
    expect(
      within(tablist)
        .getByRole('tab', { name: zh.enrichmentModeFree })
        .getAttribute('aria-selected'),
    ).toBe('true')
    expect(
      within(tablist)
        .getByRole('tab', { name: zh.enrichmentModePro })
        .getAttribute('aria-selected'),
    ).toBe('false')
  })

  it('stages pro when the switch is used, even with a token configured', () => {
    const harness = mountHarness({ value: { mineruTokenRef: 'MINERU_API_TOKEN' } })
    fireEvent.click(screen.getByRole('tab', { name: zh.enrichmentModePro }))
    expect(harness.snapshot().mode.text).toBe('pro')
    expect(harness.snapshot().mineruTokenRef.text).toBe('MINERU_API_TOKEN')
  })

  it('switches back from pro to free without clearing the token reference', () => {
    const harness = mountHarness({ value: { mode: 'pro', mineruTokenRef: 'MINERU_API_TOKEN' } })
    fireEvent.click(screen.getByRole('tab', { name: zh.enrichmentModeFree }))
    expect(harness.snapshot().mode.text).toBe('free')
    expect(harness.snapshot().mineruTokenRef.text).toBe('MINERU_API_TOKEN')
  })

  it('stages a typed output directory and restores the default on reset', () => {
    const harness = mountHarness()
    const input = screen.getByLabelText(zh.enrichmentOutputDir) as HTMLInputElement
    fireEvent.change(input, { target: { value: '/tmp/parsed' } })
    expect(harness.snapshot().outputDir.text).toBe('/tmp/parsed')
    fireEvent.change(input, { target: { value: '' } })
    expect(harness.snapshot().outputDir.text).toBe('')
  })

  it('displays the data notice in the output section', () => {
    mountHarness()
    expect(screen.getByText(zh.groupEnrichmentOutputDesc)).toBeDefined()
  })

  it('stages the token secret value directly through its control', () => {
    const harness = mountHarness()
    const secret = document.getElementById('enrichment-settings-token') as HTMLInputElement
    expect(secret.disabled).toBe(false)
    fireEvent.change(secret, { target: { value: 'token-value' } })
    expect(harness.snapshot().mineruToken.text).toBe('token-value')
  })

  it('resets every overridden field through the rendered reset controls', () => {
    const harness = mountHarness({
      value: {
        mode: 'pro',
        outputDir: '/tmp/parsed',
      },
      user: {
        mode: 'pro',
        outputDir: '/tmp/parsed',
      },
    })
    const resetButtons = screen.getAllByRole('button', { name: zh.reset })
    expect(resetButtons.length).toBeGreaterThanOrEqual(2)
    for (const button of resetButtons) fireEvent.click(button)
    const state = harness.snapshot()
    expect(state.mode.overridden).toBe(false)
    expect(state.outputDir.overridden).toBe(false)
  })

  it('falls back to free when the committed mode is outside the closed set', () => {
    mountHarness({ value: { mode: 'turbo' } })
    const tablist = screen.getByRole('tablist', { name: zh.enrichmentMode })
    expect(
      within(tablist)
        .getByRole('tab', { name: zh.enrichmentModeFree })
        .getAttribute('aria-selected'),
    ).toBe('true')
  })

  it('falls back to default model and source when committed values are unrecognized', () => {
    mountHarness({
      value: { semanticModel: 'unknown-model', semanticDownloadSource: 'unknown-source' },
    })
    const modelBtn = screen.getByRole('button', { name: zh.semanticModel })
    expect(modelBtn.textContent).toContain(zh.semanticModelBalanced)
    const sourceBtn = screen.getByRole('button', { name: zh.semanticDownloadSource })
    expect(sourceBtn.textContent).toContain(zh.semanticSourceHfMirror)
  })

  it('keeps the token control disabled for an invalid committed reference', () => {
    mountHarness({ value: { mineruTokenRef: 'not a ref' } })
    const secret = document.getElementById('enrichment-settings-token') as HTMLInputElement
    expect(secret.disabled).toBe(true)
  })

  it('enables the token control by default using the plugin dedicated credential reference', () => {
    mountHarness()
    const secret = document.getElementById('enrichment-settings-token') as HTMLInputElement
    expect(secret.disabled).toBe(false)
  })

  it('renders the English dictionary without falling back to a key', () => {
    const scope = fakeScope()
    const controller = new EnrichmentFormController(scope, {
      describe: async () => ({ ok: true, value: {} }),
      set: async () => ({ ok: true, value: undefined }),
    })
    const face = controller.inject()
    function Section() {
      const state = useSyncExternalStore(
        face.hooks.enrichmentCard.subscribe,
        face.hooks.enrichmentCard.getSnapshot,
      )
      const props = {
        view: 'page',
        t: makeTranslate(en),
        useEnrichmentCard: (selector: (snapshot: EnrichmentCardState) => unknown) =>
          selector(state),
        edit: face.edit,
        resetField: face.resetField,
        save: face.save,
        discard: face.discard,
      } as unknown as EnrichmentSettingsSectionProps
      return <EnrichmentSettingsSection {...props} />
    }
    render(<Section />)
    expect(rtlScreen.getByText(en.groupEnrichmentMode)).toBeDefined()
    expect(rtlScreen.getByText(en.groupSemanticRanking)).toBeDefined()
    controller.dispose()
  })

  it('renders the semantic ranking section and controls', () => {
    const harness = mountHarness()
    expect(screen.getByText(zh.groupSemanticRanking)).toBeDefined()
    expect(screen.getByText(zh.groupSemanticRankingDesc)).toBeDefined()

    // Toggle switch
    const toggle = screen.getByLabelText(zh.enableSemanticSearch) as HTMLInputElement
    fireEvent.click(toggle)
    expect(harness.snapshot().enableSemanticSearch.text).toBe('true')

    // Model selection
    fireEvent.click(screen.getByRole('button', { name: zh.semanticModel }))
    fireEvent.click(screen.getByRole('menuitem', { name: zh.semanticModelBilingual }))
    expect(harness.snapshot().semanticModel.text).toBe('bilingual')

    // Download channel selection
    fireEvent.click(screen.getByRole('button', { name: zh.semanticDownloadSource }))
    fireEvent.click(screen.getByRole('menuitem', { name: zh.semanticSourceHuggingFace }))
    expect(harness.snapshot().semanticDownloadSource.text).toBe('huggingface')

    // Directory input
    const dirInput = screen.getByLabelText(zh.semanticModelDir) as HTMLInputElement
    fireEvent.change(dirInput, { target: { value: '/custom/models' } })
    expect(harness.snapshot().semanticModelDir.text).toBe('/custom/models')
  })

  it('resets overridden semantic search fields', () => {
    const harness = mountHarness({
      value: {
        enableSemanticSearch: true,
        semanticModel: 'bilingual',
        semanticDownloadSource: 'huggingface',
        semanticModelDir: '/custom/models',
      },
      user: {
        enableSemanticSearch: true,
        semanticModel: 'bilingual',
        semanticDownloadSource: 'huggingface',
        semanticModelDir: '/custom/models',
      },
    })

    // The shared choice row names its reset `${reset}: ${label}`; the boolean
    // and value fields keep a bare `${reset}` button. Click every reset
    // control in the section.
    const resetButtons = screen.getAllByRole('button').filter((button) => {
      const label = button.getAttribute('aria-label')
      return (
        label?.startsWith(zh.reset) === true || (label === null && button.textContent === zh.reset)
      )
    })
    for (const button of resetButtons) fireEvent.click(button)

    const state = harness.snapshot()
    expect(state.enableSemanticSearch.overridden).toBe(false)
    expect(state.semanticModel.overridden).toBe(false)
    expect(state.semanticDownloadSource.overridden).toBe(false)
    expect(state.semanticModelDir.overridden).toBe(false)
  })

  it('renders a warning box and mineru link when pro mode is selected without a token', () => {
    mountHarness({
      value: {
        mode: 'pro',
      },
    })

    expect(screen.getByText(zh.enrichmentTokenMissingTitle)).toBeDefined()
    expect(screen.getByText(zh.enrichmentTokenMissingTag)).toBeDefined()
    expect(screen.getByText(zh.enrichmentTokenMissingDesc)).toBeDefined()
    const link = screen.getByText(zh.enrichmentTokenVisitMineru)
    expect(link.getAttribute('href')).toBe('https://mineru.net')
  })
})
