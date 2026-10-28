/**
 * The staged form controller for the `library` settings namespace (the
 * `dsh-zotero/library` row): right sidebar enablement.
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
import { booleanFieldSpec } from './helpers/settings-fields.ts'

export interface LibraryCardState extends SettingsFormShell {
  readonly rightSidebarEnabled: SettingsFieldState
}

export interface LibraryCardFace extends SettingsFormActions {
  readonly hooks: {
    readonly libraryCard: SnapshotStore<LibraryCardState>
  }
}

function fieldSpecs(): SettingsFieldSpec[] {
  return [booleanFieldSpec('rightSidebarEnabled')]
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
      rightSidebarEnabled: this.model.field('rightSidebarEnabled'),
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
