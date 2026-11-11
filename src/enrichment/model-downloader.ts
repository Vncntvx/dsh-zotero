/**
 * The per-service manager for local embedding-model bundles: status, download,
 * cancel, verify, force re-download.
 *
 * One canonical `<model>|<directory>` owns a synchronous reservation covering
 * directory validation, the cross-process lock, streaming, publication and
 * cleanup. Concurrent `start` calls join that one writer; `cancel` aborts and
 * waits for the actual transfer release; `dispose` closes admission, aborts
 * every owned task and waits for them to settle. A committed publication wins
 * over a cancellation that lands during the final atomic marker rename.
 *
 * `status` and `verify` are read-only: they never create the model root, the
 * model directory or a draft directory. Readiness is one shared rule — the
 * commit marker must equal the catalog record and every pinned file must hash
 * to its pin on the same file-identity snapshot. A same-size corrupt file is
 * never "already-ready".
 * @module dsh-zotero/enrichment/model-downloader
 */

import { join } from 'node:path'
import { lstat } from 'node:fs/promises'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import {
  DEFAULT_SEMANTIC_DOWNLOAD_SOURCE,
  DEFAULT_SEMANTIC_MODEL,
  manifestOf,
  semanticModelOf,
  SEMANTIC_MODEL_KEYS,
  type SemanticDownloadSource,
  type SemanticModelEntry,
} from '../enrichment-model-catalog.js'
import {
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED,
  ZoteroError,
} from '../errors.js'
import { resolveSafeDirectory, type SafeDirectoryDeps } from './safe-directory.js'
import { createBundleInspector } from './model-bundle-inspector.js'
import type { BundleInspection } from './model-installation.js'
import {
  DEFAULT_SOURCE_ORDER,
  downloadPinnedFile,
  type DownloadClientDeps,
} from './model-download-client.js'
import { installModelBundle, type ModelInstallationFile } from './model-installation.js'

export interface SemanticModelStatus {
  readonly model: string
  readonly ready: boolean
  readonly downloading: boolean
  readonly path: string
  readonly downloadedBytes: number
  readonly totalBytes: number
  readonly percent: number
  readonly currentFile?: string
  readonly error?: string
}

export interface SemanticModelDownloadResult {
  readonly success: boolean
  readonly model: string
  readonly status: 'started' | 'already-ready' | 'downloading'
  readonly path: string
}

interface ActiveDownload {
  readonly key: string
  readonly controller: AbortController
  /** Settles only after the transfer, publication and cleanup are all done. */
  task: Promise<void>
  status: SemanticModelStatus
  /** Set once directory validation resolves the canonical target. */
  dir?: string
  /** Shared by every cancel/dispose caller for this reservation. */
  cancellation: Promise<void> | undefined
}

export interface ModelDownloadManagerDeps {
  /** Client seams for the streaming downloader; tests inject scripted ones. */
  readonly client?: DownloadClientDeps
  /** Filesystem seams for the safe-directory resolver; tests inject theirs. */
  readonly fs?: SafeDirectoryDeps
}

/** A reservation key needs no async work: the configured target and model. */
function reservationKeyOf(model: string, modelDir: string | undefined): string {
  return `${model}|${(modelDir ?? '').trim()}`
}

function keyOf(model: string, dir: string): string {
  return `${model}|${dir}`
}

function isKnownModel(model: string): boolean {
  return (SEMANTIC_MODEL_KEYS as readonly string[]).includes(model)
}

function knownModelList(): string {
  return SEMANTIC_MODEL_KEYS.join(', ')
}

function failed(reason: string): ZoteroError {
  return new ZoteroError(reason, ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A read-only status/verify path leaves a missing root absent. */
async function readOnlyDir(
  physicalKey: string,
  modelDir: string | undefined,
  fs: SafeDirectoryDeps | undefined,
): Promise<string> {
  const root = await resolveSafeDirectory({
    configured: modelDir ?? '',
    defaultRoot: dshHomePath('models'),
    create: false,
    readOnly: true,
    allowMissing: true,
    errorCode: ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED,
    label: 'semantic model directory',
    deps: fs,
  })
  return join(root, physicalKey)
}

/** A writer path validates the complete candidate, then creates it. */
async function writableRoot(
  modelDir: string | undefined,
  fs: SafeDirectoryDeps | undefined,
): Promise<string> {
  return await resolveSafeDirectory({
    configured: modelDir ?? '',
    defaultRoot: dshHomePath('models'),
    create: true,
    errorCode: ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED,
    label: 'semantic model directory',
    deps: fs,
  })
}

function statusOf(
  spec: SemanticModelEntry,
  dir: string,
  inspection: BundleInspection,
): SemanticModelStatus {
  const { totalBytes, presentBytes, verifiedBytes } = inspection
  const ready = inspection.kind === 'ready'
  const bytes = ready ? totalBytes : Math.max(presentBytes, verifiedBytes)
  return {
    model: spec.key,
    ready,
    downloading: false,
    path: dir,
    downloadedBytes: bytes,
    totalBytes,
    percent: ready ? 100 : totalBytes > 0 ? Math.round((bytes / totalBytes) * 100) : 0,
    ...(!ready && inspection.reason !== undefined ? { error: inspection.reason } : {}),
  }
}

export class ModelDownloadManager {
  private readonly entries = new Map<string, ActiveDownload>()
  private readonly clientDeps: DownloadClientDeps | undefined
  private readonly fsDeps: SafeDirectoryDeps | undefined
  private closed = false

  constructor(deps: ModelDownloadManagerDeps = {}) {
    this.clientDeps = deps.client
    this.fsDeps = deps.fs
  }

  /**
   * Report one model's state. A live task takes precedence, then the shared
   * read-only disk inspection. A stale error entry is dropped once the disk
   * looks ready, so an out-of-band install is reflected in the status.
   */
  async status(model: string, modelDir?: string): Promise<SemanticModelStatus> {
    const spec = semanticModelOf(model)
    const dir = await readOnlyDir(spec.physicalKey, modelDir, this.fsDeps)
    const live = [...this.entries.values()].find(
      (entry) => entry.key === reservationKeyOf(spec.key, modelDir) && entry.status.downloading,
    )
    if (live !== undefined) return { ...live.status }
    const disk = await this.inspect(spec, dir)
    const stale = this.entries.get(keyOf(spec.key, dir))
    if (stale !== undefined && stale.status.error !== undefined) {
      if (disk.kind === 'ready') {
        this.entries.delete(stale.key)
        return statusOf(spec, dir, disk)
      }
      return { ...stale.status }
    }
    return statusOf(spec, dir, disk)
  }

  /**
   * Start (or join) a download. The reservation is installed synchronously,
   * before the first asynchronous directory probe, so two concurrent starts
   * can never launch two writers and `dispose` covers a validation that is
   * still suspended. `force` re-downloads into a private staging directory and
   * replaces only catalog files, preserving user-owned extras.
   */
  async start(options: {
    readonly model?: string
    readonly source?: string
    readonly modelDir?: string
    readonly force?: boolean
  }): Promise<SemanticModelDownloadResult> {
    if (this.closed) throw failed('the model download manager is closed')
    if (options.model !== undefined && !isKnownModel(options.model)) {
      throw new ZoteroError(
        `unknown semantic model "${options.model}"; expected one of ${knownModelList()}`,
        ZOTERO_INVALID_ARGUMENT,
      )
    }
    if (
      options.source !== undefined &&
      options.source !== 'hf-mirror' &&
      options.source !== 'huggingface'
    ) {
      throw new ZoteroError(
        `unknown download source "${options.source}"; expected hf-mirror or huggingface`,
        ZOTERO_INVALID_ARGUMENT,
      )
    }
    const spec = semanticModelOf(options.model ?? DEFAULT_SEMANTIC_MODEL)
    const reservationKey = reservationKeyOf(spec.key, options.modelDir)
    const existing = this.entries.get(reservationKey)
    if (existing !== undefined) {
      return {
        success: true,
        model: spec.key,
        status: 'downloading',
        path: existing.dir ?? '',
      }
    }
    const source: SemanticDownloadSource =
      options.source === 'hf-mirror' || options.source === 'huggingface'
        ? options.source
        : DEFAULT_SEMANTIC_DOWNLOAD_SOURCE
    const sources = [source, ...DEFAULT_SOURCE_ORDER.filter((entry) => entry !== source)]
    const controller = new AbortController()
    const totalBytes = spec.files.reduce((sum, file) => sum + file.bytes, 0)
    let settle: () => void = () => undefined
    // Created synchronously with the reservation: cancel/dispose always join
    // this one promise, even while directory validation is still suspended.
    const settled = new Promise<void>((resolve) => {
      settle = resolve
    })
    const entry: ActiveDownload = {
      key: reservationKey,
      controller,
      task: settled,
      status: {
        model: spec.key,
        ready: false,
        downloading: true,
        path: '',
        downloadedBytes: 0,
        totalBytes,
        percent: 0,
        currentFile: spec.files[0]?.path,
      },
      cancellation: settled,
    }
    // Synchronous reservation: the entry exists before any await below.
    this.entries.set(reservationKey, entry)
    if (this.closed) {
      this.entries.delete(reservationKey)
      throw failed('the model download manager is closed')
    }

    return await this.admit(
      entry,
      spec,
      options.modelDir,
      sources,
      options.force === true,
      controller,
      settle,
    )
  }

  /** Abort the one active download, waiting for its real cleanup to settle. */
  async cancel(model: string, modelDir?: string): Promise<boolean> {
    const spec = semanticModelOf(model)
    // Directory failures stay explicit domain errors, matching the other
    // endpoints. The read-only resolver never creates a directory.
    await readOnlyDir(spec.physicalKey, modelDir, this.fsDeps)
    const entry = this.entries.get(reservationKeyOf(spec.key, modelDir))
    if (entry === undefined) return false
    if (entry.status.downloading) {
      entry.controller.abort(new Error('Download cancelled'))
      entry.status = { ...entry.status, downloading: false, error: 'Download cancelled' }
    }
    // Every caller joins the same cleanup, including a cancel that arrives
    // while an earlier cancellation is still draining the transfer.
    await entry.cancellation
    return true
  }

  /**
   * Hash every pinned file of one installed bundle. The expensive, definitive
   * check behind the "verify model" action.
   */
  async verify(model: string, modelDir?: string): Promise<SemanticModelStatus> {
    const spec = semanticModelOf(model)
    const dir = await readOnlyDir(spec.physicalKey, modelDir, this.fsDeps)
    return statusOf(spec, dir, await this.inspect(spec, dir, true))
  }

  /** Close admission, abort every owned task and wait for them to settle. */
  async dispose(): Promise<void> {
    this.closed = true
    const entries = [...this.entries.values()]
    for (const entry of entries) {
      if (entry.status.downloading) {
        entry.controller.abort(new Error('Download cancelled'))
        entry.status = { ...entry.status, downloading: false, error: 'Download cancelled' }
      }
    }
    await Promise.allSettled(entries.map((entry) => entry.cancellation))
    for (const entry of entries) {
      if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key)
    }
  }

  private async inspect(
    spec: SemanticModelEntry,
    dir: string,
    forceHash = false,
  ): Promise<BundleInspection> {
    const inspector = createBundleInspector()
    return await inspector.inspect(
      { dir, expected: manifestOf(spec) },
      forceHash ? { forceHash: true } : undefined,
    )
  }

  /** Resolve the canonical target, decide admission, and own the writer task. */
  private async admit(
    entry: ActiveDownload,
    spec: SemanticModelEntry,
    modelDir: string | undefined,
    sources: readonly SemanticDownloadSource[],
    force: boolean,
    controller: AbortController,
    settle: () => void,
  ): Promise<SemanticModelDownloadResult> {
    // `settle` resolves the reservation's single cancellation promise only
    // after the owned writer and its staging cleanup have actually settled.
    const finish = () => settle()

    const root = await writableRoot(modelDir, this.fsDeps).catch((error: unknown) => {
      this.fail(entry, error, controller)
      finish()
      throw error
    })
    const dir = join(root, spec.physicalKey)
    entry.dir = dir
    entry.status = { ...entry.status, path: dir }
    if (controller.signal.aborted) {
      const error = failed('the model download was cancelled before admission')
      this.fail(entry, error, controller)
      finish()
      throw error
    }
    // A physical model directory that is a symlink is refused before a writer
    // is admitted; the sentinel on the other side must remain untouched.
    const physical = await lstat(dir).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (physical !== undefined && (physical.isSymbolicLink() || !physical.isDirectory())) {
      const error = failed(`the model directory is not a regular directory: ${dir}`)
      this.fail(entry, error, controller)
      finish()
      throw error
    }
    const current = await this.inspect(spec, dir, true)
    if (current.kind === 'ready' && force !== true && !controller.signal.aborted) {
      entry.status = {
        ...entry.status,
        ready: true,
        downloading: false,
        downloadedBytes: entry.status.totalBytes,
        percent: 100,
      }
      this.entries.delete(entry.key)
      finish()
      return { success: true, model: spec.key, status: 'already-ready', path: dir }
    }
    if (controller.signal.aborted) {
      const error = failed('the model download was cancelled before admission')
      this.fail(entry, error, controller)
      finish()
      throw error
    }

    // Launch the owned writer. Its settlement resolves the shared cancellation
    // promise, so cancel/dispose can never return before real cleanup.
    void this.runInstall(entry, spec, dir, sources, force, controller).finally(finish)
    return { success: true, model: spec.key, status: 'started', path: dir }
  }

  private fail(entry: ActiveDownload, error: unknown, controller: AbortController): void {
    entry.status = {
      ...entry.status,
      ready: false,
      downloading: false,
      error: controller.signal.aborted ? 'Download cancelled' : messageOf(error),
    }
    if (this.entries.get(entry.key) === entry) this.entries.set(entry.key, entry)
  }

  private async runInstall(
    entry: ActiveDownload,
    spec: SemanticModelEntry,
    dir: string,
    sources: readonly SemanticDownloadSource[],
    force: boolean,
    controller: AbortController,
  ): Promise<void> {
    try {
      const result = await installModelBundle({
        dir,
        expected: manifestOf(spec),
        inspector: createBundleInspector(),
        force,
        signal: controller.signal,
        transfer: async (file: ModelInstallationFile, stagingDir: string, signal: AbortSignal) => {
          entry.status = {
            ...entry.status,
            downloading: true,
            currentFile: file.path,
          }
          await downloadPinnedFile({
            model: spec,
            file: { path: file.path, bytes: file.bytes, sha256: file.sha256 },
            dir: stagingDir,
            sources,
            signal,
            deps: this.clientDeps,
          })
        },
      })
      if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key)
      entry.status = {
        ...entry.status,
        ready: true,
        downloading: false,
        downloadedBytes: entry.status.totalBytes,
        percent: 100,
        ...(result.cleanupError !== undefined
          ? { error: `staging cleanup: ${messageOf(result.cleanupError)}` }
          : {}),
      }
    } catch (error) {
      this.fail(entry, error, controller)
    }
  }
}

export { ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED as MODEL_DOWNLOAD_FAILED_CODE }
