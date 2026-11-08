// @vitest-environment jsdom
/** CSL defaults are edited locally in both panel settings entrances, independently of other drafts. */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { SnapshotStore, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import { afterEach, expect, it, vi } from 'vitest'
import { CitationFormController } from '../../../src/client/citation-form-controller.ts'
import { ZoteroCardController } from '../../../src/client/zotero-card-controller.ts'
import { LibraryFormController } from '../../../src/client/library-form-controller.ts'
import {
  ZoteroSettingsSection,
  type ZoteroSettingsSectionProps,
} from '../../../src/client/ZoteroSettingsSection.tsx'
import {
  LibrarySettingsSection,
  type LibrarySettingsSectionProps,
} from '../../../src/client/LibrarySettingsSection.tsx'
import { createLibraryPreferenceSource } from '../../../src/client/library-preferences.tsx'
import { fakeScope, type FakeScope } from '../helpers/fake-scope.ts'
import { mockT } from '../helpers/mock-translate.ts'
import { zh } from '../../../src/client/locales.ts'

const disposers: (() => void)[] = []
afterEach(() => {
  cleanup()
  for (const dispose of disposers.splice(0)) dispose()
})
function selectorHook<T>(store: SnapshotStore<T>): SnapshotSelectorHook<T> {
  return (selector) => selector(useSyncExternalStore(store.subscribe, store.getSnapshot))
}
function mountSettings(
  entrance: 'bundle' | 'row',
  scope: FakeScope = fakeScope({
    value: { defaultStyle: 'apa', defaultLocale: 'en-US', timeoutMs: 5000 },
  }),
) {
  const libraryScope = fakeScope({ value: { rightSidebarEnabled: true } })
  const core = new ZoteroCardController(scope)
  const library = new LibraryFormController(libraryScope)
  const citation = new CitationFormController(scope)
  const accepted = createLibraryPreferenceSource(libraryScope, scope)
  disposers.push(() => {
    core.dispose()
    library.dispose()
    citation.dispose()
    accepted.dispose()
  })
  const coreFace = core.inject()
  const libraryFace = library.inject()
  const citationFace = citation.inject()
  const citationProps = {
    citation: citationFace,
    useCitationCard: selectorHook(citationFace.hooks.citationCard),
  }
  // The fixture supplies the public slot's runtime view and selector binding;
  // unrelated renderer capabilities are outside this settings assembly.
  const view =
    entrance === 'bundle'
      ? render(
          <ZoteroSettingsSection
            {...({
              ...coreFace,
              ...citationProps,
              view: 'page',
              t: mockT,
              useZoteroCard: selectorHook(coreFace.hooks.zoteroCard),
              useLibraryCard: selectorHook(libraryFace.hooks.libraryCard),
              library: libraryFace,
            } as unknown as ZoteroSettingsSectionProps)}
          />,
        )
      : render(
          <LibrarySettingsSection
            {...({
              ...libraryFace,
              ...citationProps,
              view: 'page',
              t: mockT,
              useLibraryCard: selectorHook(libraryFace.hooks.libraryCard),
            } as unknown as LibrarySettingsSectionProps)}
          />,
        )
  if (entrance === 'bundle') fireEvent.click(screen.getByRole('tab', { name: zh.tabLibrary }))
  const defaults = within(screen.getByRole('region', { name: zh.groupDefaults }))
  return { scope, coreFace, citationFace, accepted, view, defaults }
}
it.each(['bundle', 'row'] as const)(
  'edits and saves both shared CSL defaults directly from the %s entrance',
  async (entrance) => {
    const { scope, coreFace, citationFace, accepted, defaults } = mountSettings(entrance)
    act(() => coreFace.edit('timeoutMs', '9000'))
    const mutate = vi.spyOn(scope, 'mutate')
    fireEvent.change(defaults.getByLabelText(zh.defaultStyle), { target: { value: 'vancouver' } })
    fireEvent.change(defaults.getByLabelText(zh.defaultLocale), { target: { value: 'zh-CN' } })
    expect(accepted.getSnapshot().citation).toEqual({ style: 'apa', locale: 'en-US' })
    await act(async () => fireEvent.click(defaults.getByRole('button', { name: zh.save })))
    expect(mutate).toHaveBeenCalledExactlyOnceWith(
      [
        { op: 'set', path: ['defaultStyle'], value: 'vancouver' },
        { op: 'set', path: ['defaultLocale'], value: 'zh-CN' },
      ],
      1,
    )
    expect(accepted.getSnapshot().citation).toEqual({ style: 'vancouver', locale: 'zh-CN' })
    expect(scope.getSnapshot().value?.timeoutMs).toBe(5000)
    expect(coreFace.hooks.zoteroCard.getSnapshot().timeoutMs.text).toBe('9000')
    expect(citationFace.hooks.citationCard.getSnapshot().dirty).toBe(false)
    expect(screen.queryByText(/前往基础设置|外观预览|恢复继承设置/)).toBeNull()
    if (entrance === 'bundle') {
      fireEvent.click(screen.getByRole('tab', { name: zh.tabFeatures }))
      expect(
        within(screen.getByRole('tabpanel', { name: zh.tabFeatures })).queryByLabelText(
          zh.defaultStyle,
        ),
      ).toBeNull()
      fireEvent.click(screen.getByRole('tab', { name: zh.tabLibrary }))
      expect((defaults.getByLabelText(zh.defaultStyle) as HTMLInputElement).value).toBe('vancouver')
    }
  },
)
it('preserves CSL drafts when the host refuses the save', async () => {
  const { defaults, scope, citationFace } = mountSettings(
    'row',
    fakeScope({
      value: { defaultStyle: 'apa', defaultLocale: 'en-US' },
      rejectWrites: true,
    }),
  )
  fireEvent.change(defaults.getByLabelText(zh.defaultStyle), { target: { value: 'vancouver' } })
  await act(async () => fireEvent.click(defaults.getByRole('button', { name: zh.save })))
  expect(defaults.getByText(zh.saveFailed)).toBeTruthy()
  expect((defaults.getByLabelText(zh.defaultStyle) as HTMLInputElement).value).toBe('vancouver')
  expect(citationFace.hooks.citationCard.getSnapshot().dirty).toBe(true)
  expect(scope.writes).toEqual([])
})
it('resets a CSL field locally and commits its unset from the panel', async () => {
  const { defaults, scope } = mountSettings(
    'row',
    fakeScope({
      value: { defaultStyle: 'vancouver', defaultLocale: 'en-US' },
      base: { defaultStyle: 'apa', defaultLocale: 'en-US' },
      user: { defaultStyle: 'vancouver' },
    }),
  )
  fireEvent.click(defaults.getByRole('button', { name: zh.reset }))
  expect(scope.writes).toEqual([])
  await act(async () => fireEvent.click(defaults.getByRole('button', { name: zh.save })))
  expect(scope.writes).toEqual([{ op: 'unset', field: 'defaultStyle' }])
})
it('discards unsaved CSL edits when leaving the settings page', () => {
  const { defaults, scope, citationFace, view } = mountSettings('row')
  fireEvent.change(defaults.getByLabelText(zh.defaultLocale), { target: { value: 'zh-CN' } })
  view.unmount()
  expect(citationFace.hooks.citationCard.getSnapshot().dirty).toBe(false)
  expect(scope.writes).toEqual([])
})
it('keeps CSL controls disabled when the core settings document is read-only', () => {
  const { defaults } = mountSettings(
    'row',
    fakeScope({
      value: { defaultStyle: 'apa', defaultLocale: 'en-US' },
      writable: false,
    }),
  )
  expect((defaults.getByLabelText(zh.defaultStyle) as HTMLInputElement).disabled).toBe(true)
  expect((defaults.getByLabelText(zh.defaultLocale) as HTMLInputElement).disabled).toBe(true)
  expect((defaults.getByRole('button', { name: zh.save }) as HTMLButtonElement).disabled).toBe(true)
})
