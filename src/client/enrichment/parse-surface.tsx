/** Session-bound UI composition for explicit document parsing. */
import { useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { IJobs } from '@deepseek-ai/dsh-api-job-controller/client'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  ENRICHMENT_DEFAULTS,
  ENRICHMENT_DOCUMENT_LIMITS,
  enrichmentPreferencesOf,
} from '../../enrichment-preferences.ts'
import { ENRICHMENT_SETTINGS_NAMESPACE } from '../../settings-namespace.ts'
import { refFieldsOf } from '../../ref-grammar.ts'
import type {
  ZoteroAttachmentRowView,
  ZoteroParseTargetView,
  ZoteroListParsedDocumentsRequestView,
  ZoteroListParsedDocumentsResultView,
  ZoteroDiscardParsedDocumentRequestView,
  ZoteroDiscardParsedDocumentResultView,
} from '../../contract.ts'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { ParseDocumentDialog } from './ParseDocumentDialog.tsx'
import type {
  DocumentParseCapabilities,
  DocumentParseJobs,
  DocumentParseRemote,
  DocumentParseOperation,
  DocumentParseSelection,
  ParseSnapshotSource,
} from './parse-controller.ts'

export interface DocumentParseClientContext {
  readonly remote: { readonly zotero: DocumentParseRemote }
  readonly configForms: Pick<Context['configForms'], 'whileServed'>
  readonly jobs: IJobs
  readonly connection: Pick<ConnectionHandle, 'state'>
}

export type DocumentParseDeployment = Pick<
  DocumentParseCapabilities,
  'mounted' | 'connected' | 'mode' | 'revision' | 'maxFileBytes' | 'maxPages'
> & { readonly error?: string }

/** The management endpoints are separate from the parse dialog's transport. */
export interface ParsedDocumentManagementRemote {
  listParsedDocuments(
    request: ZoteroListParsedDocumentsRequestView,
    signal?: AbortSignal,
  ): Promise<RemoteResult<ZoteroListParsedDocumentsResultView>>
  discardParsedDocument(
    request: ZoteroDiscardParsedDocumentRequestView,
    signal?: AbortSignal,
  ): Promise<RemoteResult<ZoteroDiscardParsedDocumentResultView>>
}

/** Kept separate from the five-member shared Zotero client face. */
export interface DocumentParseSurfacePort {
  readonly remote: DocumentParseRemote
  /**
   * The management endpoints are separate from the parse dialog's transport.
   * Availability is decided by the consumer's access gates and the manager
   * tab's `whileServed` registration, never by presence here.
   */
  readonly management: ParsedDocumentManagementRemote
  readonly jobs: DocumentParseJobs
  readonly deployment: ParseSnapshotSource<DocumentParseDeployment>
  readonly recall: (selection: DocumentParseSelection) => DocumentParseOperation | undefined
  readonly recentUrl: (sessionId: string) => DocumentParseSelection | undefined
  readonly clearSession: (sessionId: string) => void
}

/**
 * Read accepted settings and the existing connection source. whileServed owns
 * component presence; no probe, polling, model tool, or document request runs here.
 */
export function createDocumentParseSurface(
  ctx: DocumentParseClientContext,
  options: {
    readonly form: ConfigForm<Record<string, unknown>>
    /** Fires once per committed parse, for panels that show committed state. */
    readonly onCommitted?: (sessionId: string, target: ZoteroParseTargetView) => void
    readonly management: ParsedDocumentManagementRemote
  },
): DocumentParseSurfacePort & { dispose(): void } {
  const { form, onCommitted, management } = options
  const listeners = new Set<() => void>()
  // At most 64 recent operations live in memory; document URLs never enter storage.
  const operations = new Map<
    string,
    {
      sequence: number
      revision: string
      operation: DocumentParseOperation
      selection: DocumentParseSelection
    }
  >()
  const admissions = new Set<{ sessionId: string; valid: boolean }>()
  const keyOf = (selection: Pick<DocumentParseSelection, 'sessionId' | 'target'>) =>
    JSON.stringify([selection.sessionId, selection.target])
  const committed = new Set<string>()
  const notifyCommitted = (sessionId: string, operationId: string, generation: string) => {
    const key = JSON.stringify([sessionId, operationId, generation])
    if (committed.has(key) || disposed) return
    const entry = [...operations.values()].find(
      (value) =>
        value.selection.sessionId === sessionId && value.operation.operationId === operationId,
    )
    if (entry === undefined) return
    committed.add(key)
    if (committed.size > 128) committed.delete(committed.values().next().value!)
    onCommitted?.(sessionId, entry.selection.target)
  }
  let sequence = 0
  let disposed = false
  let mounted = false
  let generation = 0
  let snapshot: DocumentParseDeployment
  const update = () => {
    const accepted = form.getSnapshot()
    let preferences = ENRICHMENT_DEFAULTS
    let error: string | undefined
    try {
      if (accepted.status === 'ready') preferences = enrichmentPreferencesOf(accepted.value ?? {})
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
    const limits = ENRICHMENT_DOCUMENT_LIMITS[preferences.mode]
    snapshot = {
      mounted,
      connected: ctx.connection.state.getSnapshot() === 'connected',
      mode: preferences.mode,
      revision: `${generation}:${accepted.revision ?? 'pending'}`,
      maxFileBytes: accepted.status === 'ready' && !error ? limits.maxBytes : 0,
      maxPages: accepted.status === 'ready' && !error ? limits.maxPages : 0,
      ...(error ? { error } : {}),
    }
    for (const listener of listeners) listener()
  }
  update()
  const disposers = [
    form.subscribe(update),
    ctx.connection.state.subscribe(update),
    ctx.configForms.whileServed([ENRICHMENT_SETTINGS_NAMESPACE], () => {
      mounted = true
      generation++
      update()
      return () => {
        mounted = false
        generation++
        update()
      }
    }),
  ]
  return {
    management,
    remote: {
      startDocumentParse: async (request) => {
        const key = keyOf(request)
        const issued = ++sequence
        const revision = snapshot.revision
        operations.delete(key)
        operations.set(key, {
          sequence: issued,
          revision,
          selection: { sessionId: request.sessionId, target: { ...request.target } },
          operation: { operationId: request.operationId },
        })
        if (operations.size > 64) operations.delete(operations.keys().next().value!)
        const admission = { sessionId: request.sessionId, valid: true }
        admissions.add(admission)
        try {
          const result = await ctx.remote.zotero.startDocumentParse(request)
          if (
            result.ok &&
            !disposed &&
            admission.valid &&
            issued === operations.get(key)?.sequence &&
            revision === snapshot.revision
          ) {
            operations.delete(key)
            operations.set(key, {
              sequence: issued,
              revision,
              selection: { sessionId: request.sessionId, target: { ...request.target } },
              operation: {
                operationId: result.value.operationId,
                generation: result.value.generation,
                jobId: result.value.jobId,
              },
            })
            if (operations.size > 64) operations.delete(operations.keys().next().value!)
          }
          if (result.ok && result.value.receipt)
            notifyCommitted(request.sessionId, result.value.operationId, result.value.generation)
          return result
        } finally {
          admissions.delete(admission)
        }
      },
      documentArtifact: (request, signal) => ctx.remote.zotero.documentArtifact(request, signal),
      documentParseReceipt: async (request, signal) => {
        const result = await ctx.remote.zotero.documentParseReceipt(request, signal)
        if (result.ok && result.value.kind === 'completed')
          notifyCommitted(request.sessionId, request.operationId, result.value.receipt.generation)
        return result
      },
    },
    jobs: ctx.jobs,
    recall: (selection) => {
      const entry = operations.get(keyOf(selection))
      return entry?.revision === snapshot.revision ? entry.operation : undefined
    },
    recentUrl: (sessionId) => {
      const entry = [...operations.values()]
        .filter(
          (entry) =>
            entry.revision === snapshot.revision &&
            entry.selection.sessionId === sessionId &&
            entry.selection.target.kind === 'url',
        )
        .sort((a, b) => b.sequence - a.sequence)[0]
      return entry && { ...entry.selection, operation: entry.operation }
    },
    clearSession: (sessionId) => {
      for (const [key, entry] of operations)
        if (entry.selection.sessionId === sessionId) operations.delete(key)
      for (const admission of admissions)
        if (admission.sessionId === sessionId) admission.valid = false
    },
    deployment: {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
    dispose: () => {
      disposed = true
      operations.clear()
      committed.clear()
      for (const dispose of disposers.reverse()) dispose()
      listeners.clear()
    },
  }
}

export interface DocumentParseSessionAccess extends Pick<
  DocumentParseCapabilities,
  'sessionAllowed' | 'readAllowed' | 'startAllowed' | 'cancelAllowed'
> {
  readonly sessionId: string
}

const ABSENT_DEPLOYMENT: DocumentParseDeployment = {
  mounted: false,
  connected: false,
  mode: 'free',
  revision: 'absent',
  maxFileBytes: 0,
  maxPages: 0,
}
const ABSENT_SOURCE: ParseSnapshotSource<DocumentParseDeployment> = {
  getSnapshot: () => ABSENT_DEPLOYMENT,
  subscribe: () => () => {},
}

/** A bounded observable bridge from the session's standard access hooks. */
function capabilitySource(initial: DocumentParseCapabilities) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    update: (next: DocumentParseCapabilities) => {
      if (
        (Object.keys(next) as (keyof DocumentParseCapabilities)[]).every(
          (key) => next[key] === snapshot[key],
        )
      )
        return
      snapshot = next
      for (const listener of listeners) listener()
    },
  }
}

/** Child listings may carry item refs; the parse contract requires an attachment ref. */
function attachmentParseRef(ref: string): string | undefined {
  const fields = refFieldsOf(ref)
  if (!fields || !['attachment', 'item'].includes(fields.kind)) return undefined
  return fields.kind === 'attachment' ? ref : ref.replace('/item/', '/attachment/')
}

/** One dialog occurrence, anchored to the panel's session even when that session is idle. */
export function useDocumentParseSurface(
  port: DocumentParseSurfacePort | undefined,
  access: DocumentParseSessionAccess,
  t: TranslateNS<'zotero'>,
) {
  const deployment = useSyncExternalStore(
    (port?.deployment ?? ABSENT_SOURCE).subscribe,
    (port?.deployment ?? ABSENT_SOURCE).getSnapshot,
  )
  const { sessionId, sessionAllowed, readAllowed, startAllowed, cancelAllowed } = access
  const next: DocumentParseCapabilities = {
    ...deployment,
    sessionAllowed,
    readAllowed,
    startAllowed,
    cancelAllowed,
  }
  const capabilities = useMemo(() => capabilitySource(next), [port, sessionId])
  useLayoutEffect(
    () => capabilities.update(next),
    [capabilities, deployment, sessionAllowed, readAllowed, startAllowed, cancelAllowed],
  )
  useLayoutEffect(() => {
    if (!sessionAllowed) port?.clearSession(sessionId)
  }, [port, sessionId, sessionAllowed])
  const [selection, setSelection] = useState<DocumentParseSelection>()
  const [open, setOpen] = useState(false)
  // A finished parse changes which artifact exists; the inspector's derived
  // rows re-probe on this counter instead of polling.
  const [revision, setRevision] = useState(0)
  const select = (selection: DocumentParseSelection) => {
    setSelection({ ...selection, operation: port?.recall(selection) })
    setOpen(true)
  }
  const openAttachment = port
    ? (attachment: ZoteroAttachmentRowView) => {
        const ref = attachmentParseRef(attachment.ref)
        if (!ref || !sessionAllowed) return
        select({ sessionId, target: { kind: 'attachment', ref }, label: attachment.title })
      }
    : undefined
  const openUrl = port
    ? () => {
        if (!sessionAllowed) return
        select(port.recentUrl(sessionId) ?? { sessionId, target: { kind: 'url', url: '' } })
      }
    : undefined
  const openArtifact = port
    ? (artifactId: string, label: string) => {
        if (!sessionAllowed) return
        select({ sessionId, target: { kind: 'artifact', artifactId }, label })
      }
    : undefined
  return {
    openAttachment,
    openUrl,
    openArtifact,
    revision,
    mounted: deployment.mounted,
    dialog: port && selection && (
      <>
        {deployment.error && (
          <p role="alert">{t('libraryParseConfigError', { message: deployment.error })}</p>
        )}
        <ParseDocumentDialog
          key={sessionId}
          open={open && selection.sessionId === sessionId && sessionAllowed}
          selection={selection}
          remote={port.remote}
          jobs={port.jobs}
          capabilities={capabilities}
          onClose={() => {
            setOpen(false)
            // Closing the dialog is the one point where a newly committed
            // artifact becomes visible in the inspector behind it.
            setRevision((previous) => previous + 1)
          }}
          t={t}
        />
      </>
    ),
  }
}
