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
import type { ZoteroAttachmentRowView } from '../../contract.ts'
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
  | 'mounted'
  | 'connected'
  | 'allowDocumentUpload'
  | 'mode'
  | 'revision'
  | 'maxFileBytes'
  | 'maxPages'
> & { readonly error?: string }

/** Kept separate from the five-member shared Zotero client face. */
export interface DocumentParseSurfacePort {
  readonly remote: DocumentParseRemote
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
  form: ConfigForm<Record<string, unknown>>,
): DocumentParseSurfacePort & { dispose(): void } {
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
      allowDocumentUpload: accepted.status === 'ready' && !error && preferences.allowDocumentUpload,
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
          return result
        } finally {
          admissions.delete(admission)
        }
      },
      documentArtifact: (request, signal) => ctx.remote.zotero.documentArtifact(request, signal),
      documentParseReceipt: (request, signal) =>
        ctx.remote.zotero.documentParseReceipt(request, signal),
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
  allowDocumentUpload: false,
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
  return {
    openAttachment,
    openUrl,
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
          onClose={() => setOpen(false)}
          t={t}
        />
      </>
    ),
  }
}
