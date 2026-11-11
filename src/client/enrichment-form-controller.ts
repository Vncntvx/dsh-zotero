/**
 * The staged form controller for the `enrichment` settings namespace
 * (`dsh-zotero/enrichment` row): the API mode, the MinerU token credential
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
 * @module dsh-zotero/client/enrichment-form-controller
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
import {
  CREDENTIAL_REFERENCE as ENRICHMENT_CREDENTIAL_REFERENCE,
  credentialRefFieldSpec,
  type CredentialInfo as EnrichmentCredentialInfo,
} from './helpers/credential-reference.ts'
export { ENRICHMENT_CREDENTIAL_REFERENCE }
import type {
  ZoteroSemanticModelStatusRequestView,
  ZoteroSemanticModelStatusResultView,
  ZoteroSemanticModelDownloadRequestView,
  ZoteroSemanticModelDownloadResultView,
  ZoteroSemanticModelCancelRequestView,
  ZoteroSemanticModelCancelResultView,
  ZoteroSemanticModelVerifyRequestView,
} from '../contract.ts'
import { asFormScope } from './helpers/form-scope.ts'
import {
  isEnrichmentOutputDirPath,
  ENRICHMENT_MODE_CHOICES,
  ENRICHMENT_DEFAULTS,
} from '../enrichment-preferences.ts'
import {
  DEFAULT_SEMANTIC_MODEL,
  isSemanticModelKey,
  SEMANTIC_DOWNLOAD_SOURCES,
  SEMANTIC_MODEL_KEYS,
} from '../enrichment-model-catalog.ts'
import {
  ENRICHMENT_CREDENTIAL_REFERENCE_NAMES,
  ENRICHMENT_KEY_FIELD_PAIRS,
} from '../credential-names.ts'

/** The single write-only secret control and the reference field that feeds it. */
export const ENRICHMENT_SECRET_KEY = ENRICHMENT_KEY_FIELD_PAIRS[0][0]
export const ENRICHMENT_REFERENCE_FIELD = ENRICHMENT_KEY_FIELD_PAIRS[0][1]

/** The client-side credential operations the form consumes. */
export interface EnrichmentCredentialPort {
  describe(
    refs: readonly string[],
  ): Promise<RemoteResult<Readonly<Record<string, EnrichmentCredentialInfo>>>>
  set(ref: string, value: string): Promise<RemoteResult<unknown>>
}

/**
 * The model port's failure: one human line. The port deliberately does not
 * transport the wire's `RemoteError` class — the browser half only ever reads
 * the message — so a host without the component is expressible without
 * dragging harness classes into the client bundle.
 */
export interface ModelPortFailure {
  readonly message: string
}

export type ModelPortResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ModelPortFailure }

/** The client-side model operations the form consumes. */
export interface EnrichmentModelPort {
  semanticModelStatus(
    request: ZoteroSemanticModelStatusRequestView,
  ): Promise<ModelPortResult<ZoteroSemanticModelStatusResultView>>
  downloadSemanticModel(
    request: ZoteroSemanticModelDownloadRequestView,
  ): Promise<ModelPortResult<ZoteroSemanticModelDownloadResultView>>
  cancelSemanticModelDownload(
    request: ZoteroSemanticModelCancelRequestView,
  ): Promise<ModelPortResult<ZoteroSemanticModelCancelResultView>>
  verifySemanticModel(
    request: ZoteroSemanticModelVerifyRequestView,
  ): Promise<ModelPortResult<ZoteroSemanticModelStatusResultView>>
}

/**
 * The wire status view minus its `model` field, which the form already knows.
 * `unavailable` is one specific fact: the enrichment component's endpoints did
 * not answer (the row is off or an older host), so no model operation is
 * possible — never to be confused with "not downloaded".
 */
export type SemanticModelState = Omit<ZoteroSemanticModelStatusResultView, 'model'>

export const SEMANTIC_MODEL_UNAVAILABLE: SemanticModelState = {
  ready: false,
  downloading: false,
  path: '',
  downloadedBytes: 0,
  totalBytes: 0,
  percent: 0,
  error: 'unavailable',
}

interface EnrichmentSecretFieldState {
  readonly text: string
  readonly configured: boolean
  readonly disabled: boolean
  readonly referenceState: 'ready' | 'missing' | 'invalid'
}

/** Everything the enrichment configuration card renders. */
export interface EnrichmentCardState extends SettingsFormShell {
  readonly mode: SettingsFieldState
  readonly mineruTokenRef: SettingsFieldState
  readonly allowDocumentUpload: SettingsFieldState
  readonly outputDir: SettingsFieldState
  readonly mineruToken: EnrichmentSecretFieldState
  readonly enableSemanticSearch: SettingsFieldState
  readonly semanticModel: SettingsFieldState
  readonly semanticDownloadSource: SettingsFieldState
  readonly semanticModelDir: SettingsFieldState
  readonly semanticModelState: SemanticModelState
  /** True when the model endpoints did not answer; the section renders a note. */
  readonly semanticModelUnavailable: boolean
}

export interface EnrichmentCardFace extends SettingsFormActions {
  readonly hooks: {
    readonly enrichmentCard: SnapshotStore<EnrichmentCardState>
  }
  downloadModel(force?: boolean): Promise<void>
  cancelModelDownload(): Promise<void>
  verifyModel(): Promise<void>
  checkModelStatus(): Promise<void>
}

function modeFieldSpec(): SettingsFieldSpec {
  return {
    field: 'mode',
    format: (value) => (typeof value === 'string' ? value : ENRICHMENT_DEFAULTS.mode),
    parse: (text) =>
      (ENRICHMENT_MODE_CHOICES as readonly string[]).includes(text)
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
      return isEnrichmentOutputDirPath(trimmed) ? { kind: 'set', value: trimmed } : undefined
    },
  }
}

function semanticModelFieldSpec(): SettingsFieldSpec {
  return {
    field: 'semanticModel',
    format: (value) => (typeof value === 'string' ? value : ENRICHMENT_DEFAULTS.semanticModel),
    parse: (text) =>
      (SEMANTIC_MODEL_KEYS as readonly string[]).includes(text)
        ? { kind: 'set', value: text }
        : undefined,
  }
}

function semanticDownloadSourceFieldSpec(): SettingsFieldSpec {
  return {
    field: 'semanticDownloadSource',
    format: (value) =>
      typeof value === 'string' ? value : ENRICHMENT_DEFAULTS.semanticDownloadSource,
    parse: (text) =>
      (SEMANTIC_DOWNLOAD_SOURCES as readonly string[]).includes(text)
        ? { kind: 'set', value: text }
        : undefined,
  }
}

function semanticModelDirFieldSpec(): SettingsFieldSpec {
  return {
    field: 'semanticModelDir',
    format: (value) => (typeof value === 'string' ? value : ''),
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      return isEnrichmentOutputDirPath(trimmed) ? { kind: 'set', value: trimmed } : undefined
    },
  }
}

function fieldSpecs(): SettingsFieldSpec[] {
  return [
    modeFieldSpec(),
    credentialRefFieldSpec(ENRICHMENT_REFERENCE_FIELD),
    booleanFieldSpec('allowDocumentUpload'),
    outputDirFieldSpec(),
    booleanFieldSpec('enableSemanticSearch'),
    semanticModelFieldSpec(),
    semanticDownloadSourceFieldSpec(),
    semanticModelDirFieldSpec(),
  ]
}

export class EnrichmentFormController {
  private readonly model: SettingsFormModel<Record<string, unknown>>
  private readonly store: SnapshotStore<EnrichmentCardState>
  private readonly unsubscribe: () => void
  private credential: (EnrichmentCredentialInfo & { ref: string }) | undefined
  private credentialReadSequence = 0
  private credentialReadQueued = false
  private referenceKey = ''
  private disposed = false
  private modelState: SemanticModelState = {
    ready: false,
    downloading: false,
    path: '',
    downloadedBytes: 0,
    totalBytes: 0,
    percent: 0,
  }
  private modelUnavailable = false
  private modelStatusSequence = 0

  constructor(
    private readonly form: ConfigForm<Record<string, unknown>>,
    private readonly credentialsPort: EnrichmentCredentialPort,
    private readonly modelPort?: EnrichmentModelPort,
  ) {
    const scope = asFormScope(form)
    this.model = new SettingsFormModel(scope, fieldSpecs(), [
      { field: ENRICHMENT_SECRET_KEY, write: (text) => this.writeCredential(text) },
    ])
    this.store = this.model.bind(() => this.project())
    this.unsubscribe = form.subscribe(() => this.onFormPublished())
    this.onFormPublished()
  }

  private committedRef(): string {
    const value = this.form.getSnapshot().value
    const raw = value?.[ENRICHMENT_REFERENCE_FIELD]
    const trimmed = typeof raw === 'string' ? raw.trim() : ''
    return trimmed || ENRICHMENT_SUGGESTED_REF
  }

  private referenceState(): 'ready' | 'missing' | 'invalid' {
    const raw = this.committedRef()
    if (raw === '') return 'missing'
    return ENRICHMENT_CREDENTIAL_REFERENCE.test(raw) ? 'ready' : 'invalid'
  }

  private project(): EnrichmentCardState {
    const shell = this.model.shell()
    const ref = this.committedRef()
    const referenceState = this.referenceState()
    return {
      ...shell,
      mode: this.model.field('mode'),
      mineruTokenRef: this.model.field(ENRICHMENT_REFERENCE_FIELD),
      allowDocumentUpload: this.model.field('allowDocumentUpload'),
      outputDir: this.model.field('outputDir'),
      enableSemanticSearch: this.model.field('enableSemanticSearch'),
      semanticModel: this.model.field('semanticModel'),
      semanticDownloadSource: this.model.field('semanticDownloadSource'),
      semanticModelDir: this.model.field('semanticModelDir'),
      semanticModelState: this.modelState,
      semanticModelUnavailable: this.modelUnavailable,
      mineruToken: {
        text: this.model.field(ENRICHMENT_SECRET_KEY).text,
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

  inject(): EnrichmentCardFace {
    const actions = this.model.actions()
    return {
      hooks: { enrichmentCard: this.store },
      edit: (field, text) => {
        actions.edit(field, text)
        if (field === ENRICHMENT_REFERENCE_FIELD) actions.edit(ENRICHMENT_SECRET_KEY, '')
        if (field === 'semanticModel' || field === 'semanticModelDir') {
          void this.checkModelStatus()
        }
      },
      resetField: (field) => {
        actions.resetField(field)
        if (field === ENRICHMENT_REFERENCE_FIELD) actions.edit(ENRICHMENT_SECRET_KEY, '')
        if (field === 'semanticModel' || field === 'semanticModelDir') {
          void this.checkModelStatus()
        }
      },
      save: actions.save,
      discard: actions.discard,
      downloadModel: (force?: boolean) => this.downloadModel(force),
      cancelModelDownload: () => this.cancelModelDownload(),
      verifyModel: () => this.verifyModel(),
      checkModelStatus: () => this.checkModelStatus(),
    }
  }

  async checkModelStatus(): Promise<void> {
    if (this.disposed || this.modelPort === undefined) return
    const model = this.model.field('semanticModel').text || DEFAULT_SEMANTIC_MODEL
    // A staged but unknown spelling is a form-validation fact, not a wire
    // question: asking the host would render the component unavailable for
    // what is only a typo.
    if (!isSemanticModelKey(model)) return
    const modelDir = this.model.field('semanticModelDir').text
    const sequence = ++this.modelStatusSequence
    const res = await this.modelPort.semanticModelStatus({ model, modelDir })
    if (this.disposed || sequence !== this.modelStatusSequence) return
    if (!res.ok) {
      // A missing enrichment service (row off) is a fact the section renders,
      // not an error to swallow silently.
      this.modelUnavailable = true
      this.publish()
      return
    }
    this.modelUnavailable = false
    this.modelState = {
      ready: res.value.ready,
      downloading: res.value.downloading,
      path: res.value.path,
      downloadedBytes: res.value.downloadedBytes,
      totalBytes: res.value.totalBytes,
      percent: res.value.percent,
      currentFile: res.value.currentFile,
      error: res.value.error,
    }
    this.publish()
  }

  async downloadModel(force = false): Promise<void> {
    const port = this.modelPort
    if (this.disposed || port === undefined || this.modelUnavailable) return
    const model = this.model.field('semanticModel').text || DEFAULT_SEMANTIC_MODEL
    const source = this.model.field('semanticDownloadSource').text
    const modelDir = this.model.field('semanticModelDir').text
    this.modelState = {
      ...this.modelState,
      downloading: true,
      error: undefined,
    }
    this.publish()
    try {
      const res = await port.downloadSemanticModel({
        model,
        ...(source === '' ? {} : { source }),
        modelDir,
        ...(force ? { force: true } : {}),
      })
      if (!res.ok) {
        this.modelState = {
          ...this.modelState,
          downloading: false,
          error: res.error.message,
        }
        this.publish()
        return
      }
      await this.checkModelStatus()
    } catch (err) {
      this.modelState = {
        ...this.modelState,
        downloading: false,
        error: err instanceof Error ? err.message : String(err),
      }
      this.publish()
    }
  }

  async verifyModel(): Promise<void> {
    const port = this.modelPort
    if (this.disposed || port === undefined || this.modelUnavailable) return
    const model = this.model.field('semanticModel').text || DEFAULT_SEMANTIC_MODEL
    const modelDir = this.model.field('semanticModelDir').text
    const res = await port.verifySemanticModel({ model, modelDir })
    if (this.disposed || !res.ok) return
    this.modelState = {
      ready: res.value.ready,
      downloading: res.value.downloading,
      path: res.value.path,
      downloadedBytes: res.value.downloadedBytes,
      totalBytes: res.value.totalBytes,
      percent: res.value.percent,
      currentFile: res.value.currentFile,
      error: res.value.error,
    }
    this.publish()
  }

  async cancelModelDownload(): Promise<void> {
    const port = this.modelPort
    if (this.disposed || port === undefined || this.modelUnavailable) return
    const model = this.model.field('semanticModel').text || DEFAULT_SEMANTIC_MODEL
    const modelDir = this.model.field('semanticModelDir').text
    await port.cancelSemanticModelDownload({ model, modelDir })
    await this.checkModelStatus()
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
    if (ref === '' || !ENRICHMENT_CREDENTIAL_REFERENCE.test(ref)) {
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
    if (ref === '' || text.trim() === '' || !ENRICHMENT_CREDENTIAL_REFERENCE.test(ref)) return false
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
export const ENRICHMENT_SUGGESTED_REF = ENRICHMENT_CREDENTIAL_REFERENCE_NAMES.mineru
