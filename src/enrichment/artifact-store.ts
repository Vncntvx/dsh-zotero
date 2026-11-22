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
import { createHash, randomUUID } from 'node:crypto'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
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

function digestOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function verifyDigest(bytes: Uint8Array, expected: string | undefined): void {
  if (expected === undefined || digestOf(bytes) !== expected)
    throw new Error('The stored parsed artifact does not match its metadata digest')
}

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
  /**
   * The atomic replacement. The host default is the upstream
   * `writeFileAtomic` with the store's permission bits and an abort veto
   * before the commit; an injected deps object must supply its own — that is
   * the fixture's file map, which cannot honor a real temp+rename.
   */
  readonly writeAtomic: (
    path: string,
    data: Uint8Array | string,
    signal?: AbortSignal,
  ) => Promise<void> /** Directory enumeration for orphan recovery; host-only ports when omitted. */
  readonly readdir?: (path: string) => Promise<readonly string[]>
  readonly stat?: (path: string) => Promise<{ readonly mtimeMs: number }>
  readonly realpath?: (path: string) => Promise<string>
}

/**
 * The host's atomic replacement: the upstream exclusive-create temp plus
 * rename, with the store's permission bits and the abort veto between the
 * ready write and the commit rename. (`writeFileAtomic` owns its own temp
 * naming and Windows retry; this veto is the store's publish contract — a
 * cancelled publish must not rename.)
 */
async function hostWriteAtomic(
  path: string,
  data: Uint8Array | string,
  signal?: AbortSignal,
): Promise<void> {
  const temp = `${path}.tmp-${randomUUID()}`
  try {
    await writeFileAtomic(temp, data, { mode: 0o600, dirMode: 0o700 })
    signal?.throwIfAborted()
    await rename(temp, path)
  } finally {
    await rm(temp, { recursive: false, force: true })
  }
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
    await mkdir(path, { recursive: true, mode: 0o700 })
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
  writeAtomic: hostWriteAtomic,
  // Directory enumeration, mtime and realpath fall through to node:fs when
  // the deps omit them; the injected ports exist for the in-memory fixtures.
}
const decoder = new TextDecoder('utf-8', { fatal: true })
const encoder = new TextEncoder()
/** meta.json read ceiling; the schema's 64 MiB fields far exceed a real meta. */
const META_JSON_MAX_BYTES = 256 * 1024
/**
 * content_list.json read ceiling. The read path validates the JSON array but
 * no reader consumes the list today, so the ceiling stays a corruption bound
 * rather than a payload budget.
 */
const CONTENT_LIST_MAX_BYTES = 64 * 1024 * 1024

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
type ParseTaskRecord = z.infer<typeof taskReceipt>

export class ParsedArtifactStore {
  private rootEnsured: Promise<void> | undefined
  /** Every attempted write advances this; per-generation read caches invalidate on it. */
  #writes = 0
  private inventoryCache:
    { readonly generation: number; readonly entries: readonly InventoryEntry[] } | undefined

  constructor(
    public readonly root: string,
    private readonly deps: ArtifactStoreDeps = hostDeps,
  ) {}

  /**
   * Every attempted write advances this. Read-through caches key on it: a
   * store write is the one signal that any earlier read may now be stale,
   * whether or not the write succeeded.
   */
  get writes(): number {
    return this.#writes
  }

  /**
   * Any attempted write invalidates the read caches, whether or not it
   * succeeds: a failed atomic write may still have mutated the target, so
   * every write method opens with this. A new store write path must do the
   * same or the inventory cache goes stale (see the artifact inventory
   * write-generation rule in docs/architecture.md). The source index
   * itself is deliberately read per call — its I/O failures must surface,
   * never hide behind a cache.
   */
  private touch(): void {
    this.#writes++
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
    await this.deps.writeAtomic(path, data, signal)
  }

  async getTask(cacheKey: string): Promise<ParseTaskRecord | undefined> {
    let bytes: Uint8Array
    try {
      bytes = await this.deps.readFile(this.taskPath(cacheKey))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    let decoded: unknown
    try {
      decoded = JSON.parse(decoder.decode(bytes))
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      await this.deleteTask(cacheKey)
      return undefined
    }
    const parsed = taskReceipt.safeParse(decoded)
    if (parsed.success) return parsed.data
    await this.deleteTask(cacheKey)
    return undefined
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
    let meta: z.infer<typeof artifactMetaSchema>
    try {
      meta = artifactMetaSchema.parse(
        JSON.parse(
          decoder.decode(await this.readBounded(join(dir, 'meta.json'), META_JSON_MAX_BYTES)),
        ),
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    // The declared byte count is the read bound: a truncated `full.md` is an
    // exact-length mismatch, not a silently shortened document. A file that
    // vanished behind a committed meta is an uncommitted artifact — the same
    // miss a missing meta.json is.
    let markdown: string
    try {
      const bytes = await this.readExact(join(dir, 'full.md'), meta.markdownBytes)
      verifyDigest(bytes, meta.markdownSha256)
      markdown = decoder.decode(bytes)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    if (markdown.trim() === '') throw new Error('The stored parsed artifact is invalid')
    let contentList: string | undefined
    if (meta.files.length === 2) {
      try {
        const bytes = await this.readBounded(join(dir, 'content_list.json'), CONTENT_LIST_MAX_BYTES)
        verifyDigest(bytes, meta.contentListSha256)
        contentList = decoder.decode(bytes)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
      if (!Array.isArray(JSON.parse(contentList)))
        throw new Error('The stored parsed content list is invalid')
    }
    const {
      characterCount: _characterCount,
      markdownBytes: _markdownBytes,
      markdownSha256: _markdownHash,
      contentListSha256: _contentHash,
      imageSha256: _imageHashes,
      ...domainMeta
    } = meta
    return { markdown, ...(contentList !== undefined ? { contentList } : {}), meta: domainMeta }
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
    const contentBytes =
      artifact.contentList === undefined ? undefined : encoder.encode(artifact.contentList)
    const images = artifact.images ?? []
    if (images.length !== (artifact.meta.images?.length ?? 0))
      throw new Error('The parsed artifact image list does not match its payload')
    images.forEach((image, index) => {
      const declared = artifact.meta.images?.[index]
      if (declared === undefined || declared.name !== image.name)
        throw new Error('The parsed artifact image list does not match its payload')
      if (declared.bytes !== image.data.byteLength)
        throw new Error('The parsed artifact image size does not match its metadata')
    })
    const meta = artifactMetaSchema.parse({
      ...artifact.meta,
      // meta.json is the commit marker; every committed artifact carries the
      // Markdown H1 so a tab chip can name the paper without opening it.
      title: artifact.meta.title ?? extractMarkdownTitleOf(artifact.markdown),
      characterCount: artifact.markdown.length,
      markdownBytes: markdownBytes.byteLength,
      markdownSha256: digestOf(markdownBytes),
      ...(contentBytes === undefined ? {} : { contentListSha256: digestOf(contentBytes) }),
      imageSha256: Object.fromEntries(
        (artifact.images ?? []).map((image) => [image.name, digestOf(image.data)]),
      ),
    })
    if (artifact.markdown.trim() === '') throw new Error('The parsed Markdown is empty')
    if ((artifact.contentList !== undefined) !== (meta.files.length === 2))
      throw new Error('The parsed artifact file list does not match its payload')
    const dir = this.dir(cacheKey)
    await this.ensureRoot()
    await this.deps.mkdir(dir)
    await this.atomicWrite(join(dir, 'full.md'), markdownBytes)
    if (contentBytes !== undefined)
      await this.atomicWrite(join(dir, 'content_list.json'), contentBytes)
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
        META_JSON_MAX_BYTES,
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

  /** Read exactly `byteCount` bytes: a shorter answer is a truncated artifact. */
  private async readExact(path: string, byteCount: number): Promise<Uint8Array> {
    const bytes = await this.readBounded(path, byteCount)
    if (bytes.byteLength !== byteCount)
      throw new Error('The stored parsed artifact does not match its metadata')
    return bytes
  }

  async readMarkdown(
    cacheKey: string,
    characterCount: number,
    byteCount: number,
    sha256: string,
  ): Promise<string> {
    const bytes = await this.readBounded(join(this.dir(cacheKey), 'full.md'), byteCount)
    verifyDigest(bytes, sha256)
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
              await this.readBounded(join(this.dir(cacheKey), 'meta.json'), META_JSON_MAX_BYTES),
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
    verifyDigest(data, meta.imageSha256[declared.name])
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
        JSON.parse(decoder.decode(await this.readBounded(path, META_JSON_MAX_BYTES))),
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
  async groupByArtifact(
    snapshot?: Awaited<ReturnType<ParsedArtifactStore['snapshot']>>,
  ): Promise<ReadonlyMap<string, ArtifactGroup>> {
    const groups = new Map<string, { record?: SourceIndexRecord; aliases: string[] }>()
    for (const [key, record] of Object.entries(
      (snapshot ?? (await this.sourceSnapshot())).sources,
    )) {
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
  async inventory(
    signal?: AbortSignal,
    provided?: Awaited<ReturnType<ParsedArtifactStore['snapshot']>>,
    fresh = false,
  ): Promise<readonly InventoryEntry[]> {
    const generation = this.#writes
    if (!fresh && this.inventoryCache?.generation === generation) return this.inventoryCache.entries
    const snapshot = provided ?? (await this.sourceSnapshot())
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
    if (generation === this.#writes) this.inventoryCache = { generation, entries }
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
   * Remove one committed artifact under the source-index lock. The caller
   * has reserved and drained its generation; the lock serializes other index
   * edits. Remove aliases first, then the directory and task receipt.
   */
  async discardArtifact(
    cacheKey: string,
    signal?: AbortSignal,
    afterDiscard?: () => Promise<void>,
  ): Promise<number> {
    SHA256.parse(cacheKey)
    signal?.throwIfAborted()
    this.touch()
    return await this.withSourcePublicationLock(async () => {
      signal?.throwIfAborted()
      const removedAliases = await this.deleteSourcesLocked([cacheKey], signal)
      if (await this.hasArtifactDirectory(cacheKey)) await this.removeArtifactDir(cacheKey, signal)
      await this.deleteTask(cacheKey)
      await afterDiscard?.()
      return removedAliases
    }, signal)
  }

  /** Serialize a derived index update with source publication and artifact deletion. */
  async withSourcePublicationLock<T>(
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted()
    await this.ensureRoot()
    await this.deps.mkdir(join(this.root, 'sources'))
    return await (this.deps.withSourceLock ?? withFileLock)(this.indexPath(), operation, {
      waitMs: 60_000,
      ...(signal !== undefined ? { signal } : {}),
    })
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
    await this.withSourcePublicationLock(async () => {
      signal?.throwIfAborted()
      const current = await this.sourceSnapshot()
      for (const key of keys) current.sources[key] = value
      const snapshot = sourceIndexSchema.parse(current)
      const bytes = encoder.encode(JSON.stringify(snapshot))
      if (bytes.byteLength > SOURCE_INDEX_MAX_BYTES)
        throw new Error('The parsed source index is too large')
      signal?.throwIfAborted()
      await this.atomicWrite(this.indexPath(), bytes, signal)
    }, signal)
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

  /**
   * The caller may have already read the candidate before probing its source,
   * and may carry the meta that read produced, so one lookup reads meta.json
   * once. Without a captured meta the record's own meta is read here.
   */
  async artifactFor(
    record: SourceIndexRecord,
    captured?: StoredArtifactMeta,
  ): Promise<ParsedArtifact | undefined> {
    const candidate = sourceRecordSchema.parse(record)
    // The index-validated read: the record's fingerprint, generation, parser
    // and format are checked against the artifact meta, and readMarkdown
    // enforces the meta's own byte and character counts. The artifact's
    // content list is never part of this contract, so its file is not read.
    let meta: z.infer<typeof artifactMetaSchema> | undefined
    if (
      captured !== undefined &&
      captured.meta.contentFingerprint === candidate.fingerprint &&
      captured.meta.generation === candidate.generation &&
      captured.meta.parser === candidate.parser &&
      captured.meta.format === candidate.format
    ) {
      meta = captured.meta
    } else {
      meta = await this.metadataFor(candidate)
      if (meta === undefined) return undefined
    }
    const markdown = await this.readMarkdown(
      candidate.cacheKey,
      meta.characterCount,
      meta.markdownBytes,
      meta.markdownSha256,
    )
    const {
      characterCount: _characterCount,
      markdownBytes: _markdownBytes,
      markdownSha256: _markdownHash,
      contentListSha256: _contentHash,
      imageSha256: _imageHashes,
      ...domainMeta
    } = meta
    return { markdown, meta: domainMeta }
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
