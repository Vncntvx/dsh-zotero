// @vitest-environment jsdom
/** Staged edits remain local; accepted updates drive runtime preferences. */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import {
  LibraryFormController,
  type LibraryCardFace,
} from '../../../src/client/library-form-controller.ts'
import { LibrarySettingsForm } from '../../../src/client/LibrarySettingsForm.tsx'
import { createLibraryPreferenceSource } from '../../../src/client/library-preferences.tsx'
import { LibraryCitationActions } from '../../../src/client/components/library/LibraryCitationActions.tsx'
import { LibraryPreferencesContext } from '../../../src/client/library-preferences.tsx'
import { LIBRARY_DEFAULTS } from '../../../src/library-preferences.ts'
import { ITEM_DETAIL } from '../helpers/library-panel-harness.tsx'
import { fakeScope } from '../helpers/fake-scope.ts'
import type { ScholarlyCredentialPort } from '../../../src/client/scholarly-form-controller.ts'
import { mockT } from '../helpers/mock-translate.ts'
import { zh } from '../../../src/client/locales.ts'

afterEach(cleanup)
function settingsHarness(
  refresh?: LibraryCardFace['refreshJournalMetrics'],
  credentials?: ScholarlyCredentialPort,
) {
  const form = fakeScope({ value: { ...LIBRARY_DEFAULTS } })
  const core = fakeScope({ value: { defaultStyle: 'apa', defaultLocale: 'zh-CN' } })
  const source = createLibraryPreferenceSource(form, core)
  const controller = new LibraryFormController(form, credentials, refresh)
  const face = controller.inject()
  function Settings() {
    const state = useSyncExternalStore(
      face.hooks.libraryCard.subscribe,
      face.hooks.libraryCard.getSnapshot,
    )
    return <LibrarySettingsForm t={mockT} state={state} actions={face} />
  }
  return {
    form,
    core,
    source,
    face,
    Settings,
    dispose: () => {
      controller.dispose()
      source.dispose()
    },
  }
}
it('publishes runtime preferences only after save', async () => {
  const harness = settingsHarness()
  try {
    render(<harness.Settings />)
    fireEvent.click(screen.getByRole('button', { name: zh.libraryListDensity }))
    fireEvent.click(screen.getByRole('menuitem', { name: zh.libraryCompact }))
    expect(harness.face.hooks.libraryCard.getSnapshot().listDensity.text).toBe('"compact"')
    expect(harness.source.getSnapshot().preferences?.listDensity).toBe('comfortable')
    await act(async () => harness.face.save())
    expect(harness.source.getSnapshot().preferences?.listDensity).toBe('compact')
    expect(harness.form.writes).toEqual([{ op: 'set', field: 'listDensity', value: 'compact' }])
  } finally {
    harness.dispose()
  }
})
it('requires acknowledgement before enabling external PDF requests and stages cancellation safely', () => {
  const harness = settingsHarness()
  try {
    render(<harness.Settings />)
    fireEvent.click(screen.getByLabelText(zh.libraryAllowUrlPdf))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(harness.source.getSnapshot().preferences?.allowUrlPdfRead).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: zh.writeRiskCancel }))
    expect(harness.face.hooks.libraryCard.getSnapshot().dirty).toBe(false)
    fireEvent.click(screen.getByLabelText(zh.libraryAllowUrlPdf))
    fireEvent.click(screen.getByLabelText(zh.libraryUrlRiskAcknowledge))
    fireEvent.click(screen.getByRole('button', { name: zh.libraryUrlRiskConfirm }))
    expect(harness.face.hooks.libraryCard.getSnapshot().allowUrlPdfRead.text).toBe('true')
    expect(harness.source.getSnapshot().preferences?.allowUrlPdfRead).toBe(false)
  } finally {
    harness.dispose()
  }
})

it('waits for EasyScholar consent and a settings save before enabling lookups', async () => {
  const harness = settingsHarness()
  try {
    render(<harness.Settings />)
    fireEvent.click(screen.getByLabelText(zh.journalMetricsEnable))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByLabelText(zh.journalMetricsAcknowledge))
    fireEvent.click(screen.getByRole('button', { name: zh.journalMetricsAllow }))
    expect(harness.source.getSnapshot().preferences?.journalMetricsEnabled).toBe(false)
    await act(async () => harness.face.save())
    expect(harness.source.getSnapshot().preferences?.journalMetricsEnabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: `${zh.reset}: ${zh.journalMetricsEnable}` }))
    await act(async () => harness.face.save())
    expect(harness.source.getSnapshot().preferences?.journalMetricsEnabled).toBe(false)
  } finally {
    harness.dispose()
  }
})

it('links to EasyScholar’s Open API page and masks a saved key', async () => {
  const harness = settingsHarness(undefined, {
    describe: async () => ({
      ok: true,
      value: { EASYSCHOLAR_SECRET_KEY: { configured: true, writable: true } },
    }),
    set: vi.fn(),
  })
  try {
    render(<harness.Settings />)
    const keyField = screen.getByLabelText<HTMLInputElement>(zh.journalMetricsSecret)
    await vi.waitFor(() => expect(keyField.placeholder).toBe('************'))
    expect(keyField.value).toBe('')
    const link = screen.getByRole('link', { name: zh.journalMetricsSecretOpenSite })
    expect(link.getAttribute('href')).toBe('https://www.easyscholar.cc/console/user/open')
    expect(link.getAttribute('target')).toBe('_blank')
  } finally {
    harness.dispose()
  }
})

it('orders candidates and saves separate presets and the dual-index preference', async () => {
  const harness = settingsHarness()
  try {
    render(<harness.Settings />)
    const choose = (label: string, option: string) => {
      fireEvent.click(screen.getByRole('button', { name: label }))
      fireEvent.click(screen.getByRole('menuitem', { name: option }))
    }
    const international = within(
      screen.getByRole('region', { name: zh.journalMetricsInternational }),
    )
    const chinese = within(screen.getByRole('region', { name: zh.journalMetricsChineseCore }))
    const add = international.getByRole('button', { name: zh.journalMetricsAddCandidate })
    fireEvent.click(add)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(international.getByRole('button', { name: zh.journalMetricsAddCandidate }))
    fireEvent.click(screen.getByRole('menuitem', { name: zh['journalMetric.ccf'] }))
    fireEvent.click(international.getByRole('button', { name: '将CCF上移' }))
    fireEvent.click(international.getByRole('button', { name: '将CCF下移' }))
    fireEvent.click(international.getByRole('button', { name: '将CCF上移' }))
    fireEvent.click(chinese.getByRole('button', { name: '移除北大核心' }))
    choose(zh.journalMetricsDualPriority, zh.journalMetricsChineseCore)
    choose(zh.journalMetricsListLimit, '2 项')
    expect(harness.source.getSnapshot().preferences?.journalMetricListOrder).toEqual(
      LIBRARY_DEFAULTS.journalMetricListOrder,
    )
    await act(async () => harness.face.save())
    expect(harness.source.getSnapshot().preferences?.journalMetricListOrder).toEqual({
      international: ['jcr', 'sciif', 'ccf', 'sciUp'],
      chineseCore: ['cssci', 'cscd', 'zhongguokejihexin'],
      dualPriority: 'chineseCore',
      limit: 2,
    })
    fireEvent.click(
      screen.getByRole('button', { name: `${zh.reset}: ${zh.journalMetricsListFields}` }),
    )
    await act(async () => harness.face.save())
    expect(harness.source.getSnapshot().preferences?.journalMetricListOrder).toEqual(
      LIBRARY_DEFAULTS.journalMetricListOrder,
    )
  } finally {
    harness.dispose()
  }
})

it('saves independently selected detail metrics and restores their defaults', async () => {
  const harness = settingsHarness()
  try {
    render(<harness.Settings />)
    expect(
      screen.getByRole('checkbox', { name: zh['journalMetric.sci'], checked: true }),
    ).toBeTruthy()
    fireEvent.click(screen.getByLabelText(zh['journalMetric.sci']))
    fireEvent.click(screen.getByLabelText(zh['journalMetric.ccf']))
    fireEvent.click(screen.getByLabelText(zh.journalMetricsCustom))
    expect(harness.source.getSnapshot().preferences?.journalMetricDetailFields).toEqual([
      'sci',
      'sciif',
      'sciUp',
    ])
    await act(async () => harness.face.save())
    expect(harness.source.getSnapshot().preferences?.journalMetricDetailFields).toEqual([
      'sciif',
      'sciUp',
      'ccf',
      'custom',
    ])
    expect(harness.source.getSnapshot().preferences?.journalMetricListOrder).toEqual(
      LIBRARY_DEFAULTS.journalMetricListOrder,
    )
    fireEvent.click(
      screen.getByRole('button', { name: `${zh.reset}: ${zh.journalMetricsDetailFields}` }),
    )
    await act(async () => harness.face.save())
    expect(harness.source.getSnapshot().preferences?.journalMetricDetailFields).toEqual([
      'sci',
      'sciif',
      'sciUp',
    ])
  } finally {
    harness.dispose()
  }
})

it('requests a metrics refresh without saving other settings drafts', async () => {
  const refresh = vi
    .fn<NonNullable<LibraryCardFace['refreshJournalMetrics']>>()
    .mockResolvedValueOnce({ status: 'finished', refreshed: 2, total: 3, failure: 'unavailable' })
    .mockRejectedValueOnce(new Error('host unavailable'))
  const harness = settingsHarness(refresh)
  try {
    render(<harness.Settings />)
    act(() => harness.face.edit('titleLines', '1'))
    fireEvent.click(screen.getByRole('button', { name: zh.journalMetricsRefresh }))
    expect((await screen.findByText(/已更新 2\/3 个期刊/)).textContent).toContain(
      zh.journalMetricsRefreshIncomplete,
    )
    expect(refresh).toHaveBeenCalledOnce()
    expect(harness.form.writes).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: zh.journalMetricsRefresh }))
    expect(await screen.findByText(zh.journalMetricsRefreshFailed)).toBeTruthy()
  } finally {
    harness.dispose()
  }
})

it.each([
  [{ status: 'finished', total: 0, refreshed: 0 }, zh.journalMetricsRefreshEmpty],
  [{ status: 'disabled' }, zh.journalMetricsRefreshDisabled],
  [{ status: 'credential' }, zh.journalMetricsCredential],
  [{ status: 'running' }, zh.journalMetricsRefreshRunning],
] as const)('shows the manual refresh outcome for %j', async (outcome, message) => {
  const harness = settingsHarness(async () => outcome)
  try {
    render(<harness.Settings />)
    fireEvent.click(screen.getByRole('button', { name: zh.journalMetricsRefresh }))
    expect(await screen.findByText(message)).toBeTruthy()
  } finally {
    harness.dispose()
  }
})

it('previews an empty preset when the user removes every candidate', () => {
  const harness = settingsHarness()
  try {
    render(<harness.Settings />)
    const preset = within(screen.getByRole('region', { name: zh.journalMetricsInternational }))
    for (const button of preset.getAllByRole('button', { name: /^移除/ })) fireEvent.click(button)
    expect(preset.getByText(new RegExp(zh.journalMetricsPreviewEmpty))).toBeTruthy()
  } finally {
    harness.dispose()
  }
})

it('rejects invalid draft values and keeps the accepted runtime snapshot', async () => {
  const harness = settingsHarness()
  try {
    render(<harness.Settings />)
    act(() => harness.face.edit('titleLines', '{broken'))
    expect(screen.getByRole('alert').textContent).toContain(zh.libraryInvalidDraft)
    await harness.face.save()
    expect(harness.face.hooks.libraryCard.getSnapshot().invalid).toBe(true)
    expect(harness.source.getSnapshot().preferences?.titleLines).toBe(2)
    expect(harness.form.writes).toEqual([])
  } finally {
    harness.dispose()
  }
})
it('uses the default copy format for the main action and accepted CSL defaults for its override', async () => {
  const exportItem = vi.fn(async () => ({
    ok: true as const,
    value: { format: 'csv' as const, text: 'title\nFlashAttention-2' },
  }))
  render(
    <LibraryPreferencesContext.Provider
      value={{
        preferences: { ...LIBRARY_DEFAULTS, defaultCopyFormat: 'csv' },
        citation: { style: 'apa', locale: 'zh-CN' },
      }}
    >
      <LibraryCitationActions detail={ITEM_DETAIL} t={mockT} exportItem={exportItem} />
    </LibraryPreferencesContext.Provider>,
  )
  fireEvent.click(screen.getByRole('button', { name: zh.libraryCopyCsv }))
  expect(exportItem).toHaveBeenCalledWith({ refs: [ITEM_DETAIL.ref], format: 'csv' })
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: zh.libraryCitationMenu }))
  fireEvent.click(screen.getByRole('menuitem', { name: zh.libraryCopyBibliography }))
  expect(exportItem).toHaveBeenLastCalledWith({
    refs: [ITEM_DETAIL.ref],
    format: 'bibliography',
    style: 'apa',
    locale: 'zh-CN',
  })
})
it('stages every disclosure off as an explicit empty list and discards it without changing runtime', async () => {
  const harness = settingsHarness()
  try {
    render(<harness.Settings />)
    fireEvent.click(screen.getByLabelText(zh.libraryMetaAbstract))
    fireEvent.click(screen.getByLabelText(zh.librarySectionAttachments))
    expect(harness.face.hooks.libraryCard.getSnapshot().detailExpandedSections.text).toBe('[]')
    expect(harness.source.getSnapshot().preferences?.detailExpandedSections).toEqual([
      'abstract',
      'attachments',
    ])
    act(() => harness.face.discard())
    expect(harness.face.hooks.libraryCard.getSnapshot().detailExpandedSections.text).toBe(
      '["abstract","attachments"]',
    )
    fireEvent.click(screen.getByLabelText(zh.librarySectionNotes))
    await act(async () => harness.face.save())
    expect(harness.source.getSnapshot().preferences?.detailExpandedSections).toEqual([
      'abstract',
      'attachments',
      'notes',
    ])
  } finally {
    harness.dispose()
  }
})
it('keeps reset actions beside individual settings without a global reset button', () => {
  const harness = settingsHarness()
  try {
    render(<harness.Settings />)
    expect(screen.queryByRole('button', { name: '恢复继承设置' })).toBeNull()
    expect(screen.queryByText(/此操作先暂存本组重置/)).toBeNull()
    expect(screen.queryByText(/外观预览/)).toBeNull()
    expect(screen.queryByText(/前往基础设置/)).toBeNull()
  } finally {
    harness.dispose()
  }
})

it.each([
  ['detailExpandedSections', '["notes","notes"]'],
  ['detailExpandedSections', 'null'],
  ['defaultCopyFormat', '"xml"'],
  ['listDensity', '{invalid'],
] as const)('refuses malformed %s draft %s at the staged form boundary', async (field, text) => {
  const harness = settingsHarness()
  try {
    harness.face.edit(field, text)
    await harness.face.save()
    expect(harness.face.hooks.libraryCard.getSnapshot().invalid).toBe(true)
    expect(harness.form.writes).toEqual([])
  } finally {
    harness.dispose()
  }
})
it('stages individual inherited resets', () => {
  const harness = settingsHarness()
  try {
    harness.form.publish({
      user: { titleLines: 1, detailExpandedSections: [] },
      value: { ...LIBRARY_DEFAULTS, titleLines: 1, detailExpandedSections: [] },
    })
    function Settings() {
      const state = useSyncExternalStore(
        harness.face.hooks.libraryCard.subscribe,
        harness.face.hooks.libraryCard.getSnapshot,
      )
      return <LibrarySettingsForm t={mockT} state={state} actions={harness.face} />
    }
    render(<Settings />)
    fireEvent.click(screen.getByRole('button', { name: `${zh.reset}: ${zh.libraryTitleLines}` }))
    fireEvent.click(
      screen.getByRole('button', { name: `${zh.reset}: ${zh.libraryExpandedSections}` }),
    )
    expect(harness.face.hooks.libraryCard.getSnapshot().titleLines.overridden).toBe(false)
    expect(harness.face.hooks.libraryCard.getSnapshot().detailExpandedSections.overridden).toBe(
      false,
    )
    expect(harness.form.writes).toEqual([])
  } finally {
    harness.dispose()
  }
})
it('closes a choice menu on Escape without creating a draft change', () => {
  const harness = settingsHarness()
  try {
    render(<harness.Settings />)
    fireEvent.click(screen.getByRole('button', { name: zh.libraryListDensity }))
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(harness.face.hooks.libraryCard.getSnapshot().dirty).toBe(false)
  } finally {
    harness.dispose()
  }
})
