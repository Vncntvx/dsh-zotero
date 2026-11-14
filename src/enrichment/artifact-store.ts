import type { NormalizedContentList } from './zip.js'
/** Durable v2 artifacts and an atomically published, mode-independent source index. */
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { z } from 'zod'
import {
  artifactMetaSchema,
  SHA256,
  SOURCE_INDEX_MAX_BYTES,
  sourceIndexSchema,
  sourceRecordSchema,
  type SourceIndexRecord,
} from './artifact-schema.js'
import { stampMatches } from './source-stamp.js'
import { extractMarkdownTitleOf } from '../parsed-title.js'
import type { ZoteroArtifactImageMediaType } from '../contract.js'
import type { FulltextSourceStamp, ParsedArtifact } from './types.js'

export type { SourceIndexRecord } from './artifact-schema.js'

/** External filesystem and cross-process lock ports. */
export interface ArtifactStoreDeps {
  readonly mkdir: (path: string) => Promise<void>
  readonly readFile: (path: string) => Promise<Uint8Array>
  readonly writeFile: (path: string, data: Uint8Array | string) => Promise<void>
  readonly rename: (from: string, to: string) => Promise<void>
  readonly rm: (path: string, options: { recursive: boolean; force: boolean }) => Promise<void>
  readonly readArtifactFile?: (path: string, maxBytes: number) => Promise<Uint8Array>
  readonly readSourceIndex?: (path: string, maxBytes: number) => Promise<Uint8Array>
  readonly withSourceLock?: typeof withFileLock
  /** Directory enumeration for orphan recovery; host-only ports when omitted. */
  readonly readdir?: (path: string) => Promise<readonly string[]>
  readonly stat?: (path: string) => Promise<{ readonly mtimeMs: number }>
  readonly realpath?: (path: string) => Promise<string>
}

/** The on-disk state of one parsed artifact, independent of its source-index pointer. */
export interface StoredArtifactMeta {
  readonly meta: z.infer<typeof artifactMetaSchema>
  readonly committedAt: number
}

/** One inventory row: an artifact's cached meta, or the fact that it is unreadable. */
export interface InventoryEntry {
  readonly cacheKey: string
  readonly stored?: StoredArtifactMeta
  /**
   * meta.json exists but could not be read or parsed. The raw message stays
   * host-side: it is sanitized at the wire boundary, never cached to disk.
   */
  readonly failureMessage?: string
}

/** The source-index view of one artifact: its record and every alias key. */
export interface ArtifactGroup {
  readonly record?: SourceIndexRecord
  readonly aliases: readonly string[]
}

/** Inspect the source directory and lock before using the public file lock. */
async function requireRegular(path: string, directory = false): Promise<void> {
  const info = await lstat(path)
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) {
    throw new Error('The parsed source index path is not a regular filesystem entry')
  }
}
async function sourceDirectory(path: string): Promise<void> {
  await requireRegular(dirname(path), true)
}
const hostSourceLock: typeof withFileLock = async (path, operation, options) => {
  await sourceDirectory(path)
  try {
    await requireRegular(`${path}.lock`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  let entered = false
  try {
    return await withFileLock(
      path,
      async () => {
        await sourceDirectory(path)
        await requireRegular(`${path}.lock`)
        entered = true
        return await operation()
      },
      options,
    )
  } catch (error) {
    if (!entered) options?.signal?.throwIfAborted()
    throw error
  }
}

/** Bound allocation and streaming reads even if the index grows after stat. */
async function readIndexFile(path: string, maxBytes: number): Promise<Uint8Array> {
  await sourceDirectory(path)
  await requireRegular(path)
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > maxBytes)
      throw new Error('The parsed source index is too large or is not a file')
    const buffer = Buffer.alloc(Math.min(maxBytes + 1, info.size + 1))
    let length = 0
    for (;;) {
      if (length === buffer.byteLength)
        throw new Error('The parsed source index changed size while reading')
      const { bytesRead } = await file.read(buffer, length, buffer.byteLength - length, null)
      if (bytesRead === 0) return buffer.subarray(0, length)
      length += bytesRead
      if (length > maxBytes) throw new Error('The parsed source index is too large')
    }
  } finally {
    await file.close()
  }
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
  readSourceIndex: readIndexFile,
  readArtifactFile: readIndexFile,
  withSourceLock: hostSourceLock,
  // Directory enumeration, mtime and realpath fall through to node:fs when
  // the deps omit them; the injected ports exist for the in-memory fixtures.
}
const decoder = new TextDecoder('utf-8', { fatal: true })
const encoder = new TextEncoder()

const taskBase = z.object({
  taskId: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/),
  createdAt: z.number().finite().nonnegative(),
})
const taskReceipt = z.discriminatedUnion('uploaded', [
  taskBase.extend({ uploaded: z.literal(true) }).strict(),
  taskBase
    .extend({
      uploaded: z.literal(false),
      uploadUrl: z
        .string()
        .url()
        .refine((value) => {
          const url = new URL(value)
          return url.protocol === 'https:' && !url.username && !url.password
        }),
    })
    .strict(),
])
export type ParseTaskRecord = z.infer<typeof taskReceipt>

export class ParsedArtifactStore {
  private rootEnsured: Promise<void> | undefined
  /** Every attempted write advances this; per-generation read caches invalidate on it. */
  private writes = 0
  private inventoryCache:
    { readonly generation: number; readonly entries: readonly InventoryEntry[] } | undefined

  constructor(
    public readonly root: string,
    private readonly deps: ArtifactStoreDeps = hostDeps,
  ) {}

  /**
   * Any attempted write invalidates the read caches, whether or not it
   * succeeds: a failed atomic write may still have mutated the target, so
   * every write method opens with this. A new store write path must do the
   * same or the inventory cache goes stale (see DN-4). The source index
   * itself is deliberately read per call — its I/O failures must surface,
   * never hide behind a cache.
   */
  private touch(): void {
    this.writes++
    this.inventoryCache = undefined
  }

  private ensureRoot(): Promise<void> {
    this.rootEnsured ??= this.deps.mkdir(this.root).catch((error) => {
      this.rootEnsured = undefined
      throw error
    })
    return this.rootEnsured
  }

  private dir(cacheKey: string): string {
    return join(this.root, SHA256.parse(cacheKey))
  }

  private taskPath(cacheKey: string): string {
    return join(this.root, 'tasks', `${SHA256.parse(cacheKey)}.json`)
  }

  private indexPath(): string {
    return join(this.root, 'sources', 'index.json')
  }

  private async atomicWrite(
    path: string,
    data: Uint8Array | string,
    signal?: AbortSignal,
  ): Promise<void> {
    const temp = `${path}.tmp-${randomUUID()}`
    try {
      await this.deps.writeFile(temp, data)
      signal?.throwIfAborted()
      await this.deps.rename(temp, path)
    } finally {
      await this.deps.rm(temp, { recursive: false, force: true })
    }
  }

  async getTask(cacheKey: string): Promise<ParseTaskRecord | undefined> {
    let bytes: Uint8Array
    try {
      bytes = await this.deps.readFile(this.taskPath(cacheKey))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    return taskReceipt.parse(JSON.parse(decoder.decode(bytes)))
  }

  async putTask(cacheKey: string, task: ParseTaskRecord): Promise<void> {
    const record = taskReceipt.parse(task)
    this.touch()
    await this.deps.mkdir(join(this.root, 'tasks'))
    await this.atomicWrite(this.taskPath(cacheKey), JSON.stringify(record))
  }

  async deleteTask(cacheKey: string): Promise<void> {
    this.touch()
    await this.deps.rm(this.taskPath(cacheKey), { recursive: false, force: true })
  }

  /** Reads never create directories, acquire locks, evict, or repair corrupt data. */
  async get(cacheKey: string): Promise<ParsedArtifact | undefined> {
    const dir = this.dir(cacheKey)
    try {
      const meta = artifactMetaSchema.parse(
        JSON.parse(decoder.decode(await this.deps.readFile(join(dir, 'meta.json')))),
      )
      const markdown = decoder.decode(await this.deps.readFile(join(dir, 'full.md')))
      if (markdown.trim() === '') throw new Error('The stored parsed artifact is invalid')
      let contentList: string | undefined
      if (meta.files.length === 2) {
        contentList = decoder.decode(await this.deps.readFile(join(dir, 'content_list.json')))
        if (!Array.isArray(JSON.parse(contentList)))
          throw new Error('The stored parsed content list is invalid')
      }
      const { characterCount: _characterCount, markdownBytes: _markdownBytes, ...domainMeta } = meta
      return { markdown, ...(contentList !== undefined ? { contentList } : {}), meta: domainMeta }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  /** Validate before I/O; meta.json is the artifact's final commit marker. */
  async put(cacheKey: string, artifact: ParsedArtifact): Promise<void> {
    if (artifact.contentList !== undefined && !Array.isArray(JSON.parse(artifact.contentList)))
      throw new Error('The parsed content list is invalid')
    await this.persist(cacheKey, artifact)
  }

  /** Only the archive normalizer produces this semantic content-list type. */
  async putNormalized(
    cacheKey: string,
    artifact: ParsedArtifact & { readonly contentList?: NormalizedContentList },
  ): Promise<void> {
    await this.persist(cacheKey, artifact)
  }

  private async persist(cacheKey: string, artifact: ParsedArtifact): Promise<void> {
    this.touch()
    const markdownBytes = encoder.encode(artifact.markdown)
    const meta = artifactMetaSchema.parse({
      ...artifact.meta,
      // meta.json is the commit marker; every committed artifact carries the
      // Markdown H1 so a tab chip can name the paper without opening it.
      title: artifact.meta.title ?? extractMarkdownTitleOf(artifact.markdown),
      characterCount: artifact.markdown.length,
      markdownBytes: markdownBytes.byteLength,
    })
    if (artifact.markdown.trim() === '') throw new Error('The parsed Markdown is empty')
    if ((artifact.contentList !== undefined) !== (meta.files.length === 2))
      throw new Error('The parsed artifact file list does not match its payload')
    const images = artifact.images ?? []
    if (images.length !== (meta.images?.length ?? 0))
      throw new Error('The parsed artifact image list does not match its payload')
    images.forEach((image, index) => {
      const declared = meta.images?.[index]
      if (declared === undefined || declared.name !== image.name)
        throw new Error('The parsed artifact image list does not match its payload')
      if (declared.bytes !== image.data.byteLength)
        throw new Error('The parsed artifact image size does not match its metadata')
    })
    const dir = this.dir(cacheKey)
    await this.ensureRoot()
    await this.deps.mkdir(dir)
    await this.atomicWrite(join(dir, 'full.md'), markdownBytes)
    if (artifact.contentList !== undefined)
      await this.atomicWrite(join(dir, 'content_list.json'), encoder.encode(artifact.contentList))
    if (images.length > 0) {
      // `images/<file>`, exactly the reference the Markdown carries; the name
      // was validated against the meta schema before this write.
      await this.deps.mkdir(join(dir, 'images'))
      for (const image of images) await this.atomicWrite(join(dir, image.name), image.data)
    }
    await this.atomicWrite(join(dir, 'meta.json'), encoder.encode(JSON.stringify(meta)))
  }

  /** Read metadata against the already validated source-index pointer. */
  async metadataFor(
    record: SourceIndexRecord,
  ): Promise<z.infer<typeof artifactMetaSchema> | undefined> {
    const candidate = sourceRecordSchema.parse(record)
    let meta: z.infer<typeof artifactMetaSchema>
    try {
      const bytes = await this.readBounded(
        join(this.dir(candidate.cacheKey), 'meta.json'),
        256 * 1024,
      )
      meta = artifactMetaSchema.parse(JSON.parse(decoder.decode(bytes)))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    if (
      meta.contentFingerprint !== candidate.fingerprint ||
      meta.generation !== candidate.generation ||
      meta.parser !== candidate.parser ||
      meta.format !== candidate.format
    )
      throw new Error('The parsed artifact does not match its source index')
    return meta
  }

  private async readBounded(path: string, maxBytes: number): Promise<Uint8Array> {
    const bytes = await (this.deps.readArtifactFile?.(path, maxBytes) ?? this.deps.readFile(path))
    if (bytes.byteLength > maxBytes)
      throw new Error('The parsed artifact file exceeds its size ceiling')
    return bytes
  }

  async readMarkdown(cacheKey: string, characterCount: number, byteCount: number): Promise<string> {
    const bytes = await this.readBounded(join(this.dir(cacheKey), 'full.md'), byteCount)
    const text = decoder.decode(bytes)
    if (bytes.byteLength !== byteCount || text.trim() === '' || text.length !== characterCount)
      throw new Error('The stored parsed Markdown does not match its metadata')
    return text
  }

  /** The caller supplies metadata captured by its source-bound read snapshot. */
  async readImage(
    cacheKey: string,
    name: string,
    captured?: z.infer<typeof artifactMetaSchema>,
  ): Promise<
    { readonly data: Uint8Array; readonly mediaType: ZoteroArtifactImageMediaType } | undefined
  > {
    let meta = captured
    if (meta === undefined) {
      try {
        meta = artifactMetaSchema.parse(
          JSON.parse(
            decoder.decode(
              await this.readBounded(join(this.dir(cacheKey), 'meta.json'), 256 * 1024),
            ),
          ),
        )
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
    }
    const declared = meta.images?.find((image) => image.name === name)
    if (declared === undefined) return undefined
    let data: Uint8Array
    try {
      data = await this.readBounded(join(this.dir(cacheKey), declared.name), declared.bytes)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    if (data.byteLength !== declared.bytes)
      throw new Error('The stored parsed image does not match its metadata')
    return { data, mediaType: declared.mediaType }
  }

  private async sourceSnapshot(): Promise<z.infer<typeof sourceIndexSchema>> {
    let bytes: Uint8Array
    try {
      bytes =
        this.deps.readSourceIndex !== undefined
          ? await this.deps.readSourceIndex(this.indexPath(), SOURCE_INDEX_MAX_BYTES)
          : await this.deps.readFile(this.indexPath())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 2, sources: {} }
      throw error
    }
    if (bytes.byteLength > SOURCE_INDEX_MAX_BYTES)
      throw new Error('The parsed source index is too large')
    return sourceIndexSchema.parse(JSON.parse(decoder.decode(bytes)))
  }

  /** The whole validated index; management lists from this rather than per-target probes. */
  async snapshot(): Promise<z.infer<typeof sourceIndexSchema>> {
    return await this.sourceSnapshot()
  }

  /** Read a committed artifact's meta without an index record; undefined when absent. */
  async metaFor(cacheKey: string): Promise<StoredArtifactMeta | undefined> {
    const path = join(this.dir(cacheKey), 'meta.json')
    try {
      const meta = artifactMetaSchema.parse(
        JSON.parse(decoder.decode(await this.deps.readFile(path))),
      )
      const info = this.deps.stat
        ? await this.deps.stat(path)
        : { mtimeMs: (await stat(path)).mtimeMs }
      return { meta, committedAt: info.mtimeMs }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  /** Directory names are cache keys; a symlink or unexpected root is refused. */
  async listArtifactDirectories(): Promise<readonly string[]> {
    let entries: readonly string[]
    try {
      entries = this.deps.readdir ? await this.deps.readdir(this.root) : await readdir(this.root)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const result: string[] = []
    for (const entry of entries) {
      if (!SHA256.safeParse(entry).success) continue
      const path = join(this.root, entry)
      if (this.deps.readdir !== undefined) {
        // An injected directory port owns its own safety checks; the in-memory
        // fixture has no real directory entries to lstat.
        result.push(entry)
        continue
      }
      const info = await lstat(path)
      if (info.isSymbolicLink() || !info.isDirectory()) continue
      const real = this.deps.realpath ? await this.deps.realpath(path) : await realpath(path)
      if (resolve(real) !== resolve(path)) continue
      result.push(entry)
    }
    return result
  }

  /**
   * One pass over the index: every artifact id with its record and all alias
   * keys, redirect aliases included. Management lists and discards group from
   * this instead of rescanning the index per artifact.
   */
  async groupByArtifact(): Promise<ReadonlyMap<string, ArtifactGroup>> {
    const groups = new Map<string, { record?: SourceIndexRecord; aliases: string[] }>()
    for (const [key, record] of Object.entries((await this.sourceSnapshot()).sources)) {
      const group = groups.get(record.cacheKey) ?? { aliases: [] }
      group.record ??= record
      group.aliases.push(key)
      groups.set(record.cacheKey, group)
    }
    return groups
  }

  /**
   * Every committed artifact, both index-backed and orphaned directories,
   * with its cached meta. Cached between writes: a page flip, refresh or
   * discard-driven refetch re-reads nothing until the store is written again.
   */
  async inventory(signal?: AbortSignal): Promise<readonly InventoryEntry[]> {
    if (this.inventoryCache?.generation === this.writes) return this.inventoryCache.entries
    const snapshot = await this.sourceSnapshot()
    const ids = new Set<string>([
      ...Object.values(snapshot.sources).map((record) => record.cacheKey),
      ...(await this.listArtifactDirectories()),
    ])
    const entries: InventoryEntry[] = []
    for (const id of ids) {
      signal?.throwIfAborted()
      try {
        const stored = await this.metaFor(id)
        entries.push(stored === undefined ? { cacheKey: id } : { cacheKey: id, stored })
      } catch (error) {
        entries.push({
          cacheKey: id,
          failureMessage: error instanceof Error ? error.message : String(error),
        })
      }
    }
    this.inventoryCache = { generation: this.writes, entries }
    return entries
  }

  /** Whether the artifact directory exists as a regular, expected filesystem entry. */
  async hasArtifactDirectory(cacheKey: string): Promise<boolean> {
    const name = SHA256.parse(cacheKey)
    const path = join(this.root, name)
    try {
      if (this.deps.readdir !== undefined) {
        // An injected directory port owns its own safety checks; presence is
        // answered by the same enumeration the inventory uses.
        return (await this.deps.readdir(this.root)).includes(name)
      }
      const info = await lstat(path)
      if (info.isSymbolicLink() || !info.isDirectory()) return false
      const real = this.deps.realpath ? await this.deps.realpath(path) : await realpath(path)
      return resolve(real) === resolve(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  /**
   * Remove one committed artifact completely under the publication lock, so a
   * concurrent publication cannot re-point an alias at a removed directory:
   * aliases go first (the index pointer is the marker), then the directory,
   * then the task file. The caller has already retired the artifact's readers
   * and parse receipts.
   */
  async discardArtifact(cacheKey: string, signal?: AbortSignal): Promise<number> {
    SHA256.parse(cacheKey)
    signal?.throwIfAborted()
    this.touch()
    return await (this.deps.withSourceLock ?? withFileLock)(
      this.indexPath(),
      async () => {
        signal?.throwIfAborted()
        const removedAliases = await this.deleteSourcesLocked([cacheKey], signal)
        if (await this.hasArtifactDirectory(cacheKey))
          await this.removeArtifactDir(cacheKey, signal)
        await this.deleteTask(cacheKey)
        return removedAliases
      },
      { waitMs: 60_000, ...(signal !== undefined ? { signal } : {}) },
    )
  }

  /** Remove every alias of one artifact; the caller holds the publication lock. */
  private async deleteSourcesLocked(
    cacheKeys: readonly string[],
    signal?: AbortSignal,
  ): Promise<number> {
    const keys = new Set(cacheKeys.map((key) => SHA256.parse(key)))
    if (keys.size === 0) return 0
    signal?.throwIfAborted()
    const current = await this.sourceSnapshot()
    let removed = 0
    for (const [key, record] of Object.entries(current.sources))
      if (keys.has(record.cacheKey)) {
        delete current.sources[key]
        removed++
      }
    if (removed === 0) return 0
    const bytes = encoder.encode(JSON.stringify(sourceIndexSchema.parse(current)))
    if (bytes.byteLength > SOURCE_INDEX_MAX_BYTES)
      throw new Error('The parsed source index is too large')
    signal?.throwIfAborted()
    await this.atomicWrite(this.indexPath(), bytes, signal)
    return removed
  }

  /** Remove the artifact directory; the caller has already retired its readers. */
  private async removeArtifactDir(cacheKey: string, signal?: AbortSignal): Promise<void> {
    const path = this.dir(cacheKey)
    signal?.throwIfAborted()
    if (this.deps.readdir === undefined) {
      const info = await lstat(path)
      if (info.isSymbolicLink() || !info.isDirectory())
        throw new Error('The parsed artifact directory is not a regular directory')
      const real = this.deps.realpath ? await this.deps.realpath(path) : await realpath(path)
      if (resolve(real) !== resolve(path))
        throw new Error('The parsed artifact directory is not the expected path')
    }
    signal?.throwIfAborted()
    await this.deps.rm(path, { recursive: true, force: true })
  }

  /** One rename commits all primary/verified aliases, retaining unrelated sources. */
  async putSources(
    sourceKeys: readonly string[],
    record: SourceIndexRecord,
    signal?: AbortSignal,
  ): Promise<void> {
    const keys = [...new Set(sourceKeys.map((key) => SHA256.parse(key)))]
    if (keys.length === 0) throw new Error('A source publication requires at least one identity')
    const value = sourceRecordSchema.parse(record)
    signal?.throwIfAborted()
    this.touch()
    await this.ensureRoot()
    await this.deps.mkdir(join(this.root, 'sources'))
    await (this.deps.withSourceLock ?? withFileLock)(
      this.indexPath(),
      async () => {
        signal?.throwIfAborted()
        const current = await this.sourceSnapshot()
        for (const key of keys) current.sources[key] = value
        const snapshot = sourceIndexSchema.parse(current)
        const bytes = encoder.encode(JSON.stringify(snapshot))
        if (bytes.byteLength > SOURCE_INDEX_MAX_BYTES)
          throw new Error('The parsed source index is too large')
        signal?.throwIfAborted()
        await this.atomicWrite(this.indexPath(), bytes, signal)
      },
      { waitMs: 60_000, ...(signal !== undefined ? { signal } : {}) },
    )
  }

  async putSource(
    sourceKey: string,
    record: SourceIndexRecord,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.putSources([sourceKey], record, signal)
  }

  async sourceRecord(sourceKey: string): Promise<SourceIndexRecord | undefined> {
    SHA256.parse(sourceKey)
    return (await this.sourceSnapshot()).sources[sourceKey]
  }

  /** The caller may have already read the candidate before probing its source. */
  async artifactFor(record: SourceIndexRecord): Promise<ParsedArtifact | undefined> {
    const candidate = sourceRecordSchema.parse(record)
    const artifact = await this.get(candidate.cacheKey)
    if (
      artifact !== undefined &&
      (artifact.meta.contentFingerprint !== candidate.fingerprint ||
        artifact.meta.generation !== candidate.generation ||
        artifact.meta.parser !== candidate.parser ||
        artifact.meta.format !== candidate.format)
    )
      throw new Error('The parsed artifact does not match its source index')
    return artifact
  }

  async lookupSource(
    sourceKey: string,
    stamp: FulltextSourceStamp,
  ): Promise<ParsedArtifact | undefined> {
    const record = await this.sourceRecord(sourceKey)
    if (record === undefined || !stampMatches(record.stamp, stamp)) return undefined
    return await this.artifactFor(record)
  }
}
