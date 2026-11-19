/**
 * The staged form controller for the `scholarly` namespace: the contact email,
 * the write-only external scholarly API keys, the search and read quotas, and
 * the background-job policy.
 *
 * Key values go to the host credentials store, not into settings. The reference
 * fields stay in the schema and card state but have no control: a key edit
 * stages the suggested reference when the committed one is empty, then a save
 * writes the settings document first and each typed key through
 * `ctx.remote.credentials.set` under the effective reference. A committed custom
 * reference is kept, and reads use committed references only. The configured
 * badge comes from `ctx.remote.credentials.describe`.
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
import { booleanFieldSpec } from './helpers/settings-fields.ts'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { CREDENTIAL_REFERENCE, credentialRefFieldSpec } from './helpers/credential-reference.ts'
export { CREDENTIAL_REFERENCE }
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { asFormScope } from './helpers/form-scope.ts'
import type { NamespaceStatus } from './helpers/namespace-status.ts'
import {
  SCHOLARLY_CREDENTIAL_REFERENCE_NAMES,
  SCHOLARLY_KEY_FIELD_PAIRS,
} from '../credential-names.js'

/** Settings text fields, including the three credential references. */
const SCHOLARLY_TEXT_KEYS = ['email', 's2ApiKeyEnv', 'ncbiApiKeyEnv', 'openalexApiKeyEnv'] as const
export type ScholarlyTextKey = (typeof SCHOLARLY_TEXT_KEYS)[number]

const SECRET_KEYS = ['s2Key', 'ncbiKey', 'openalexKey'] as const
export type ScholarlySecretKey = (typeof SECRET_KEYS)[number]

/**
 * The reference field each write-only control feeds, derived from the shared
 * key-field tuple the host resolver reads too (see the parity spec).
 */
export const SECRET_REF_FIELDS = Object.fromEntries(
  SCHOLARLY_KEY_FIELD_PAIRS.map(([secret, reference]) => [secret, reference]),
) as Readonly<Record<ScholarlySecretKey, string>>

/** The reference each key uses when the profile has not committed one. */
const SUGGESTED_REFERENCE: Readonly<Record<ScholarlySecretKey, string>> = {
  s2Key: SCHOLARLY_CREDENTIAL_REFERENCE_NAMES.semanticScholar,
  ncbiKey: SCHOLARLY_CREDENTIAL_REFERENCE_NAMES.ncbi,
  openalexKey: SCHOLARLY_CREDENTIAL_REFERENCE_NAMES.openalex,
}

/** The inverse map, for clearing the right control's draft. */
export const SECRET_FOR_REFERENCE: Readonly<Record<string, ScholarlySecretKey>> =
  Object.fromEntries(SCHOLARLY_KEY_FIELD_PAIRS.map(([secret, reference]) => [reference, secret]))

/** Whole-number limits. */
export const SCHOLARLY_NUMERIC_KEYS = ['maxResults', 'maxContentChars', 'foregroundWaitMs'] as const
export type ScholarlyNumericKey = (typeof SCHOLARLY_NUMERIC_KEYS)[number]

/** Background-job policy toggles. */
export const SCHOLARLY_BOOLEAN_KEYS = ['enableRunInBackground', 'promoteOnTimeout'] as const
export type ScholarlyBooleanKey = (typeof SCHOLARLY_BOOLEAN_KEYS)[number]

/** One credential answer, reduced to the two facts the form renders. */
export interface ScholarlyCredentialInfo {
  readonly configured: boolean
  readonly writable: boolean
}

/** The client-side credential operations the form consumes. */
export interface ScholarlyCredentialPort {
  describe(
    refs: readonly string[],
  ): Promise<RemoteResult<Readonly<Record<string, ScholarlyCredentialInfo>>>>
  set(ref: string, value: string): Promise<RemoteResult<unknown>>
}

/** One credential answer together with the reference it was read under. */
interface ScholarlyCredentialAnswer extends ScholarlyCredentialInfo {
  readonly ref: string
}

/** Whether a key control has an unusable committed reference. */
type ScholarlyReferenceState = 'ready' | 'invalid'

interface ScholarlySecretFieldState {
  readonly text: string
  readonly configured: boolean
  readonly disabled: boolean
  readonly referenceState: ScholarlyReferenceState
}

/** Everything the Scholarly configuration card renders. */
export interface ScholarlyCardState extends SettingsFormShell {
  /** Namespace lifecycle from the shared settings form; `available` is its boolean face. */
  readonly namespaceStatus: NamespaceStatus
  readonly email: SettingsFieldState
  readonly s2ApiKeyEnv: SettingsFieldState
  readonly ncbiApiKeyEnv: SettingsFieldState
  readonly openalexApiKeyEnv: SettingsFieldState
  readonly maxResults: SettingsFieldState
  readonly maxContentChars: SettingsFieldState
  readonly enableRunInBackground: SettingsFieldState
  readonly promoteOnTimeout: SettingsFieldState
  readonly foregroundWaitMs: SettingsFieldState
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

/**
 * A POSIX-style environment-variable name, the credential-reference grammar.
 * The client graph cannot import the host validation, so this must mirror
 * `REF_PATTERN` in `@deepseek-ai/dsh-credentials` (which the host's
 * `credentialRef()` enforces); the parity spec pins the two together.
 */

function fieldSpecs(): SettingsFieldSpec[] {
  return [
    settingsTextField('email'),
    credentialRefFieldSpec('s2ApiKeyEnv'),
    credentialRefFieldSpec('ncbiApiKeyEnv'),
    credentialRefFieldSpec('openalexApiKeyEnv'),
    settingsNumberField('maxResults'),
    settingsNumberField('maxContentChars'),
    booleanFieldSpec('enableRunInBackground'),
    booleanFieldSpec('promoteOnTimeout'),
    settingsNumberField('foregroundWaitMs'),
  ]
}

/**
 * The controller: it manages the scholarly configuration's staged edits,
 * credential writes, and the snapshot the card renders.
 */
export class ScholarlyFormController {
  private readonly model: SettingsFormModel<Record<string, unknown>>
  private readonly store: SnapshotStore<ScholarlyCardState>
  private readonly unsubscribe: () => void
  private credentials: Readonly<Partial<Record<ScholarlySecretKey, ScholarlyCredentialAnswer>>> = {}
  private credentialReadSequence = 0
  private credentialReadQueued = false
  private referencesKey = ''
  private disposed = false

  constructor(
    private readonly form: ConfigForm<Record<string, unknown>>,
    private readonly credentialsPort: ScholarlyCredentialPort,
  ) {
    const scope = asFormScope(form)
    this.model = new SettingsFormModel(
      scope,
      fieldSpecs(),
      SECRET_KEYS.map((field) => ({
        field,
        write: (text) => this.writeCredential(field, text),
      })),
    )
    this.store = this.model.bind(() => this.project())
    this.unsubscribe = form.subscribe(() => {
      this.onFormPublished()
    })
    this.onFormPublished()
  }

  /** Current snapshot projected from model state and the credential answers. */
  private project(): ScholarlyCardState {
    const shell = this.model.shell()
    const disabled = !shell.writable || shell.saving

    const secretStateOf = (key: ScholarlySecretKey): ScholarlySecretFieldState => {
      const ref = this.committedRefOf(key)
      const answer = this.credentials[key]
      const referenceState = this.referenceStateOf(key)
      return {
        text: this.model.field(key).text,
        configured: answer !== undefined && answer.ref === ref && answer.configured,
        disabled: disabled || referenceState !== 'ready' || answer?.writable === false,
        referenceState,
      }
    }

    return {
      ...shell,
      namespaceStatus: this.form.getSnapshot().status,
      email: this.model.field('email'),
      s2ApiKeyEnv: this.model.field('s2ApiKeyEnv'),
      ncbiApiKeyEnv: this.model.field('ncbiApiKeyEnv'),
      openalexApiKeyEnv: this.model.field('openalexApiKeyEnv'),
      maxResults: this.model.field('maxResults'),
      maxContentChars: this.model.field('maxContentChars'),
      enableRunInBackground: this.model.field('enableRunInBackground'),
      promoteOnTimeout: this.model.field('promoteOnTimeout'),
      foregroundWaitMs: this.model.field('foregroundWaitMs'),
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
      edit: (field, text) => {
        actions.edit(field, text)
        const secret = SECRET_FOR_REFERENCE[field]
        if (secret !== undefined) {
          // A key draft belongs to the reference it was typed under; changing
          // the reference makes the draft meaningless, so drop it locally.
          actions.edit(secret, '')
          return
        }
        const secretKey = SECRET_KEYS.find((key) => key === field)
        if (secretKey === undefined || this.rawRefOf(secretKey) !== '') return
        // The reference fields are not rendered. Stage the suggested name with
        // the first key save, and undo that draft when the key draft is cleared.
        actions.edit(
          SECRET_REF_FIELDS[secretKey],
          text.trim() === '' ? '' : SUGGESTED_REFERENCE[secretKey],
        )
      },
      resetField: (field) => {
        actions.resetField(field)
        const secret = SECRET_FOR_REFERENCE[field]
        if (secret !== undefined) actions.edit(secret, '')
      },
      save: actions.save,
      discard: actions.discard,
    }
  }

  /** Re-read the credentials after the Host reports a reference changed. */
  refreshCredential(ref: string): void {
    if (this.disposed) return
    if (this.committedReferences().includes(ref)) this.queueCredentialRead()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe()
    this.model.dispose()
  }

  /** The committed section's references, deduplicated and grammar-checked. */
  private committedReferences(): string[] {
    return [
      ...new Set(SECRET_KEYS.map((key) => this.committedRefOf(key)).filter((ref) => ref !== '')),
    ]
  }

  /** The committed reference for one key control, or '' when missing/invalid. */
  private committedRefOf(field: ScholarlySecretKey): string {
    const raw = this.rawRefOf(field)
    return raw !== '' && CREDENTIAL_REFERENCE.test(raw) ? raw : ''
  }

  /** The reference a key write uses: the committed custom name, or the suggested name. */
  private effectiveRefOf(field: ScholarlySecretKey): string {
    const raw = this.rawRefOf(field)
    if (raw === '') return SUGGESTED_REFERENCE[field]
    return CREDENTIAL_REFERENCE.test(raw) ? raw : ''
  }

  /** The committed raw reference text, before grammar validation. */
  private rawRefOf(field: ScholarlySecretKey): string {
    const value = this.form.getSnapshot().value
    const raw = value?.[SECRET_REF_FIELDS[field]]
    return typeof raw === 'string' ? raw.trim() : ''
  }

  /** Whether the control has an invalid committed reference. */
  private referenceStateOf(field: ScholarlySecretKey): ScholarlyReferenceState {
    const raw = this.rawRefOf(field)
    return raw === '' || CREDENTIAL_REFERENCE.test(raw) ? 'ready' : 'invalid'
  }

  /** Coalesce reads requested by a published section into one remote call. */
  private queueCredentialRead(): void {
    if (this.credentialReadQueued || this.disposed) return
    this.credentialReadQueued = true
    queueMicrotask(() => {
      this.credentialReadQueued = false
      if (this.disposed) return
      void this.readCredentials()
    })
  }

  /** Read the credentials only when the committed reference set actually moves. */
  private onFormPublished(): void {
    if (this.disposed) return
    const key = this.committedReferences().join('\n')
    if (key === this.referencesKey) return
    this.referencesKey = key
    this.queueCredentialRead()
  }

  /**
   * Ask the credentials domain about every committed reference.
   *
   * Only the latest read publishes; every caller still receives its own answer,
   * so a concurrent invalidation cannot turn a successful write into a failed
   * one.
   * @returns the answers keyed by reference, or undefined after failure/disposal.
   */
  private async readCredentials(): Promise<
    Readonly<Record<string, ScholarlyCredentialInfo>> | undefined
  > {
    if (this.disposed) return undefined
    const sequence = ++this.credentialReadSequence
    const refs = this.committedReferences()
    if (refs.length === 0) {
      if (sequence === this.credentialReadSequence) {
        this.credentials = {}
        this.publish()
      }
      return {}
    }
    const response = await this.credentialsPort.describe(refs)
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- dispose() can run during the await.
    if (this.disposed || !response.ok) return undefined
    if (sequence === this.credentialReadSequence) {
      const next: Partial<Record<ScholarlySecretKey, ScholarlyCredentialAnswer>> = {}
      for (const field of SECRET_KEYS) {
        const ref = this.committedRefOf(field)
        if (ref === '') continue
        const answer = response.value[ref]
        next[field] = {
          ref,
          configured: answer?.configured === true,
          // An unknown reference stays writable: the Host is the authority that
          // refuses, not a client-side guess.
          writable: answer?.writable !== false,
        }
      }
      this.credentials = next
      this.publish()
    }
    return response.value
  }

  /** Write one key under its effective reference, then confirm the Host holds it. */
  private async writeCredential(field: ScholarlySecretKey, text: string): Promise<boolean> {
    const ref = this.effectiveRefOf(field)
    if (ref === '' || text.trim() === '') return false
    const response = await this.credentialsPort.set(ref, text.trim())
    if (!response.ok) return false
    const views = await this.readCredentials()
    return views?.[ref]?.configured === true
  }

  private publish(): void {
    this.store.set(this.project())
  }
}
