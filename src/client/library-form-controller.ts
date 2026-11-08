/**
 * The staged form controller for the `library` settings namespace (the
 * `dsh-zotero/library` row): display, browsing, PDF reading and citation preferences.
 *
 * Follows the harness SettingsFormModel pattern: staged edits,
 * revision-fenced atomic mutations, discard on unmount.
 * @module dsh-zotero/client/library-form-controller
 */

import {
  SettingsFormModel,
  type SettingsFieldSpec,
  type SettingsFieldState,
  type SettingsFormActions,
  type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { asFormScope } from './helpers/form-scope.ts'
import {
  LIBRARY_CHOICES,
  LIBRARY_DEFAULTS,
  LIBRARY_PREFERENCE_KEYS,
  LIBRARY_SECTIONS,
  type LibraryPreferenceKey,
} from '../library-preferences.ts'
import { booleanFieldSpec } from './helpers/settings-fields.ts'

export type LibraryCardState = SettingsFormShell &
  Readonly<Record<LibraryPreferenceKey, SettingsFieldState>>

export interface LibraryCardFace extends SettingsFormActions {
  readonly hooks: {
    readonly libraryCard: SnapshotStore<LibraryCardState>
  }
}

function fieldSpecs(): SettingsFieldSpec[] {
  return LIBRARY_PREFERENCE_KEYS.map((field): SettingsFieldSpec => {
    if (field === 'rightSidebarEnabled' || field === 'allowUrlPdfRead')
      return booleanFieldSpec(field)
    return {
      field,
      format: (value) => JSON.stringify(value ?? LIBRARY_DEFAULTS[field]),
      parse: (text) => {
        if (text.trim() === '') return { kind: 'clear' }
        try {
          const value: unknown = JSON.parse(text)
          if (field === 'detailExpandedSections') {
            if (
              !Array.isArray(value) ||
              value.some((v) => !LIBRARY_SECTIONS.includes(v)) ||
              new Set(value).size !== value.length
            )
              return undefined
          } else if (!(LIBRARY_CHOICES[field] as readonly unknown[]).includes(value))
            return undefined
          return { kind: 'set', value }
        } catch {
          return undefined
        }
      },
    }
  })
}

export class LibraryFormController {
  private readonly model: SettingsFormModel<Record<string, unknown>>
  private readonly store: SnapshotStore<LibraryCardState>

  constructor(form: ConfigForm<Record<string, unknown>>) {
    const scope = asFormScope(form)
    this.model = new SettingsFormModel(scope, fieldSpecs())
    this.store = this.model.bind(() => this.project())
  }

  private project(): LibraryCardState {
    const shell = this.model.shell()
    return {
      ...shell,
      ...(Object.fromEntries(
        LIBRARY_PREFERENCE_KEYS.map((key) => [key, this.model.field(key)]),
      ) as Record<LibraryPreferenceKey, SettingsFieldState>),
    }
  }

  inject(): LibraryCardFace {
    const actions = this.model.actions()
    return {
      hooks: {
        libraryCard: this.store,
      },
      edit: actions.edit,
      resetField: actions.resetField,
      save: actions.save,
      discard: actions.discard,
    }
  }

  dispose(): void {
    this.model.dispose()
  }
}
