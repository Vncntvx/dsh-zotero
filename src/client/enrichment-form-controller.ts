/**
 * The staged form controller for the `enrichment` settings namespace
 * (`dsh-zotero/enrichment` row): the API mode, the MinerU token credential
 * reference and value, and the output directory.
 *
 * The mode switch is independent of the token: `mode` is its own staged field,
 * and the token reference/secret are separate fields. A user who configured a
 * token can still leave or return the mode to `free`, and the host reads the
 * token only in `pro` mode.
 *
 * The token value never enters settings. `mineruTokenRef` holds a credential
 * reference name; the value is written through `ctx.remote.credentials.set`
 * under the committed reference, exactly as the scholarly keys are.
 *
 * The model half is a small state machine. Every operation is bound to one
 * `{model, normalizedDir, generation}` observation target: an edit, reset,
 * discard, save, or external settings update bumps the generation so an
 * in-flight result for the old target can never publish. The only fact that
 * means "the component is absent" is the exact `gateway/service-unavailable`
 * code; every other failure keeps its own code/details and stays recoverable.
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
import type { NamespaceStatus } from './helpers/namespace-status.ts'
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
  ZoteroSemanticModelDeleteRequestView,
  ZoteroSemanticModelDeleteResultView,
  ZoteroSemanticModelVerifyRequestView,
} from '../contract.ts'
import { asFormScope } from './helpers/form-scope.ts'
import {
  isEnrichmentOutputDirPath,
  ENRICHMENT_MODE_CHOICES,
  ENRICHMENT_DEFAULTS,
} from '../enrichment-preferences.ts'
import {
  isSemanticModelKey,
  isSemanticDownloadSource,
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

/** Only this exact wire code means the enrichment component is not composed. */
export const COMPONENT_ABSENT_CODE = 'gateway/service-unavailable'

/** The client-side credential operations the form consumes. */
export interface EnrichmentCredentialPort {
  describe(
    refs: readonly string[],
  ): Promise<RemoteResult<Readonly<Record<string, EnrichmentCredentialInfo>>>>
  set(ref: string, value: string): Promise<RemoteResult<unknown>>
}

/**
 * The model port returns the full `RemoteResult`. Its error branch is the
 * Gateway's `RemoteError`: a stable `code`, typed `details`, and a diagnostic
 * `message`. The browser keeps all three, so a permission, carrier, offline,
 * directory, hash, or lock-contention failure shows its real reason instead of
 * collapsing into a blanket "component unavailable". No message-only adapter,
 * no legacy missing-method compat: a host without the component answers with
 * the exact `gateway/service-unavailable` carrier code. The optional signal is
 * a client-side observation carrier only: aborting it stops reading a stale
 * reply, never a host-owned download job.
 */
export interface EnrichmentModelPort {
  semanticModelStatus(
    request: ZoteroSemanticModelStatusRequestView,
    signal?: AbortSignal,
  ): Promise<RemoteResult<ZoteroSemanticModelStatusResultView>>
  downloadSemanticModel(
    request: ZoteroSemanticModelDownloadRequestView,
    signal?: AbortSignal,
  ): Promise<RemoteResult<ZoteroSemanticModelDownloadResultView>>
  cancelSemanticModelDownload(
    request: ZoteroSemanticModelCancelRequestView,
    signal?: AbortSignal,
  ): Promise<RemoteResult<ZoteroSemanticModelCancelResultView>>
  deleteSemanticModel(
    request: ZoteroSemanticModelDeleteRequestView,
    signal?: AbortSignal,
  ): Promise<RemoteResult<ZoteroSemanticModelDeleteResultView>>
  verifySemanticModel(
    request: ZoteroSemanticModelVerifyRequestView,
    signal?: AbortSignal,
  ): Promise<RemoteResult<ZoteroSemanticModelStatusResultView>>
}

/** A recoverable model failure, preserving the wire code and structured details. */
export interface SemanticModelFailure {
  readonly code: string
  readonly message: string
  readonly details?: unknown
}

/** A transient user-initiated operation; a status refresh must not clear it. */
export type SemanticModelPhase = 'idle' | 'checking' | 'cancelling' | 'deleting'

/** One valid, trimmed model-operation target parsed from the staged drafts. */
export interface SemanticModelTarget {
  readonly model: string
  readonly normalizedDir: string
  readonly source: string
}

/**
 * The single field parser: trim and validate every staged model draft at once.
 * An invalid draft (a typo, a half-typed directory, a relative path) is a
 * form-validation fact only — the caller sends no RPC, creates no directory,
 * and never marks the component unavailable.
 */
export function parseSemanticModelTarget(
  modelText: string,
  sourceText: string,
  dirText: string,
): SemanticModelTarget | undefined {
  const model = modelText.trim()
  const source = sourceText.trim()
  const normalizedDir = dirText.trim()
  if (!isSemanticModelKey(model)) return undefined
  if (!isSemanticDownloadSource(source)) return undefined
  if (normalizedDir !== '' && !isEnrichmentOutputDirPath(normalizedDir)) return undefined
  return { model, normalizedDir, source }
}

/** The wire status view minus its `model` field, which the form already knows. */
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

function blankModelState(): SemanticModelState {
  return {
    ready: false,
    downloading: false,
    path: '',
    downloadedBytes: 0,
    totalBytes: 0,
    percent: 0,
  }
}

/** Project any thrown value or RemoteError to the display failure shape. */
function failureOf(error: unknown): SemanticModelFailure {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    const typed = error as { code: string; message: string; details?: unknown }
    return { code: typed.code, message: typed.message, details: typed.details }
  }
  return {
    code: 'client/model-operation-failed',
    message: error instanceof Error ? error.message : String(error),
  }
}

interface EnrichmentSecretFieldState {
  readonly text: string
  readonly configured: boolean
  readonly disabled: boolean
  readonly referenceState: 'ready' | 'missing' | 'invalid'
}

/** Everything the enrichment configuration card renders. */
export interface EnrichmentCardState extends SettingsFormShell {
  /** Namespace lifecycle from the shared settings form; `available` is its boolean face. */
  readonly namespaceStatus: NamespaceStatus
  readonly mode: SettingsFieldState
  readonly mineruTokenRef: SettingsFieldState
  readonly outputDir: SettingsFieldState
  readonly mineruToken: EnrichmentSecretFieldState
  readonly enableSemanticSearch: SettingsFieldState
  readonly semanticModel: SettingsFieldState
  readonly semanticDownloadSource: SettingsFieldState
  readonly semanticModelDir: SettingsFieldState
  readonly semanticModelState: SemanticModelState
  /** True only when the exact `gateway/service-unavailable` code answered. */
  readonly semanticModelUnavailable: boolean
  /** A recoverable failure's real reason; undefined while unavailable. */
  readonly semanticModelFailure?: SemanticModelFailure
  /** A transient verify/cancel operation a status refresh must not overwrite. */
  readonly semanticModelPhase: SemanticModelPhase
}

export interface EnrichmentCardFace extends SettingsFormActions {
  readonly hooks: {
    readonly enrichmentCard: SnapshotStore<EnrichmentCardState>
  }
  downloadModel(force?: boolean): Promise<void>
  cancelModelDownload(): Promise<void>
  deleteModel(): Promise<void>
  verifyModel(): Promise<void>
  checkModelStatus(): Promise<void>
}

const MODEL_TARGET_FIELDS: readonly string[] = [
  'semanticModel',
  'semanticDownloadSource',
  'semanticModelDir',
]

/** One in-flight operation's identity: its target plus the accepting generation. */
interface ModelBinding {
  readonly model: string
  readonly normalizedDir: string
  readonly generation: number
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
  private committedSignature: string | undefined
  private disposed = false

  // Model state machine.
  private modelState: SemanticModelState = blankModelState()
  private modelUnavailable = false
  private modelFailure: SemanticModelFailure | undefined
  private semanticModelPhase: SemanticModelPhase = 'idle'
  private generation = 0
  private modelStatusSequence = 0
  private readonly signals = new Set<AbortController>()
  private refreshScheduled = false

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

  /** Signature of the *committed* target fields; staged drafts never change it. */
  private committedSignatureNow(): string {
    const value = this.form.getSnapshot().value
    const read = (key: string): string =>
      typeof value?.[key] === 'string' ? (value[key] as string) : ''
    return [read('semanticModel'), read('semanticModelDir'), read('semanticDownloadSource')].join(
      '\u0000',
    )
  }

  private parseTarget(): SemanticModelTarget | undefined {
    return parseSemanticModelTarget(
      this.model.field('semanticModel').text,
      this.model.field('semanticDownloadSource').text,
      this.model.field('semanticModelDir').text,
    )
  }

  private bind(target: SemanticModelTarget): ModelBinding {
    return {
      model: target.model,
      normalizedDir: target.normalizedDir,
      generation: this.generation,
    }
  }

  /** A late result may publish only for the still-current target and generation. */
  private current(binding: ModelBinding): boolean {
    if (this.disposed || binding.generation !== this.generation) return false
    const target = this.parseTarget()
    return (
      target !== undefined &&
      target.model === binding.model &&
      target.normalizedDir === binding.normalizedDir
    )
  }

  private acquireSignal(): AbortController {
    const controller = new AbortController()
    this.signals.add(controller)
    return controller
  }

  private releaseSignal(controller: AbortController): void {
    this.signals.delete(controller)
  }

  /** Invalidate stale observation only; never cancel a host-owned download job. */
  private invalidate(): void {
    this.generation++
    // Abort only the observation carriers: the host owns the actual download
    // task, so switching the UI drops our read, not another directory's job.
    for (const controller of this.signals) controller.abort()
    this.signals.clear()
    this.modelState = blankModelState()
    this.modelFailure = undefined
    this.semanticModelPhase = 'idle'
    // modelUnavailable is cleared only by a successful status check, so an
    // invalid draft cannot clear it.
  }

  /** Re-compare the target and immediately invalidate stale state. */
  private reconcileTarget(): void {
    if (this.disposed) return
    this.invalidate()
    this.publish()
    this.scheduleRefresh()
  }

  /** Coalesce rapid target changes into one serialized status refresh. */
  private scheduleRefresh(): void {
    if (this.refreshScheduled || this.disposed) return
    this.refreshScheduled = true
    queueMicrotask(() => {
      this.refreshScheduled = false
      if (this.disposed) return
      const target = this.parseTarget()
      if (target !== undefined) void this.runStatusCheck(target)
    })
  }

  private project(): EnrichmentCardState {
    const shell = this.model.shell()
    const ref = this.committedRef()
    const referenceState = this.referenceState()
    return {
      ...shell,
      namespaceStatus: this.form.getSnapshot().status,
      mode: this.model.field('mode'),
      mineruTokenRef: this.model.field(ENRICHMENT_REFERENCE_FIELD),
      outputDir: this.model.field('outputDir'),
      enableSemanticSearch: this.model.field('enableSemanticSearch'),
      semanticModel: this.model.field('semanticModel'),
      semanticDownloadSource: this.model.field('semanticDownloadSource'),
      semanticModelDir: this.model.field('semanticModelDir'),
      semanticModelState: this.modelState,
      semanticModelUnavailable: this.modelUnavailable,
      semanticModelFailure: this.modelFailure,
      semanticModelPhase: this.semanticModelPhase,
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
        if (MODEL_TARGET_FIELDS.includes(field)) this.reconcileTarget()
      },
      resetField: (field) => {
        actions.resetField(field)
        if (field === ENRICHMENT_REFERENCE_FIELD) actions.edit(ENRICHMENT_SECRET_KEY, '')
        if (MODEL_TARGET_FIELDS.includes(field)) this.reconcileTarget()
      },
      save: () => {
        const settled = actions.save()
        // A save acceptance re-compares the target on settlement; the form's
        // publish event also reconciles external/late updates via onFormPublished.
        void Promise.resolve(settled).then(() => this.reconcileTarget())
        return settled
      },
      discard: () => {
        actions.discard()
        this.reconcileTarget()
      },
      downloadModel: (force?: boolean) => this.downloadModel(force),
      cancelModelDownload: () => this.cancelModelDownload(),
      deleteModel: () => this.deleteModel(),
      verifyModel: () => this.verifyModel(),
      checkModelStatus: () => this.checkModelStatus(),
    }
  }

  /** The one-shot explicit check: mount, recovery, download/cancel follow-up. */
  async checkModelStatus(): Promise<void> {
    const target = this.parseTarget()
    if (target === undefined || this.modelPort === undefined || this.disposed) return
    await this.runStatusCheck(target)
  }

  private async runStatusCheck(target: SemanticModelTarget): Promise<void> {
    const port = this.modelPort
    if (port === undefined || this.disposed) return
    const binding = this.bind(target)
    const sequence = ++this.modelStatusSequence
    const controller = this.acquireSignal()
    let result: RemoteResult<ZoteroSemanticModelStatusResultView>
    try {
      result = await port.semanticModelStatus(
        { model: binding.model, modelDir: binding.normalizedDir },
        controller.signal,
      )
    } catch (error) {
      // A late exception checks disposed/generation before it can publish.
      if (this.current(binding) && sequence === this.modelStatusSequence) this.applyFailure(error)
      return
    } finally {
      this.releaseSignal(controller)
    }
    if (!this.current(binding) || sequence !== this.modelStatusSequence) return
    if (!result.ok) {
      this.applyFailure(result.error)
      return
    }
    this.applyStatus(result.value)
  }

  private operationFailure(binding: ModelBinding, error: unknown): void {
    if (this.current(binding)) this.applyFailure(error)
  }

  /** A status refresh never clears a transient verify/cancel phase. */
  private applyStatus(value: ZoteroSemanticModelStatusResultView): void {
    this.modelUnavailable = false
    this.modelFailure = undefined
    this.modelState = {
      ready: value.ready,
      downloading: value.downloading,
      path: value.path,
      downloadedBytes: value.downloadedBytes,
      totalBytes: value.totalBytes,
      percent: value.percent,
      currentFile: value.currentFile,
      error: value.error,
    }
    this.publish()
  }

  private applyFailure(error: unknown): void {
    const failure = failureOf(error)
    if (failure.code === COMPONENT_ABSENT_CODE) {
      this.modelUnavailable = true
      this.modelFailure = undefined
      this.modelState = blankModelState()
    } else {
      // Permission, carrier, offline, directory, hash and lock-contention
      // failures keep their real reason and stay recoverable: no gate closes.
      this.modelUnavailable = false
      this.modelFailure = failure
      this.modelState = { ...this.modelState, downloading: false, error: failure.message }
    }
    this.publish()
  }

  /**
   * Return the phase to idle, unless another operation owns it now.
   *
   * The phase is one field for every model operation, so a verify finishing
   * after a delete started used to clear `deleting` and re-enable the buttons
   * while the delete request was still open. Each operation clears only the
   * phase it set.
   * @param binding - the binding the finished operation ran against.
   * @param expected - the phase that operation set.
   */
  private clearPhase(binding: ModelBinding, expected: SemanticModelPhase): void {
    if (!this.current(binding)) return
    if (this.semanticModelPhase !== expected) return
    this.semanticModelPhase = 'idle'
    this.publish()
  }

  async downloadModel(force = false): Promise<void> {
    const port = this.modelPort
    if (port === undefined || this.disposed || this.modelUnavailable) return
    const target = this.parseTarget()
    if (target === undefined) return
    const binding = this.bind(target)
    this.modelFailure = undefined
    this.modelState = { ...this.modelState, downloading: true, error: undefined }
    this.publish()
    const controller = this.acquireSignal()
    let result: RemoteResult<ZoteroSemanticModelDownloadResultView>
    try {
      result = await port.downloadSemanticModel(
        {
          model: binding.model,
          ...(target.source === '' ? {} : { source: target.source }),
          modelDir: binding.normalizedDir,
          ...(force ? { force: true } : {}),
        },
        controller.signal,
      )
    } catch (error) {
      this.operationFailure(binding, error)
      return
    } finally {
      this.releaseSignal(controller)
    }
    if (!result.ok) {
      this.operationFailure(binding, result.error)
      return
    }
    if (!this.current(binding)) return
    await this.runStatusCheck(this.parseTarget() ?? target)
  }

  async verifyModel(): Promise<void> {
    const port = this.modelPort
    if (port === undefined || this.disposed || this.modelUnavailable) return
    const target = this.parseTarget()
    if (target === undefined) return
    const binding = this.bind(target)
    this.semanticModelPhase = 'checking'
    this.publish()
    const controller = this.acquireSignal()
    let result: RemoteResult<ZoteroSemanticModelStatusResultView>
    try {
      result = await port.verifySemanticModel(
        { model: binding.model, modelDir: binding.normalizedDir },
        controller.signal,
      )
    } catch (error) {
      this.operationFailure(binding, error)
      this.clearPhase(binding, 'checking')
      return
    } finally {
      this.releaseSignal(controller)
    }
    if (!result.ok) {
      this.operationFailure(binding, result.error)
      this.clearPhase(binding, 'checking')
      return
    }
    if (this.current(binding)) this.applyStatus(result.value)
    this.clearPhase(binding, 'checking')
  }

  async cancelModelDownload(): Promise<void> {
    const port = this.modelPort
    if (port === undefined || this.disposed || this.modelUnavailable) return
    const target = this.parseTarget()
    if (target === undefined) return
    const binding = this.bind(target)
    this.semanticModelPhase = 'cancelling'
    this.publish()
    const controller = this.acquireSignal()
    let result: RemoteResult<ZoteroSemanticModelCancelResultView>
    try {
      result = await port.cancelSemanticModelDownload(
        { model: binding.model, modelDir: binding.normalizedDir },
        controller.signal,
      )
    } catch (error) {
      this.operationFailure(binding, error)
      this.clearPhase(binding, 'cancelling')
      return
    } finally {
      this.releaseSignal(controller)
    }
    if (!result.ok) {
      this.operationFailure(binding, result.error)
      this.clearPhase(binding, 'cancelling')
      return
    }
    this.clearPhase(binding, 'cancelling')
    if (this.current(binding)) await this.runStatusCheck(this.parseTarget() ?? target)
  }

  async deleteModel(): Promise<void> {
    const port = this.modelPort
    if (port === undefined || this.disposed || this.modelUnavailable) return
    const target = this.parseTarget()
    if (target === undefined) return
    const binding = this.bind(target)
    this.modelFailure = undefined
    this.semanticModelPhase = 'deleting'
    this.publish()
    const controller = this.acquireSignal()
    let result: RemoteResult<ZoteroSemanticModelDeleteResultView>
    try {
      result = await port.deleteSemanticModel(
        { model: binding.model, modelDir: binding.normalizedDir },
        controller.signal,
      )
    } catch (error) {
      this.operationFailure(binding, error)
      this.clearPhase(binding, 'deleting')
      return
    } finally {
      this.releaseSignal(controller)
    }
    if (!result.ok) {
      this.operationFailure(binding, result.error)
      this.clearPhase(binding, 'deleting')
      return
    }
    this.clearPhase(binding, 'deleting')
    if (this.current(binding)) await this.runStatusCheck(this.parseTarget() ?? target)
  }

  /** Re-read the credential after the Host reports its reference changed. */
  refreshCredential(ref: string): void {
    if (!this.disposed && this.committedRef() === ref) this.queueCredentialRead()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const controller of this.signals) controller.abort()
    this.signals.clear()
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
    if (key !== this.referenceKey) {
      this.referenceKey = key
      this.queueCredentialRead()
    }
    const signature = this.committedSignatureNow()
    if (this.committedSignature === undefined) {
      // The constructor's first publish sets the baseline: no RPC, no invalidation.
      this.committedSignature = signature
      return
    }
    if (signature === this.committedSignature) return
    // An accepted save or an external settings update re-compares the target.
    this.committedSignature = signature
    this.reconcileTarget()
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
