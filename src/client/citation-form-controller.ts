/** Shared CSL defaults, edited in Literature panel settings and stored in the core namespace. */
import {
  SettingsFormModel,
  settingsTextField,
  type SettingsFieldState,
  type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { asFormScope } from './helpers/form-scope.ts'

export const CITATION_FIELD_KEYS = ['defaultStyle', 'defaultLocale'] as const
export type CitationFieldKey = (typeof CITATION_FIELD_KEYS)[number]
export type CitationCardState = SettingsFormShell &
  Readonly<Record<CitationFieldKey, SettingsFieldState>>

export class CitationFormController {
  private readonly model: SettingsFormModel<Record<string, unknown>>
  private readonly store

  constructor(form: ConfigForm<Record<string, unknown>>) {
    this.model = new SettingsFormModel(
      asFormScope(form),
      CITATION_FIELD_KEYS.map((key) => settingsTextField(key)),
    )
    this.store = this.model.bind((): CitationCardState => ({
      ...this.model.shell(),
      defaultStyle: this.model.field('defaultStyle'),
      defaultLocale: this.model.field('defaultLocale'),
    }))
  }

  inject() {
    return { ...this.model.actions(), hooks: { citationCard: this.store } }
  }

  dispose(): void {
    this.model.dispose()
  }
}
export type CitationCardFace = ReturnType<CitationFormController['inject']>
