/** User-submitted document parsing. Transport, permissions and jobs are host-owned. */
import type { IJobs, JobView } from '@deepseek-ai/dsh-api-job-controller/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { refFieldsOf } from '../../ref-grammar.ts'
import type {
  ZoteroDocumentArtifactRequestView,
  ZoteroDocumentArtifactResultView,
  ZoteroDocumentParseReceiptRequestView,
  ZoteroDocumentParseReceiptResultView,
  ZoteroParseTargetView,
  ZoteroStartDocumentParseRequestView,
  ZoteroStartDocumentParseResultView,
} from '../../contract.ts'

/** Only the public jobs service is accepted; the surface owns no stream or job engine. */
export type DocumentParseJobs = Pick<IJobs, 'state' | 'watchRows' | 'observe' | 'kill'>

export interface DocumentParseRemote {
  startDocumentParse(
    request: ZoteroStartDocumentParseRequestView,
  ): Promise<RemoteResult<ZoteroStartDocumentParseResultView>>
  documentArtifact(
    request: ZoteroDocumentArtifactRequestView,
    signal?: AbortSignal,
  ): Promise<RemoteResult<ZoteroDocumentArtifactResultView>>
  documentParseReceipt(
    request: ZoteroDocumentParseReceiptRequestView,
    signal?: AbortSignal,
  ): Promise<RemoteResult<ZoteroDocumentParseReceiptResultView>>
}

export interface ParseSnapshotSource<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** Accepted settings and live access decisions, never settings-form drafts. */
export interface DocumentParseCapabilities {
  readonly mounted: boolean
  readonly connected: boolean
  readonly sessionAllowed: boolean
  readonly readAllowed: boolean
  readonly startAllowed: boolean
  readonly cancelAllowed: boolean
  readonly mode: 'free' | 'pro'
  /** Changes when the committed configuration/service generation changes. */
  readonly revision: string
  readonly maxFileBytes: number
  readonly maxPages: number
}

export interface DocumentParseOperation {
  readonly operationId: string
  readonly generation?: string
  readonly jobId?: string
}

export interface DocumentParseSelection {
  readonly sessionId: string
  readonly target: ZoteroParseTargetView
  /** A display name only. Paths and URLs are removed before presentation. */
  readonly label?: string
  readonly operation?: DocumentParseOperation
}

export interface DocumentParseFailure {
  readonly code: string
  readonly message: string
  readonly details?: unknown
}

export type DocumentParseGate = 'ready' | 'not-available' | 'permission' | 'offline' | 'invalid'

export interface DocumentParseState {
  readonly open: boolean
  readonly target: ZoteroParseTargetView
  readonly targetLabel: string
  readonly valid: boolean
  readonly capabilities: DocumentParseCapabilities
  readonly gate: DocumentParseGate
  readonly artifact?: ZoteroDocumentArtifactResultView
  readonly checking: boolean
  readonly submitting: boolean
  readonly cancelling: boolean
  readonly cancelRequested: boolean
  readonly operation?: DocumentParseOperation
  readonly job?: JobView
  readonly observationError?: string
  readonly receipt?: ZoteroDocumentParseReceiptResultView
  readonly failure?: DocumentParseFailure
}

/** Pure typed unwrapping: preserve the RemoteError's code, details and identity. */
export function typedRemoteResult<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw result.error
  return result.value
}

/** Display labels never include signed paths, URL credentials or query strings. */
export function documentParseLabel(target: ZoteroParseTargetView, label?: string): string {
  if (target.kind === 'url') {
    try {
      const url = new URL(target.url)
      return url.protocol === 'https:' || url.protocol === 'http:' ? `${url.origin}/…` : ''
    } catch {
      return ''
    }
  }
  return documentParseText(label ?? '') || `Zotero PDF ${refFieldsOf(target.ref)?.key ?? ''}`.trim()
}

export function documentParseText(value: string): string {
  return value
    .replace(/(?:https?|file):\/\/[^\s<>"')\]]+/gi, '[URL]')
    .replace(
      /\b(?:bearer\s+|(?:token|api[_-]?key|authorization|password|secret)\s*[:=]\s*)[^\s,;]+/gi,
      '[credential]',
    )
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s<>"')\]]+/g, '[path]')
    .replace(/(^|[\s("'=])\/(?:[^\s/]+\/)*[^\s<>"')\]]*/g, '$1[path]')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 2048)
    .trim()
}

/** Draft validation performs no RPC, source request, DNS lookup or PDF download. */
export function validDocumentParseTarget(target: ZoteroParseTargetView): boolean {
  if (target.kind === 'attachment') {
    const ref = refFieldsOf(target.ref)
    if (!ref || ref.kind !== 'attachment') return false
    const id = Number(ref.libraryId)
    return Number.isSafeInteger(id) && (ref.libraryType === 'user' ? id === 0 : id > 0)
  }
  if (!target.url.trim() || target.url.length > 8192 || /[\u0000-\u0020\u007f]/.test(target.url))
    return false
  try {
    const url = new URL(target.url)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false
    if (url.port && url.port !== '80' && url.port !== '443') return false
    const host = url.hostname.toLowerCase().replace(/\.$/, '')
    if (
      !host.includes('.') ||
      host.includes(':') ||
      /(?:^|\.)(?:localhost|local|internal)$/.test(host)
    )
      return false
    if (/^\d+(?:\.\d+){3}$/.test(host)) {
      const [a, b] = host.split('.').map(Number)
      if (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        a >= 224 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 100 && b >= 64 && b <= 127)
      )
        return false
    }
    return true
  } catch {
    return false
  }
}

function failureOf(error: unknown): DocumentParseFailure {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
  )
    return error as DocumentParseFailure
  return {
    code: 'client/document-parse-failed',
    message: error instanceof Error ? error.message : String(error),
  }
}

function terminal(job: JobView | undefined): boolean {
  return job !== undefined && ['completed', 'failed', 'killed'].includes(job.status)
}

/** Progress is the jobs roster's projection; it is never inferred from a local timer. */
export function documentParseProgress(state: DocumentParseState): string | undefined {
  return state.job?.progress ? documentParseText(state.job.progress) : undefined
}

/**
 * A dialog observer, not a job owner. close/dispose release observations only.
 * Explicit submit and cancel are the only methods that start or kill work.
 */
export class DocumentParseController implements ParseSnapshotSource<DocumentParseState> {
  private selection: DocumentParseSelection = { sessionId: '', target: { kind: 'url', url: '' } }
  private readonly listeners = new Set<() => void>()
  private unsubscribeCapabilities?: () => void
  private state: DocumentParseState
  private epoch = 0
  private readSequence = 0
  private receiptSequence = 0
  private startSequence = 0
  private readAbort?: AbortController
  private receiptAbort?: AbortController
  private releaseRows?: () => void
  private releaseObservation?: () => void
  private unsubscribeJobs?: () => void
  private observedId?: string
  private terminalRead?: string
  private disposed = false

  constructor(
    private readonly remote: DocumentParseRemote,
    private readonly jobs: DocumentParseJobs | undefined,
    private readonly capabilities: ParseSnapshotSource<DocumentParseCapabilities>,
    private readonly onOperation?: (
      operation: DocumentParseOperation,
      selection: DocumentParseSelection,
    ) => void,
    private readonly onOperationIntent?: (
      operation: Pick<DocumentParseOperation, 'operationId'>,
      selection: DocumentParseSelection,
    ) => void,
  ) {
    const capability = capabilities.getSnapshot()
    this.state = {
      open: false,
      target: this.selection.target,
      targetLabel: '',
      valid: false,
      capabilities: capability,
      gate: 'invalid',
      checking: false,
      submitting: false,
      cancelling: false,
      cancelRequested: false,
    }
  }

  /** Subscribe only while mounted; safe under React's effect replay. */
  connect(): () => void {
    if (this.disposed) return () => {}
    this.unsubscribeCapabilities ??= this.capabilities.subscribe(() => this.onCapabilities())
    if (this.state.capabilities !== this.capabilities.getSnapshot()) this.onCapabilities()
    return () => {
      this.close()
      this.unsubscribeCapabilities?.()
      this.unsubscribeCapabilities = undefined
    }
  }

  getSnapshot = (): DocumentParseState => this.state
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  open(selection: DocumentParseSelection): void {
    if (this.disposed) return
    this.connect()
    const changed =
      selection.sessionId !== this.selection.sessionId ||
      JSON.stringify(selection.target) !== JSON.stringify(this.selection.target)
    if (changed) this.resetSelection(selection)
    else {
      this.selection = selection
      if (
        selection.operation &&
        selection.operation.operationId !== this.state.operation?.operationId
      ) {
        this.invalidate()
        this.patch({
          operation: selection.operation,
          job: undefined,
          receipt: undefined,
          failure: undefined,
        })
      }
    }
    this.patch({ open: true, targetLabel: documentParseLabel(selection.target, selection.label) })
    this.refreshGate()
    this.attachJobs()
    void this.refresh()
  }

  setTarget(target: ZoteroParseTargetView, label?: string): void {
    if (this.disposed || JSON.stringify(target) === JSON.stringify(this.selection.target)) return
    const open = this.state.open
    this.resetSelection({ sessionId: this.selection.sessionId, target, label })
    this.patch({ open })
    this.refreshGate()
    this.attachJobs()
    if (open) void this.refresh()
  }

  close(): void {
    if (this.disposed) return
    this.stopReads()
    this.detachJobs()
    this.patch({ open: false, checking: false })
  }

  dispose(): void {
    if (this.disposed) return
    this.close()
    this.disposed = true
    this.unsubscribeCapabilities?.()
    this.unsubscribeCapabilities = undefined
    this.listeners.clear()
  }

  /** Read-only reconnect/status action. It never replays startDocumentParse. */
  async refresh(): Promise<void> {
    if (!this.canRead()) return
    if (this.state.operation) await this.readReceipt()
    else await this.readArtifact()
  }

  async submit(action: ZoteroStartDocumentParseRequestView['action'] = 'parse'): Promise<void> {
    if (
      this.state.gate !== 'ready' ||
      !this.state.open ||
      this.state.submitting ||
      this.state.cancelling
    )
      return
    if (
      this.state.operation &&
      this.state.receipt?.kind !== 'completed' &&
      this.state.receipt?.kind !== 'failed' &&
      this.state.receipt?.kind !== 'cancelled'
    )
      return
    if (
      action === 'retry' &&
      (!this.state.operation ||
        (this.state.receipt?.kind !== 'failed' && this.state.receipt?.kind !== 'cancelled'))
    )
      return
    const operationId = action === 'retry' ? this.state.operation!.operationId : crypto.randomUUID()
    const request: ZoteroStartDocumentParseRequestView = {
      sessionId: this.selection.sessionId,
      target: this.selection.target,
      operationId,
      action,
    }
    const acceptedSelection = { ...this.selection, target: { ...this.selection.target } }
    const epoch = this.epoch
    const sequence = ++this.startSequence
    this.terminalRead = undefined
    this.stopReads()
    this.releaseObservation?.()
    this.releaseObservation = undefined
    this.observedId = undefined
    this.patch({
      operation: { operationId },
      submitting: true,
      cancelling: false,
      cancelRequested: false,
      job: undefined,
      receipt: undefined,
      failure: undefined,
      observationError: undefined,
      checking: false,
    })
    try {
      this.onOperationIntent?.({ operationId }, acceptedSelection)
      // Closing the modal must not cancel admission or the accepted host job.
      const result = typedRemoteResult(await this.remote.startDocumentParse(request))
      const operation: DocumentParseOperation = {
        operationId: result.operationId,
        generation: result.generation,
        jobId: result.jobId,
      }
      // Admission can outlive this view. Give the composition root the original
      // identity even after close, target change or unmount; never restart it.
      this.onOperation?.(operation, acceptedSelection)
      if (!this.current(epoch) || sequence !== this.startSequence) return
      this.patch({ operation, submitting: false })
      if (this.state.open) {
        this.attachJobs()
        await this.readReceipt()
      }
    } catch (error) {
      if (this.current(epoch) && sequence === this.startSequence)
        this.patchFailure(error, { submitting: false })
    }
  }

  async cancel(): Promise<void> {
    const { operation, capabilities, job } = this.state
    if (
      !this.state.open ||
      !this.jobs ||
      !operation?.jobId ||
      !capabilities.connected ||
      !capabilities.sessionAllowed ||
      !capabilities.cancelAllowed ||
      this.state.cancelling ||
      this.state.cancelRequested ||
      terminal(job)
    )
      return
    const epoch = this.epoch
    this.patch({ cancelling: true, failure: undefined })
    try {
      typedRemoteResult(
        await this.jobs.kill(this.sessionId(), operation.jobId as Parameters<IJobs['kill']>[1]),
      )
      if (this.current(epoch)) this.patch({ cancelling: false, cancelRequested: true })
      // The roster owns stopping/terminal state; a kill admission is not completion.
    } catch (error) {
      if (this.current(epoch)) this.patchFailure(error, { cancelling: false })
    }
  }

  private sessionId(): Parameters<IJobs['watchRows']>[0] {
    return this.selection.sessionId as Parameters<IJobs['watchRows']>[0]
  }

  private current(epoch: number): boolean {
    return !this.disposed && epoch === this.epoch
  }

  private resetSelection(selection: DocumentParseSelection): void {
    this.invalidate()
    this.selection = { ...selection, target: { ...selection.target } }
    this.patch({
      target: this.selection.target,
      targetLabel: documentParseLabel(selection.target, selection.label),
      valid: validDocumentParseTarget(selection.target),
      artifact: undefined,
      operation: selection.operation,
      receipt: undefined,
      job: undefined,
      failure: undefined,
      submitting: false,
      cancelling: false,
      cancelRequested: false,
      checking: false,
      observationError: undefined,
    })
  }

  private onCapabilities(): void {
    const previous = this.state.capabilities
    const next = this.capabilities.getSnapshot()
    const newGeneration = previous.mode !== next.mode || previous.revision !== next.revision
    this.invalidate()
    this.patch({
      capabilities: next,
      checking: false,
      submitting: false,
      cancelling: false,
      failure: undefined,
      job: undefined,
      observationError: undefined,
      ...(newGeneration
        ? { operation: undefined, artifact: undefined, receipt: undefined, cancelRequested: false }
        : {}),
    })
    this.refreshGate()
    this.attachJobs()
    if (this.state.open) void this.refresh()
  }

  private refreshGate(): void {
    const c = this.state.capabilities
    const gate: DocumentParseGate =
      !c.mounted || !this.jobs
        ? 'not-available'
        : !c.sessionAllowed || !c.startAllowed
          ? 'permission'
          : !c.connected
            ? 'offline'
            : !this.state.valid ||
                !this.selection.sessionId ||
                !(c.maxFileBytes > 0 && c.maxPages > 0)
              ? 'invalid'
              : 'ready'
    this.patch({ gate })
  }

  private canRead(): boolean {
    const c = this.state.capabilities
    return (
      !this.disposed &&
      this.state.open &&
      this.state.valid &&
      !!this.selection.sessionId &&
      c.mounted &&
      c.connected &&
      c.sessionAllowed &&
      c.readAllowed
    )
  }

  private async readArtifact(): Promise<void> {
    const epoch = this.epoch
    const sequence = ++this.readSequence
    this.readAbort?.abort()
    const abort = (this.readAbort = new AbortController())
    this.patch({ checking: true, failure: undefined })
    try {
      const artifact = typedRemoteResult(
        await this.remote.documentArtifact(
          { sessionId: this.selection.sessionId, op: 'inspect', target: this.selection.target },
          abort.signal,
        ),
      )
      if (this.current(epoch) && sequence === this.readSequence && this.state.open)
        this.patch({ artifact, checking: false })
    } catch (error) {
      if (this.current(epoch) && sequence === this.readSequence && this.state.open)
        this.patchFailure(error, { checking: false })
    }
  }

  private async readReceipt(): Promise<void> {
    const operation = this.state.operation
    if (!operation || !this.canRead()) return
    const epoch = this.epoch
    const sequence = ++this.receiptSequence
    this.receiptAbort?.abort()
    const abort = (this.receiptAbort = new AbortController())
    this.patch({ checking: true, failure: undefined })
    try {
      const receipt = typedRemoteResult(
        await this.remote.documentParseReceipt(
          { sessionId: this.selection.sessionId, operationId: operation.operationId },
          abort.signal,
        ),
      )
      if (!this.current(epoch) || sequence !== this.receiptSequence || !this.state.open) return
      this.patch({
        receipt,
        checking: false,
        ...(receipt.kind === 'pending'
          ? { operation: { ...operation, generation: receipt.generation, jobId: receipt.jobId } }
          : {}),
      })
      this.attachJobs()
    } catch (error) {
      if (this.current(epoch) && sequence === this.receiptSequence && this.state.open)
        this.patchFailure(error, { checking: false })
    }
  }

  private attachJobs(): void {
    if (!this.canRead() || !this.jobs) return
    if (!this.unsubscribeJobs) {
      this.unsubscribeJobs = this.jobs.state.subscribe(() => this.readJobs())
      this.releaseRows = this.jobs.watchRows(this.sessionId())
    }
    const id = this.state.operation?.jobId
    if (id && id !== this.observedId) {
      this.releaseObservation?.()
      this.observedId = id
      this.releaseObservation = this.jobs.observe(
        this.sessionId(),
        id as Parameters<IJobs['observe']>[1],
      )
    }
    this.readJobs()
  }

  private readJobs(): void {
    if (!this.canRead() || !this.jobs) return
    const operation = this.state.operation
    if (!operation?.jobId) return
    const snapshot = this.jobs.state.getSnapshot()
    const job = snapshot.rows[this.selection.sessionId]?.find(
      (row) => row.id === operation.jobId && row.owner === this.selection.sessionId,
    )
    this.patch({ job, observationError: snapshot.observed[operation.jobId]?.error })
    const key = job && `${job.id}:${job.status}`
    if (terminal(job) && key !== this.terminalRead) {
      this.terminalRead = key
      void this.readReceipt()
    }
  }

  private stopReads(): void {
    this.readSequence++
    this.receiptSequence++
    this.readAbort?.abort()
    this.receiptAbort?.abort()
  }

  private detachJobs(): void {
    const unsubscribe = this.unsubscribeJobs
    const observation = this.releaseObservation
    const rows = this.releaseRows
    this.unsubscribeJobs = this.releaseObservation = this.releaseRows = undefined
    this.observedId = undefined
    unsubscribe?.()
    observation?.()
    rows?.()
  }

  private invalidate(): void {
    this.epoch++
    this.stopReads()
    this.detachJobs()
    this.terminalRead = undefined
  }

  private patchFailure(error: unknown, patch: Partial<DocumentParseState>): void {
    const failure = failureOf(error)
    this.patch({
      ...patch,
      failure,
      ...(failure.code === 'gateway/service-unavailable'
        ? { gate: 'not-available' as const }
        : failure.code === 'remote-access/denied' ||
            failure.code === 'gateway/interactions-forbidden'
          ? { gate: 'permission' as const }
          : {}),
    })
  }

  private patch(patch: Partial<DocumentParseState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }
}
