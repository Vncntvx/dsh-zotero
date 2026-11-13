// @vitest-environment jsdom
/**
 * The Zotero configuration page (the plugin manager's `plugins.bundle.config`
 * slot), rendered through a driven fixture runtime: the test binds the
 * controller's snapshot source with useSyncExternalStore, feeds the component
 * plain props, and drives user gestures with testing-library's fireEvent. The
 * page renders its whole grouped form at once (no disclosure chrome), so no
 * test point has to open it first.
 * @module tests/client/settings/ZoteroSettingsSection
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ZoteroSettingsForm } from '../../../src/client/ZoteroSettingsForm.tsx'
import { zh } from '../../../src/client/locales.ts'
import { ZoteroCardController } from '../../../src/client/zotero-card-controller.ts'
import { fakeScope, type FakeScope } from '../helpers/fake-scope.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'

let scope: FakeScope

afterEach(() => {
  // vitest runs without globals, so testing-library cannot register its own
  // auto-cleanup; without it, successive renders would accumulate in the DOM.
  cleanup()
  scope = undefined as unknown as FakeScope
})

describe('ZoteroSettingsSection tab surface', () => {
  it('offers only tabs that render a panel and clamps a panel-less request', () => {
    scope = fakeScope({ value: {} })
    const controller = new ZoteroCardController(scope)
    const face = controller.inject()
    const state = face.hooks.zoteroCard.getSnapshot()

    render(
      <ZoteroSettingsForm t={makeTranslate(zh)} state={state} actions={face} activeTab="library" />,
    )
    // `library` renders its own settings section, so the strip has no such tab
    // and the requested tab clamps to the first rendered one.
    expect(screen.queryByRole('tab', { name: zh.tabLibrary })).toBeNull()
    for (const tab of screen.getAllByRole('tab')) {
      fireEvent.click(tab)
      // Every offered tab owns a panel: a click never empties the page.
      expect(document.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1)
    }
    controller.dispose()
  })
})
