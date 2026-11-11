/**
 * Durable store for parsed artifacts, plus the per-source index that lets a
 * cache hit be answered before the document is read or downloaded.
 *
 * One directory per content cache key under the resolved output root. A write
 * stages every file, then lands `meta.json` last as the commit marker: `get`
 * treats an artifact without a valid `meta.json` as a miss, so a half-written
 * directory is never served and a kill mid-write leaves no false hit. Each
 * file is written temp-then-rename, matching `ScholarlyTextStore`. A cached
 * artifact is pure local text — reading it opens no socket.
 *
 * The source index lives under `<root>/sources/<sourceKey>.json`; it records
 * which content artifact belonged to one `identity + mode` pair and the source
 * stamp at fetch time. `lookupSource` validates the stamp, reads the artifact,
 * and evicts the index when its artifact is gone. The index file name is a
 * SHA-256 digest, so no user text reaches the filesystem.
 * @module dsh-zotero/enrichment/artifact-store
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { FulltextSourceStamp } from '../local/fulltext-enhancer.js'
import { stampMatches } from './source-stamp.js'
import type { ParsedArtifact, ParsedArtifactMeta } from './types.js'

/** Host seams, injectable so unit tests never touch the real filesystem. */
export interface ArtifactStoreDeps {
  /** Create the directory and any missing parents. */
  readonly mkdir: (path: string) => Promise<void>
  readonly readFile: (path: string) => Promise<Uint8Array>
  readonly writeFile: (path: string, data: Uint8Array | string) => Promise<void>
  readonly rename: (from: string, to: string) => Promise<void>
  readonly rm: (path: string, options: { recursive: boolean; force: boolean }) => Promise<void>
}

const hostDeps: ArtifactStoreDeps = {
  mkdir: async (path) => {
    await mkdir(path, { recursive: true })
  },
  readFile,
  writeFile: async (path, data) => {
    await writeFile(path, data, { mode: 0o600 })
  },
  rename,
  rm,
}

const decoder = new TextDecoder('utf-8', { fatal: true })
const encoder = new TextEncoder()

/** One source-index entry: which content artifact and which source stamp. */
export interface SourceIndexRecord {
  readonly version: 1
  readonly cacheKey: string
  readonly fingerprint: string
  readonly stamp: FulltextSourceStamp
}

function metaOf(value: unknown): ParsedArtifactMeta | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const m = value as Partial<ParsedArtifactMeta>
  if (
    typeof m.identity !== 'string' ||
    (m.mode !== 'free' && m.mode !== 'pro') ||
    typeof m.contentFingerprint !== 'string' ||
    typeof m.taskId !== 'string' ||
    !Array.isArray(m.files)
  )
    return undefined
  return m as ParsedArtifactMeta
}

function stampOf(value: unknown): FulltextSourceStamp | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const stamp = value as Partial<FulltextSourceStamp> & Record<string, unknown>
  if (stamp.kind === 'file') {
    return typeof stamp.size === 'number' && typeof stamp.mtimeMs === 'number'
      ? { kind: 'file', size: stamp.size, mtimeMs: stamp.mtimeMs }
      : undefined
  }
  if (stamp.kind === 'bytes') {
    return typeof stamp.fingerprint === 'string'
      ? { kind: 'bytes', fingerprint: stamp.fingerprint }
      : undefined
  }
  if (stamp.kind === 'url') {
    if (typeof stamp.url !== 'string') return undefined
    return {
      kind: 'url',
      url: stamp.url,
      ...(typeof stamp.etag === 'string' ? { etag: stamp.etag } : {}),
      ...(typeof stamp.lastModified === 'string' ? { lastModified: stamp.lastModified } : {}),
      ...(typeof stamp.contentLength === 'number' ? { contentLength: stamp.contentLength } : {}),
    }
  }
  return undefined
}

function sourceRecordOf(value: unknown): SourceIndexRecord | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Partial<SourceIndexRecord>
  if (
    record.version !== 1 ||
    typeof record.cacheKey !== 'string' ||
    !/^[A-Za-z0-9_-]+$/.test(record.cacheKey) ||
    typeof record.fingerprint !== 'string'
  ) {
    return undefined
  }
  const stamp = stampOf(record.stamp)
  if (stamp === undefined) return undefined
  return {
    version: 1,
    cacheKey: record.cacheKey,
    fingerprint: record.fingerprint,
    stamp,
  }
}

/** Durable receipt: a failed poll/download resumes this task without another POST. */
const taskBase = z.object({
  taskId: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/),
  createdAt: z.number().finite().nonnegative(),
})
const taskReceipt = z.discriminatedUnion('uploaded', [
  taskBase.extend({ uploaded: z.literal(true) }),
  taskBase.extend({
    uploaded: z.literal(false),
    uploadUrl: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value)
        return url.protocol === 'https:' && !url.username && !url.password
      }),
  }),
])
export type ParseTaskRecord = z.infer<typeof taskReceipt>

export class ParsedArtifactStore {
  private rootEnsured: Promise<void> | undefined

  constructor(
    public readonly root: string,
    private readonly deps: ArtifactStoreDeps = hostDeps,
  ) {}

  /** Keep a task receipt across transient failures; only ENOENT is a miss. */
  async getTask(cacheKey: string): Promise<ParseTaskRecord | undefined> {
    let bytes: Uint8Array
    try {
      bytes = await this.deps.readFile(this.taskPath(cacheKey))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    const result = taskReceipt.safeParse(JSON.parse(decoder.decode(bytes)))
    if (!result.success) throw new Error('Invalid MinerU task receipt')
    return result.data
  }

  async putTask(cacheKey: string, task: ParseTaskRecord): Promise<void> {
    await this.deps.mkdir(join(this.root, 'tasks'))
    await this.atomicWrite(this.taskPath(cacheKey), JSON.stringify(task))
  }

  async deleteTask(cacheKey: string): Promise<void> {
    await this.deps.rm(this.taskPath(cacheKey), {
      recursive: false,
      force: true,
    })
  }

  private taskPath(cacheKey: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(cacheKey)) throw new Error('Invalid artifact task key')
    return join(this.root, 'tasks', `${cacheKey}.json`)
  }

  private ensureRoot(): Promise<void> {
    if (this.rootEnsured === undefined) {
      this.rootEnsured = this.deps.mkdir(this.root).catch((error) => {
        this.rootEnsured = undefined
        throw error
      })
    }
    return this.rootEnsured
  }

  private dir(cacheKey: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(cacheKey)) throw new Error('Invalid artifact cache key')
    return join(this.root, cacheKey)
  }

  private sourcesDir(): string {
    return join(this.root, 'sources')
  }

  private sourcePath(sourceKey: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(sourceKey)) throw new Error('Invalid artifact source key')
    return join(this.sourcesDir(), `${sourceKey}.json`)
  }

  private async atomicWrite(path: string, data: Uint8Array | string): Promise<void> {
    const temp = `${path}.tmp-${randomUUID()}`
    try {
      await this.deps.writeFile(temp, data)
      await this.deps.rename(temp, path)
    } finally {
      await this.deps.rm(temp, { recursive: false, force: true })
    }
  }

  /**
   * Missing or malformed artifacts are evicted. Filesystem failures propagate
   * so an unreadable cache cannot cause an unnecessary external submission.
   */
  async get(cacheKey: string): Promise<ParsedArtifact | undefined> {
    await this.ensureRoot()
    const dir = this.dir(cacheKey)
    const evict = async (): Promise<undefined> => {
      await this.deps.rm(dir, { recursive: true, force: true })
      return undefined
    }
    try {
      const metaBytes = await this.deps.readFile(join(dir, 'meta.json'))
      const meta = metaOf(JSON.parse(decoder.decode(metaBytes)))
      if (meta === undefined) return await evict()
      const markdown = decoder.decode(await this.deps.readFile(join(dir, 'full.md')))
      if (markdown.trim() === '') return await evict()
      let contentList: string | undefined
      if (meta.files.includes('content_list.json')) {
        contentList = decoder.decode(await this.deps.readFile(join(dir, 'content_list.json')))
        if (!Array.isArray(JSON.parse(contentList))) return await evict()
      }
      return {
        markdown,
        ...(contentList !== undefined ? { contentList } : {}),
        meta,
      }
    } catch (error) {
      if (
        !(error instanceof SyntaxError) &&
        !(error instanceof TypeError) &&
        (error as NodeJS.ErrnoException).code !== 'ENOENT'
      )
        throw error
      return await evict()
    }
  }

  /**
   * Write an artifact. `meta.json` is written last so it is the commit marker.
   */
  async put(cacheKey: string, artifact: ParsedArtifact): Promise<void> {
    await this.ensureRoot()
    const dir = this.dir(cacheKey)
    await this.deps.mkdir(dir)
    const files = ['full.md']
    await this.atomicWrite(join(dir, 'full.md'), encoder.encode(artifact.markdown))
    if (artifact.contentList !== undefined) {
      files.push('content_list.json')
      await this.atomicWrite(join(dir, 'content_list.json'), encoder.encode(artifact.contentList))
    }
    const meta: ParsedArtifactMeta = { ...artifact.meta, files }
    await this.atomicWrite(join(dir, 'meta.json'), encoder.encode(JSON.stringify(meta)))
  }

  /**
   * Record which content artifact belongs to one source identity and what the
   * source looked like. The write is atomic; a stale record is harmless because
   * `lookupSource` compares the stamp first.
   */
  async putSource(sourceKey: string, record: SourceIndexRecord): Promise<void> {
    await this.ensureRoot()
    await this.deps.mkdir(this.sourcesDir())
    await this.atomicWrite(this.sourcePath(sourceKey), encoder.encode(JSON.stringify(record)))
  }

  /**
   * Serve a stored artifact when the source still matches its stamp. A missing
   * or malformed index is a miss; an index whose artifact is gone is removed.
   */
  async lookupSource(
    sourceKey: string,
    stamp: FulltextSourceStamp,
  ): Promise<ParsedArtifact | undefined> {
    await this.ensureRoot()
    const path = this.sourcePath(sourceKey)
    let record: SourceIndexRecord
    try {
      const parsed = sourceRecordOf(JSON.parse(decoder.decode(await this.deps.readFile(path))))
      if (parsed === undefined) {
        await this.deps.rm(path, { recursive: false, force: true })
        return undefined
      }
      record = parsed
    } catch (error) {
      if (
        !(error instanceof SyntaxError) &&
        !(error instanceof TypeError) &&
        (error as NodeJS.ErrnoException).code !== 'ENOENT'
      )
        throw error
      await this.deps.rm(path, { recursive: false, force: true })
      return undefined
    }
    if (!stampMatches(record.stamp, stamp)) return undefined
    const artifact = await this.get(record.cacheKey)
    if (artifact === undefined || artifact.meta.contentFingerprint !== record.fingerprint) {
      await this.deps.rm(path, { recursive: false, force: true })
      return undefined
    }
    return artifact
  }
}
