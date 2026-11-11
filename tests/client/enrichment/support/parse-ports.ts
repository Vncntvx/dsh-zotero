/** Controlled public ports; production controller and jobs selectors stay real. */
import type { IJobs, JobsSnapshot, JobView } from '@deepseek-ai/dsh-api-job-controller/client'
import { vi } from 'vitest'
import {
  DocumentParseController,
  type DocumentParseCapabilities,
  type DocumentParseJobs,
  type DocumentParseRemote,
  type DocumentParseSelection,
  type ParseSnapshotSource,
} from '../../../../src/client/enrichment/parse-controller.ts'
import type { ZoteroParseReceiptView } from '../../../../src/contract.ts'
import { attachmentRef } from '../../../helpers/server/keys.ts'
import { progress } from '../../../helpers/sync.ts'

export const PARSE_SESSION = 'parse-session' as Parameters<IJobs['watchRows']>[0]
export const PARSE_JOB = 'zotero-parse-1234' as Parameters<IJobs['observe']>[1]
export const PARSE_OPERATION = '5323777a-e478-4e91-96af-e36276abe7e0'
export const PARSE_SELECTION: DocumentParseSelection = {
  sessionId: PARSE_SESSION,
  target: { kind: 'attachment', ref: attachmentRef() },
  label: 'Selected PDF',
}

export function observable<T>(
  initial: T,
): ParseSnapshotSource<T> & { publish(value: T): void; listenerCount(): number } {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    publish: (value) => {
      snapshot = value
      for (const listener of listeners) listener()
    },
    listenerCount: () => listeners.size,
  }
}

export function parseCapabilities(
  overrides: Partial<DocumentParseCapabilities> = {},
): DocumentParseCapabilities {
  return {
    mounted: true,
    connected: true,
    sessionAllowed: true,
    readAllowed: true,
    startAllowed: true,
    cancelAllowed: true,
    allowDocumentUpload: true,
    mode: 'free',
    revision: 'service-1',
    maxFileBytes: 10 * 1024 * 1024,
    maxPages: 20,
    ...overrides,
  }
}

export function parseJob(overrides: Partial<JobView> = {}): JobView {
  return {
    id: PARSE_JOB,
    owner: PARSE_SESSION,
    kind: 'zotero-parse',
    label: 'Parse selected PDF',
    status: 'running',
    startedAt: 1,
    progress: 'Uploading',
    output: { total: 0, earliest: 0 },
    ...overrides,
  }
}

export function parseReceipt(
  overrides: Partial<ZoteroParseReceiptView> = {},
): ZoteroParseReceiptView {
  return {
    operationId: PARSE_OPERATION,
    generation: 'generation-1',
    sourceId: 'source-1',
    targetLabel: 'Selected PDF',
    mode: 'free',
    cached: false,
    artifactId: 'artifact-1',
    fingerprint: 'sha256-1',
    format: 'markdown',
    characterCount: 9,
    preview: '# Preview',
    ...overrides,
  }
}

export function parseRemote(overrides: Partial<DocumentParseRemote> = {}) {
  return {
    startDocumentParse: vi.fn<DocumentParseRemote['startDocumentParse']>(
      overrides.startDocumentParse ??
        (async (request) => ({
          ok: true,
          value: {
            operationId: request.operationId,
            generation: 'generation-1',
            jobId: PARSE_JOB,
            status: 'started',
          },
        })),
    ),
    documentArtifact: vi.fn<DocumentParseRemote['documentArtifact']>(
      overrides.documentArtifact ?? (async () => ({ ok: true, value: { kind: 'missing' } })),
    ),
    documentParseReceipt: vi.fn<DocumentParseRemote['documentParseReceipt']>(
      overrides.documentParseReceipt ??
        (async () => ({
          ok: true,
          value: { kind: 'pending', jobId: PARSE_JOB, generation: 'generation-1' },
        })),
    ),
  } satisfies DocumentParseRemote
}

/** A boundary publisher, not a copy of the job controller's streaming implementation. */
export function parseJobs() {
  const state = observable<JobsSnapshot>({ rows: {}, observed: {} })
  const stopRows = vi.fn()
  const stopObservation = vi.fn()
  const jobs = {
    state,
    watchRows: vi.fn<DocumentParseJobs['watchRows']>(() => stopRows),
    observe: vi.fn<DocumentParseJobs['observe']>(() => stopObservation),
    kill: vi.fn<DocumentParseJobs['kill']>(async () => ({
      ok: true,
      value: { outcome: 'requested' },
    })),
  } satisfies DocumentParseJobs
  return { jobs, state, stopRows, stopObservation }
}

export function parseHarness(
  options: {
    remote?: DocumentParseRemote
    capabilities?: Partial<DocumentParseCapabilities>
    onOperation?: ConstructorParameters<typeof DocumentParseController>[3]
    onOperationIntent?: ConstructorParameters<typeof DocumentParseController>[4]
  } = {},
) {
  const remote = options.remote ?? parseRemote()
  const capability = observable(parseCapabilities(options.capabilities))
  const boundary = parseJobs()
  const controller = new DocumentParseController(
    remote,
    boundary.jobs,
    capability,
    options.onOperation,
    options.onOperationIntent,
  )
  const sync = progress()
  controller.subscribe(sync.notify)
  return {
    controller,
    remote,
    capability,
    ...boundary,
    settled: () =>
      sync.when(() => !controller.getSnapshot().checking && !controller.getSnapshot().submitting),
    dispose: () => controller.dispose(),
  }
}
