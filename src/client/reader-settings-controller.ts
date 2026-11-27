/** Staged form controller for the optional Reader settings namespace. */
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
import { ZOTERO_READER_TRANSLATION_LANGUAGES } from '../constants.ts'
import type { ReaderTranslationTarget } from '../reader/config.ts'

const HISTORY_LIMIT = 'historyLimit'
const HISTORY_DEFAULT = 50

function fieldSpecs(): SettingsFieldSpec[] {
  return [
    {
      field: HISTORY_LIMIT,
      format: (value) => String(value ?? HISTORY_DEFAULT),
      parse: (text) => {
        if (text.trim() === '') return { kind: 'clear' }
        const value = Number(text)
        return Number.isSafeInteger(value) && value >= 1 && value <= 500
          ? { kind: 'set', value }
          : undefined
      },
    },
    booleanFieldSpec('persistReadingState'),
    booleanFieldSpec('captureWatermark'),
    {
      field: 'defaultTranslationTarget',
      format: (value) => String(value ?? 'auto'),
      parse: (text) =>
        text === 'auto' || ZOTERO_READER_TRANSLATION_LANGUAGES.some((language) => language === text)
          ? { kind: 'set', value: text as ReaderTranslationTarget }
          : undefined,
    },
  ]
}

export interface ReaderCardState extends SettingsFormShell {
  readonly historyLimit: SettingsFieldState
  readonly persistReadingState: SettingsFieldState
  readonly captureWatermark: SettingsFieldState
  readonly defaultTranslationTarget: SettingsFieldState
}

export interface ReaderCardFace extends SettingsFormActions {
  readonly hooks: { readonly readerCard: SnapshotStore<ReaderCardState> }
}

export class ReaderSettingsController {
  private readonly model: SettingsFormModel<Record<string, unknown>>
  private readonly store: SnapshotStore<ReaderCardState>

  constructor(form: ConfigForm<Record<string, unknown>>) {
    this.model = new SettingsFormModel(asFormScope(form), fieldSpecs())
    this.store = this.model.bind(() => ({
      ...this.model.shell(),
      historyLimit: this.model.field(HISTORY_LIMIT),
      persistReadingState: this.model.field('persistReadingState'),
      captureWatermark: this.model.field('captureWatermark'),
      defaultTranslationTarget: this.model.field('defaultTranslationTarget'),
    }))
  }

  inject(): ReaderCardFace {
    return { ...this.model.actions(), hooks: { readerCard: this.store } }
  }

  dispose(): void {
    this.model.dispose()
  }
}
