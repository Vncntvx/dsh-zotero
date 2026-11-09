/**
 * The staged form controller for the `parsing` settings namespace
 * (`dsh-zotero/parsing` row): the API mode, the MinerU token credential
 * reference and value, the data-egress authorization, and the output directory.
 *
 * The mode switch is deliberately independent of the token: `mode` is its own
 * staged field, and the token reference/secret are separate fields. A user who
 * configured a token can still leave or return the mode to `free`, and the host
 * reads the token only in `pro` mode.
 *
 * The token value never enters settings. `mineruTokenRef` holds a credential
 * reference name; the value is written through `ctx.remote.credentials.set`
 * under the committed reference, exactly as the scholarly keys are.
 * @module dsh-zotero/client/parsing-form-controller
 */

import {
  SettingsFormModel,
  type SettingsFieldSpec,
  type SettingsFieldState,
  type SettingsFormActions,
  type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { booleanFieldSpec } from './helpers/settings-fields.ts'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { asFormScope } from './helpers/form-scope.ts'
import {
  isParsingOutputDirPath,
  PARSING_MODE_CHOICES,
  PARSING_DEFAULTS,
} from '../parsing-preferences.ts'
import { PARSING_CREDENTIAL_REFERENCE_NAMES, PARSING_KEY_FIELD_PAIRS } from '../credential-names.ts'

/** The single write-only secret control and the reference field that feeds it. */
export const PARSING_SECRET_KEY = PARSING_KEY_FIELD_PAIRS[0][0]
export const PARSING_REFERENCE_FIELD = PARSING_KEY_FIELD_PAIRS[0][1]

/** One credential answer, reduced to the two facts the form renders. */
export interface ParsingCredentialInfo {
  readonly configured: boolean
  readonly writable: boolean
}

/** The client-side credential operations the form consumes. */
export interface ParsingCredentialPort {
  describe(
    refs: readonly string[],
  ): Promise<RemoteResult<Readonly<Record<string, ParsingCredentialInfo>>>>
  set(ref: string, value: string): Promise<RemoteResult<unknown>>
}

/** A POSIX-style environment-variable name, mirroring `credentialRef()`. */
export const PARSING_CREDENTIAL_REFERENCE = /^[A-Za-z_][A-Za-z0-9_]*$/

interface ParsingSecretFieldState {
  readonly text: string
  readonly configured: boolean
  readonly disabled: boolean
  readonly referenceState: 'ready' | 'missing' | 'invalid'
}

/** Everything the parsing configuration card renders. */
export interface ParsingCardState extends SettingsFormShell {
  readonly mode: SettingsFieldState
  readonly mineruTokenRef: SettingsFieldState
  readonly allowParsingUpload: SettingsFieldState
  readonly outputDir: SettingsFieldState
  readonly mineruToken: ParsingSecretFieldState
}

export interface ParsingCardFace extends SettingsFormActions {
  readonly hooks: {
    readonly parsingCard: SnapshotStore<ParsingCardState>
  }
}

function credentialRefFieldSpec(field: string): SettingsFieldSpec {
  return {
    field,
    format: (value) => (typeof value === 'string' ? value : ''),
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      return PARSING_CREDENTIAL_REFERENCE.test(trimmed)
        ? { kind: 'set', value: trimmed }
        : undefined
    },
  }
}

function modeFieldSpec(): SettingsFieldSpec {
  return {
    field: 'mode',
    format: (value) => (typeof value === 'string' ? value : PARSING_DEFAULTS.mode),
    parse: (text) =>
      (PARSING_MODE_CHOICES as readonly string[]).includes(text)
        ? { kind: 'set', value: text }
        : undefined,
  }
}

function outputDirFieldSpec(): SettingsFieldSpec {
  return {
    field: 'outputDir',
    format: (value) => (typeof value === 'string' ? value : ''),
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      return isParsingOutputDirPath(trimmed) ? { kind: 'set', value: trimmed } : undefined
    },
  }
}

function fieldSpecs(): SettingsFieldSpec[] {
  return [
    modeFieldSpec(),
    credentialRefFieldSpec(PARSING_REFERENCE_FIELD),
    booleanFieldSpec('allowParsingUpload'),
    outputDirFieldSpec(),
  ]
}

export class ParsingFormController {
  private readonly model: SettingsFormModel<Record<string, unknown>>
  private readonly store: SnapshotStore<ParsingCardState>
  private readonly unsubscribe: () => void
  private credential: (ParsingCredentialInfo & { ref: string }) | undefined
  private credentialReadSequence = 0
  private credentialReadQueued = false
  private referenceKey = ''
  private disposed = false

  constructor(
    private readonly form: ConfigForm<Record<string, unknown>>,
    private readonly credentialsPort: ParsingCredentialPort,
  ) {
    const scope = asFormScope(form)
    this.model = new SettingsFormModel(scope, fieldSpecs(), [
      { field: PARSING_SECRET_KEY, write: (text) => this.writeCredential(text) },
    ])
    this.store = this.model.bind(() => this.project())
    this.unsubscribe = form.subscribe(() => this.onFormPublished())
    this.onFormPublished()
  }

  private committedRef(): string {
    const value = this.form.getSnapshot().value
    const raw = value?.[PARSING_REFERENCE_FIELD]
    return typeof raw === 'string' ? raw.trim() : ''
  }

  private referenceState(): 'ready' | 'missing' | 'invalid' {
    const raw = this.committedRef()
    if (raw === '') return 'missing'
    return PARSING_CREDENTIAL_REFERENCE.test(raw) ? 'ready' : 'invalid'
  }

  private project(): ParsingCardState {
    const shell = this.model.shell()
    const ref = this.committedRef()
    const referenceState = this.referenceState()
    return {
      ...shell,
      mode: this.model.field('mode'),
      mineruTokenRef: this.model.field(PARSING_REFERENCE_FIELD),
      allowParsingUpload: this.model.field('allowParsingUpload'),
      outputDir: this.model.field('outputDir'),
      mineruToken: {
        text: this.model.field(PARSING_SECRET_KEY).text,
        configured:
          this.credential !== undefined &&
          this.credential.ref === ref &&
          this.credential.configured,
        disabled:
          !shell.writable ||
          shell.saving ||
          referenceState !== 'ready' ||
          this.credential?.writable === false,
        referenceState,
      },
    }
  }

  inject(): ParsingCardFace {
    const actions = this.model.actions()
    return {
      hooks: { parsingCard: this.store },
      edit: (field, text) => {
        actions.edit(field, text)
        if (field === PARSING_REFERENCE_FIELD) actions.edit(PARSING_SECRET_KEY, '')
      },
      resetField: (field) => {
        actions.resetField(field)
        if (field === PARSING_REFERENCE_FIELD) actions.edit(PARSING_SECRET_KEY, '')
      },
      save: actions.save,
      discard: actions.discard,
    }
  }

  /** Re-read the credential after the Host reports its reference changed. */
  refreshCredential(ref: string): void {
    if (!this.disposed && this.committedRef() === ref) this.queueCredentialRead()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe()
    this.model.dispose()
  }

  private queueCredentialRead(): void {
    if (this.credentialReadQueued || this.disposed) return
    this.credentialReadQueued = true
    queueMicrotask(() => {
      this.credentialReadQueued = false
      if (!this.disposed) void this.readCredential()
    })
  }

  private onFormPublished(): void {
    if (this.disposed) return
    const key = this.committedRef()
    if (key === this.referenceKey) return
    this.referenceKey = key
    this.queueCredentialRead()
  }

  private async readCredential(): Promise<void> {
    if (this.disposed) return
    const sequence = ++this.credentialReadSequence
    const ref = this.committedRef()
    if (ref === '' || !PARSING_CREDENTIAL_REFERENCE.test(ref)) {
      if (sequence === this.credentialReadSequence) {
        this.credential = undefined
        this.publish()
      }
      return
    }
    const response = await this.credentialsPort.describe([ref])
    if (this.disposed || !response.ok || sequence !== this.credentialReadSequence) return
    const answer = response.value[ref]
    this.credential = {
      ref,
      configured: answer?.configured === true,
      writable: answer?.writable !== false,
    }
    this.publish()
  }

  private async writeCredential(text: string): Promise<boolean> {
    const ref = this.committedRef()
    if (ref === '' || text.trim() === '' || !PARSING_CREDENTIAL_REFERENCE.test(ref)) return false
    const response = await this.credentialsPort.set(ref, text.trim())
    if (!response.ok) return false
    await this.readCredential()
    return this.credential?.ref === ref && this.credential.configured
  }

  private publish(): void {
    this.store.set(this.project())
  }
}

/** Suggested credential reference name, for the form hint. */
export const PARSING_SUGGESTED_REF = PARSING_CREDENTIAL_REFERENCE_NAMES.mineru
