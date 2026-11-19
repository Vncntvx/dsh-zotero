// @vitest-environment jsdom
/**
 * The Zotero core settings form renders only the visible subset of its
 * namespace, and a save writes only the fields the user edited: a hidden
 * config-file field has no control and never turns into a write by accident.
 * @module tests/client/settings/ZoteroSettingsSection.visibility
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZoteroSettingsForm } from '../../../src/client/ZoteroSettingsForm.tsx'
import { zh } from '../../../src/client/locales.ts'
import {
  FIELD_GROUPS,
  HIDDEN_FIELD_KEYS,
  ZoteroCardController,
  type ZoteroCardFace,
} from '../../../src/client/zotero-card-controller.ts'
import { fakeScope, type FakeScope } from '../helpers/fake-scope.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'

let scope: FakeScope

afterEach(() => {
  cleanup()
  scope = undefined as unknown as FakeScope
})

/** Render the core form over a fresh card and return its face. */
function mount(): ZoteroCardFace {
  const controller = new ZoteroCardController(scope)
  const face = controller.inject()
  render(
    <ZoteroSettingsForm
      t={makeTranslate(zh)}
      state={face.hooks.zoteroCard.getSnapshot()}
      actions={face}
    />,
  )
  return face
}

describe('Zotero core settings visibility', () => {
  it('renders one control per visible field and none for hidden fields', () => {
    scope = fakeScope({ value: {} })
    mount()
    expect(document.querySelectorAll('input')).toHaveLength(
      FIELD_GROUPS.flatMap((group) => group.fields).length,
    )
    for (const key of HIDDEN_FIELD_KEYS) {
      expect(
        document.getElementById(`zotero-settings-${key}`),
        `${key} must stay off the settings page`,
      ).toBeNull()
    }
  })

  it('does not write a hidden field that was never edited', async () => {
    scope = fakeScope({ value: { webEnabled: true, provider: 'local' } })
    const face = mount()
    fireEvent.click(screen.getByLabelText(zh.webEnabled))
    face.save()
    await vi.waitFor(() =>
      expect(scope.writes).toEqual([{ op: 'set', field: 'webEnabled', value: false }]),
    )
  })
})
