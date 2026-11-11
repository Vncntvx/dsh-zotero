/**
 * The per-service manager for local embedding-model bundles: status, download,
 * cancel, verify, force re-download.
 *
 * State is instance-scoped and keyed by `<model>|<directory>`, so two service
 * instances never share a table and a custom directory gets its own entry.
 * Every download runs on its own `AbortController`; `dispose` aborts all of
 * them and waits for the tasks to settle, so unmounting the component never
 * leaves a transfer writing to disk. A failed entry is kept for one status
 * read — the user needs the error — and reconciled against the disk after
 * that, so a bundle installed out-of-band is seen as ready instead of
 * reporting a stale failure forever.
 *
 * `ready` means "manifest matches the catalog and every pinned file is at its
 * pinned size"; the digests themselves are checked by {@link verify} and,
 * more importantly, before every load (`semantic/bundle.ts`), so nothing
 * unverified ever reaches the encoder.
 * @module dsh-zotero/enrichment/model-downloader
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { rm, stat, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import {
  DEFAULT_SEMANTIC_DOWNLOAD_SOURCE,
  DEFAULT_SEMANTIC_MODEL,
  manifestOf,
  semanticModelBytes,
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
import {
  DEFAULT_SOURCE_ORDER,
  downloadPinnedFile,
  type DownloadClientDeps,
} from './model-download-client.js'

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
  task: Promise<void>
  status: SemanticModelStatus
}

export interface ModelDownloadManagerDeps {
  /** Client seams for the streaming downloader; tests inject scripted ones. */
  readonly client?: DownloadClientDeps
  /** Filesystem seams for the safe-directory resolver; tests inject theirs. */
  readonly fs?: SafeDirectoryDeps
}

function keyOf(model: string, dir: string): string {
  return `${model}|${dir}`
}

async function hashFile(path: string): Promise<{ bytes: number; sha256: string }> {
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of createReadStream(path)) {
    bytes += (chunk as Buffer).length
    hash.update(chunk as Buffer)
  }
  return { bytes, sha256: hash.digest('hex') }
}

function isKnownModel(model: string): boolean {
  return (SEMANTIC_MODEL_KEYS as readonly string[]).includes(model)
}

function knownModelList(): string {
  return SEMANTIC_MODEL_KEYS.join(', ')
}

export class ModelDownloadManager {
  private readonly entries = new Map<string, ActiveDownload>()
  private readonly clientDeps: DownloadClientDeps | undefined
  private readonly fsDeps: SafeDirectoryDeps | undefined

  constructor(deps: ModelDownloadManagerDeps = {}) {
    this.clientDeps = deps.client
    this.fsDeps = deps.fs
  }

  /**
   * Report one model's state: the live download or its error first, then the
   * disk. A stale error entry is dropped once the disk looks ready, so an
   * out-of-band install heals the view.
   * @param model - the catalog key.
   * @param modelDir - optional custom root; empty means `~/.dsh/models`.
   */
  async status(model: string, modelDir?: string): Promise<SemanticModelStatus> {
    const spec = semanticModelOf(model)
    const dir = await this.resolveDir(spec.physicalKey, modelDir)
    const key = keyOf(spec.key, dir)
    const active = this.entries.get(key)
    if (active !== undefined) {
      if (active.status.downloading) return { ...active.status }
      if (active.status.error !== undefined) {
        const disk = await this.diskStatus(spec, dir)
        if (disk.ready) {
          this.entries.delete(key)
          return disk
        }
        return { ...active.status }
      }
    }
    return await this.diskStatus(spec, dir)
  }

  /**
   * Start (or join) a download. `force` removes an existing bundle first, so
   * "redownload" really replaces the bytes instead of answering
   * `already-ready`.
   */
  async start(options: {
    readonly model?: string
    readonly source?: string
    readonly modelDir?: string
    readonly force?: boolean
  }): Promise<SemanticModelDownloadResult> {
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
    const dir = await this.resolveDir(spec.physicalKey, options.modelDir)
    const key = keyOf(spec.key, dir)
    const active = this.entries.get(key)
    if (active?.status.downloading === true) {
      return { success: true, model: spec.key, status: 'downloading', path: dir }
    }
    if (options.force === true) {
      // The directory was validated by `resolveDir` and contains nothing but
      // this model's pinned files and its manifest.
      await rm(dir, { recursive: true, force: true })
    }
    const initial = await this.diskStatus(spec, dir)
    if (initial.ready) {
      return { success: true, model: spec.key, status: 'already-ready', path: dir }
    }

    const controller = new AbortController()
    const source: SemanticDownloadSource =
      options.source === 'hf-mirror' || options.source === 'huggingface'
        ? options.source
        : DEFAULT_SEMANTIC_DOWNLOAD_SOURCE
    const sources = [source, ...DEFAULT_SOURCE_ORDER.filter((entry) => entry !== source)]
    const totalBytes = semanticModelBytes(spec)
    const entry: ActiveDownload = {
      key,
      controller,
      task: Promise.resolve(),
      status: {
        model: spec.key,
        ready: false,
        downloading: true,
        path: dir,
        downloadedBytes: initial.downloadedBytes,
        totalBytes,
        percent: initial.percent,
        currentFile: spec.files[0]?.path,
      },
    }
    this.entries.set(key, entry)
    entry.task = this.runDownload(entry, spec, dir, sources, totalBytes)
    return { success: true, model: spec.key, status: 'started', path: dir }
  }

  /** Abort the one active download for this model+directory, if any. */
  async cancel(model: string, modelDir?: string): Promise<boolean> {
    const spec = semanticModelOf(model)
    const dir = await this.resolveDir(spec.physicalKey, modelDir)
    const entry = this.entries.get(keyOf(spec.key, dir))
    if (entry === undefined || !entry.status.downloading) return false
    entry.controller.abort()
    entry.status = { ...entry.status, downloading: false, error: 'Download cancelled' }
    this.entries.delete(entry.key)
    return true
  }

  /**
   * Hash every pinned file of one installed bundle. The expensive, definitive
   * check behind the "verify model" action and before any load.
   */
  async verify(model: string, modelDir?: string): Promise<SemanticModelStatus> {
    const spec = semanticModelOf(model)
    const dir = await this.resolveDir(spec.physicalKey, modelDir)
    const totalBytes = semanticModelBytes(spec)
    let downloadedBytes = 0
    for (const file of spec.files) {
      const local = await hashFile(join(dir, file.path)).catch(() => undefined)
      if (local === undefined || local.bytes !== file.bytes || local.sha256 !== file.sha256) {
        return {
          model: spec.key,
          ready: false,
          downloading: false,
          path: dir,
          downloadedBytes,
          totalBytes,
          percent: Math.round((downloadedBytes / totalBytes) * 100),
          error: `${file.path} failed verification`,
        }
      }
      downloadedBytes += file.bytes
    }
    return {
      model: spec.key,
      ready: true,
      downloading: false,
      path: dir,
      downloadedBytes,
      totalBytes,
      percent: 100,
    }
  }

  /** Abort every download this manager owns and wait for them to settle. */
  async dispose(): Promise<void> {
    const entries = [...this.entries.values()]
    this.entries.clear()
    for (const entry of entries) {
      if (entry.status.downloading) {
        entry.controller.abort()
        entry.status = { ...entry.status, downloading: false, error: 'Download cancelled' }
      }
    }
    await Promise.allSettled(entries.map((entry) => entry.task))
  }

  private async resolveDir(physicalKey: string, modelDir: string | undefined): Promise<string> {
    const root = await resolveSafeDirectory({
      configured: modelDir ?? '',
      defaultRoot: dshHomePath('models'),
      create: true,
      errorCode: ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED,
      label: 'semantic model directory',
      deps: this.fsDeps,
    })
    return join(root, physicalKey)
  }

  private async diskStatus(spec: SemanticModelEntry, dir: string): Promise<SemanticModelStatus> {
    const totalBytes = semanticModelBytes(spec)
    let downloadedBytes = 0
    let ready = true
    for (const file of spec.files) {
      const size = await stat(join(dir, file.path))
        .then((info) => info.size)
        .catch(() => undefined)
      if (size === file.bytes) downloadedBytes += file.bytes
      else ready = false
    }
    return {
      model: spec.key,
      ready,
      downloading: false,
      path: dir,
      downloadedBytes,
      totalBytes,
      percent: ready ? 100 : totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0,
    }
  }

  private async runDownload(
    entry: ActiveDownload,
    spec: SemanticModelEntry,
    dir: string,
    sources: readonly SemanticDownloadSource[],
    totalBytes: number,
  ): Promise<void> {
    try {
      let cumulative = 0
      for (const file of spec.files) {
        if (entry.controller.signal.aborted) return
        entry.status = {
          ...entry.status,
          currentFile: file.path,
          downloadedBytes: cumulative,
          percent: Math.min(99, Math.round((cumulative / totalBytes) * 100)),
        }
        const existing = await hashFile(join(dir, file.path)).catch(() => undefined)
        if (
          existing !== undefined &&
          existing.bytes === file.bytes &&
          existing.sha256 === file.sha256
        ) {
          cumulative += file.bytes
          continue
        }
        const result = await downloadPinnedFile({
          model: spec,
          file,
          dir,
          sources,
          signal: entry.controller.signal,
          deps: this.clientDeps,
        })
        cumulative += result.bytes
        entry.status = {
          ...entry.status,
          downloadedBytes: cumulative,
          percent: Math.min(99, Math.round((cumulative / totalBytes) * 100)),
        }
      }
      if (entry.controller.signal.aborted) return
      // The manifest is written last and atomically: it is the commit marker
      // both the status check and the loader compare against the catalog.
      const manifestPath = join(dir, 'manifest.json')
      const manifestTmp = `${manifestPath}.tmp`
      await writeFile(manifestTmp, JSON.stringify(manifestOf(spec), null, 2), 'utf8')
      await rename(manifestTmp, manifestPath)
      entry.status = {
        model: spec.key,
        ready: true,
        downloading: false,
        path: dir,
        downloadedBytes: totalBytes,
        totalBytes,
        percent: 100,
      }
      this.entries.delete(entry.key)
    } catch (error) {
      if (entry.controller.signal.aborted) return
      entry.status = {
        ...entry.status,
        downloading: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

export { ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED as MODEL_DOWNLOAD_FAILED_CODE }
