// @vitest-environment jsdom
/** Staged edits remain local; accepted updates drive runtime preferences. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { LibraryFormController } from '../../../src/client/library-form-controller.ts'
import { LibrarySettingsForm } from '../../../src/client/LibrarySettingsForm.tsx'
import { createLibraryPreferenceSource } from '../../../src/client/library-preferences.tsx'
import { LibraryCitationActions } from '../../../src/client/components/library/LibraryCitationActions.tsx'
import { LibraryPreferencesContext } from '../../../src/client/library-preferences.tsx'
import { LIBRARY_DEFAULTS } from '../../../src/library-preferences.ts'
import { ITEM_DETAIL } from '../helpers/library-panel-harness.tsx'
import { fakeScope } from '../helpers/fake-scope.ts'
import { mockT } from '../helpers/mock-translate.ts'
import { zh } from '../../../src/client/locales.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async (importOriginal) => {
  const { primitivesWithRealForm } = await import('../helpers/primitives-stub.ts')
  const original = await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>()
  return {
    ...(await primitivesWithRealForm(importOriginal)),
    Menu: original.Menu,
    MenuItemButton: original.MenuItemButton,
  }
})
afterEach(cleanup)
function settingsHarness() {
  const form = fakeScope({ value: { ...LIBRARY_DEFAULTS } })
  const core = fakeScope({ value: { defaultStyle: 'apa', defaultLocale: 'zh-CN' } })
  const source = createLibraryPreferenceSource(form, core)
  const controller = new LibraryFormController(form)
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
