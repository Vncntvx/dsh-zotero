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
import type { ZoteroJournalMetricsRefreshView } from '../contract.ts'
import {
  isJournalMetricDetailFields,
  isJournalMetricListRules,
  journalMetricDetailFieldsOf,
  journalMetricListRulesOf,
} from '../journal-metrics.ts'
import { CREDENTIAL_REFERENCE, type CredentialInfo } from './helpers/credential-reference.ts'
import type { ScholarlyCredentialPort } from './scholarly-form-controller.ts'
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
  Readonly<Record<LibraryPreferenceKey, SettingsFieldState>> & {
    readonly easyScholarSecret: SettingsFieldState & CredentialInfo
  }

export interface LibraryCardFace extends SettingsFormActions {
  readonly refreshJournalMetrics?: () => Promise<ZoteroJournalMetricsRefreshView>
  readonly hooks: {
    readonly libraryCard: SnapshotStore<LibraryCardState>
  }
}

function fieldSpecs(): SettingsFieldSpec[] {
  return LIBRARY_PREFERENCE_KEYS.map((field): SettingsFieldSpec => {
    if (
      field === 'rightSidebarEnabled' ||
      field === 'allowUrlPdfRead' ||
      field === 'journalMetricsEnabled'
    )
      return booleanFieldSpec(field)
    if (field === 'easyScholarSecretKeyRef')
      return {
        field,
        format: (value) => String(value ?? LIBRARY_DEFAULTS.easyScholarSecretKeyRef),
        parse: (text) =>
          CREDENTIAL_REFERENCE.test(text) ? { kind: 'set', value: text } : undefined,
      }
    return {
      field,
      format: (value) =>
        JSON.stringify(
          field === 'journalMetricListOrder'
            ? (journalMetricListRulesOf(value) ?? LIBRARY_DEFAULTS.journalMetricListOrder)
            : field === 'journalMetricDetailFields' && isJournalMetricDetailFields(value)
              ? journalMetricDetailFieldsOf(value)
              : (value ?? LIBRARY_DEFAULTS[field]),
        ),
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
          } else if (field === 'journalMetricListOrder') {
            if (!isJournalMetricListRules(value)) return undefined
          } else if (field === 'journalMetricDetailFields') {
            if (!isJournalMetricDetailFields(value)) return undefined
            return { kind: 'set', value: journalMetricDetailFieldsOf(value) }
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
  private readonly unsubscribe: () => void
  private credential?: CredentialInfo
  private reference?: string
  private sequence = 0

  constructor(
    private readonly form: ConfigForm<Record<string, unknown>>,
    private readonly credentials?: ScholarlyCredentialPort,
    private readonly refreshJournalMetrics?: LibraryCardFace['refreshJournalMetrics'],
  ) {
    const scope = asFormScope(form)
    this.model = new SettingsFormModel(scope, fieldSpecs(), [
      {
        field: 'easyScholarSecret',
        write: async (text) => {
          const ref = this.reference
          if (!ref || !this.credentials) return false
          const response = await this.credentials.set(ref, text.trim())
          if (response.ok) await this.refreshCredential(ref)
          return response.ok
        },
      },
    ])
    this.store = this.model.bind(() => this.project())
    const syncReference = () => {
      const snapshot = this.form.getSnapshot()
      const value =
        snapshot.value?.easyScholarSecretKeyRef ?? LIBRARY_DEFAULTS.easyScholarSecretKeyRef
      const ref =
        snapshot.status === 'ready' && typeof value === 'string' && CREDENTIAL_REFERENCE.test(value)
          ? value
          : undefined
      if (ref === this.reference) return
      this.reference = ref
      this.credential = undefined
      this.sequence += 1
      this.store.set(this.project())
      if (ref !== undefined) void this.refreshCredential(ref)
    }
    this.unsubscribe = form.subscribe(syncReference)
    syncReference()
  }

  async refreshCredential(ref: string): Promise<void> {
    if (ref !== this.reference || !this.credentials) return
    const sequence = ++this.sequence
    const response = await this.credentials.describe([ref]).catch(() => undefined)
    if (sequence !== this.sequence) return
    this.credential = response?.ok ? response.value[ref] : undefined
    this.store.set(this.project())
  }

  private project(): LibraryCardState {
    const shell = this.model.shell()
    return {
      ...shell,
      easyScholarSecret: {
        ...this.model.field('easyScholarSecret'),
        configured: this.credential?.configured === true,
        writable: this.credentials !== undefined && this.credential?.writable !== false,
      },
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
      refreshJournalMetrics: this.refreshJournalMetrics,
    }
  }

  dispose(): void {
    this.sequence += 1
    this.unsubscribe()
    this.model.dispose()
  }
}
