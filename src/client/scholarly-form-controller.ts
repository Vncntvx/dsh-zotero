/**
 * The staged form controller for the `scholarly` namespace: the contact email,
 * the secret API keys (Semantic Scholar, NCBI, OpenAlex), the search and read
 * quotas, and the cache directory.
 *
 * It follows the harness's own `SettingsFormModel` pattern: staged edits,
 * revision-fenced atomic mutations, discard on unmount.
 * @module dsh-zotero/client/scholarly-form-controller
 */

import {
  SettingsFormModel,
  settingsNumberField,
  settingsTextField,
  type SettingsFieldSpec,
  type SettingsFieldState,
  type SettingsFormActions,
  type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { asFormScope } from './helpers/form-scope.ts'

/** Text and path fields, edited directly. */
export const SCHOLARLY_TEXT_KEYS = ['email'] as const
export type ScholarlyTextKey = (typeof SCHOLARLY_TEXT_KEYS)[number]

/** Secret credentials, write-only and masked. */
export const SCHOLARLY_SECRET_KEYS = ['s2Key', 'ncbiKey', 'openalexKey'] as const
export type ScholarlySecretKey = (typeof SCHOLARLY_SECRET_KEYS)[number]

/** Whole-number limits. */
export const SCHOLARLY_NUMERIC_KEYS = ['maxResults', 'maxContentChars'] as const
export type ScholarlyNumericKey = (typeof SCHOLARLY_NUMERIC_KEYS)[number]

export type ScholarlyFieldKey =
  ScholarlyTextKey | ScholarlySecretKey | ScholarlyNumericKey | ScholarlyEnabledKey

export type ScholarlyEnabledKey = 'enabled'

export interface ScholarlySecretFieldState {
  readonly text: string
  readonly configured: boolean
  readonly disabled: boolean
}

/** Everything the Scholarly configuration card renders. */
export interface ScholarlyCardState extends SettingsFormShell {
  readonly enabled: SettingsFieldState
  readonly email: SettingsFieldState
  readonly maxResults: SettingsFieldState
  readonly maxContentChars: SettingsFieldState
  readonly s2Key: ScholarlySecretFieldState
  readonly ncbiKey: ScholarlySecretFieldState
  readonly openalexKey: ScholarlySecretFieldState
}

/** The action and hook faces handed to slot renderers. */
export interface ScholarlyCardFace extends SettingsFormActions {
  readonly hooks: {
    readonly scholarlyCard: SnapshotStore<ScholarlyCardState>
  }
}

function secretFieldSpec(field: string): SettingsFieldSpec {
  return {
    field,
    format: () => '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return undefined
      return { kind: 'set', value: trimmed }
    },
  }
}

function fieldSpecs(): SettingsFieldSpec[] {
  return [
    {
      field: 'enabled',
      format: (value) => (value === true ? 'true' : 'false'),
      parse: (text) => ({ kind: 'set', value: text.trim().toLowerCase() === 'true' }),
    },
    settingsTextField('email'),
    secretFieldSpec('s2Key'),
    secretFieldSpec('ncbiKey'),
    secretFieldSpec('openalexKey'),
    settingsNumberField('maxResults'),
    settingsNumberField('maxContentChars'),
  ]
}

/**
 * The controller: it manages the scholarly configuration's staged edits and
 * projects the snapshot the card renders.
 */
export class ScholarlyFormController {
  private readonly model: SettingsFormModel<Record<string, unknown>>
  private readonly store: SnapshotStore<ScholarlyCardState>

  constructor(private readonly form: ConfigForm<Record<string, unknown>>) {
    const scope = asFormScope(form)
    this.model = new SettingsFormModel(scope, fieldSpecs())
    this.store = this.model.bind(() => this.project())
  }

  /** Current snapshot projected from model state. */
  private project(): ScholarlyCardState {
    const shell = this.model.shell()
    const snapshot = this.form.getSnapshot()
    const disabled = !shell.writable || shell.saving

    const secretStateOf = (key: ScholarlySecretKey): ScholarlySecretFieldState => {
      const field = this.model.field(key)
      const val = snapshot.value?.[key]
      const userVal = (snapshot.user as Record<string, unknown> | undefined)?.[key]
      const hasStored =
        (typeof val === 'string' && val.trim() !== '') ||
        (typeof userVal === 'string' && userVal.trim() !== '')
      return {
        text: field.text,
        configured: hasStored,
        disabled,
      }
    }

    return {
      ...shell,
      enabled: this.model.field('enabled'),
      email: this.model.field('email'),
      maxResults: this.model.field('maxResults'),
      maxContentChars: this.model.field('maxContentChars'),
      s2Key: secretStateOf('s2Key'),
      ncbiKey: secretStateOf('ncbiKey'),
      openalexKey: secretStateOf('openalexKey'),
    }
  }

  inject(): ScholarlyCardFace {
    const actions = this.model.actions()
    return {
      hooks: {
        scholarlyCard: this.store,
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
