/**
 * The open-access full-text store: one cache directory, one in-memory index.
 *
 * **Why not `ctx.storageDomain`.** That seam's `KvTable.get()` is a synchronous
 * read of a fully resident table (`@deepseek-ai/dsh-storage-domain`
 * `domain.ts`), so every cached paper body would live in memory — the bodies
 * are 50–200 KB each and `maxContentChars` allows 50 000 characters. The
 * harness's own answer for large blob caches is the path seam
 * `dshCachePath()` (`@deepseek-ai/dsh-home-paths`), which
 * `packages/attachment/attachment-local` already uses for attachment caches.
 * This store follows that precedent: bodies on disk under the resolved cache
 * root, nothing but a small index in memory.
 *
 * **One value states one fact.** A read distinguishes three outcomes:
 *
 * - `hit` — a record was returned.
 * - `miss` — no record was ever stored.
 * - `corrupt` — a record exists but cannot be trusted (unreadable, wrong size,
 *   malformed JSON); it is evicted and reported, never returned as a miss.
 *
 * A write failure is reported to the caller instead of being swallowed: a
 * cache directory that silently refuses writes turns every read into a fetch
 * while the operator believes caching is on.
 *
 * @module dsh-zotero/scholarly/fulltext/store
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dshCachePath } from '@deepseek-ai/dsh-home-paths'

/** One retrieved full text, as stored. */
export interface FullTextRecord {
  text: string
  source: string
  structured: boolean
  url?: string
}

/** What one read produced. */
export type FullTextRead =
  | { readonly kind: 'hit'; readonly record: FullTextRecord }
  | { readonly kind: 'miss' }
  | { readonly kind: 'corrupt'; readonly reason: string }

/** Longest key fragment kept in a file name. */
const MAX_KEY_CHARS = 120

/** Hard ceiling on one stored body: `maxContentChars` allows 50 000 characters. */
const MAX_RECORD_BYTES = 4 * 1_048_576

/** Default in-memory index size. */
const DEFAULT_MEMORY_ITEMS = 8

/**
 * A file-safe spelling of one cache key.
 *
 * Path traversal is impossible by construction: every non-word character
 * becomes `_`, so the result is a single segment with no separator.
 * @param key - the logical cache key.
 * @returns the file-name fragment.
 */
function fileNameOf(key: string): string {
  return `${key.replace(/[^\w.-]+/g, '_').slice(0, MAX_KEY_CHARS)}.json`
}

/**
 * Validates one parsed record without trusting its shape.
 * @param value - parsed JSON.
 * @returns the record, or undefined when the shape does not hold.
 */
function recordOf(value: unknown): FullTextRecord | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<FullTextRecord>
  if (typeof candidate.text !== 'string' || typeof candidate.source !== 'string') return undefined
  if (typeof candidate.structured !== 'boolean') return undefined
  if (candidate.url !== undefined && typeof candidate.url !== 'string') return undefined
  return {
    text: candidate.text,
    source: candidate.source,
    structured: candidate.structured,
    ...(candidate.url === undefined ? {} : { url: candidate.url }),
  }
}

/**
 * The full-text cache. Bodies live as one JSON document per key under the
 * resolved cache root; a small LRU map fronts them for the repeated reads one
 * conversation makes.
 *
 * A cache fault is never a quiet miss: `get` answers `corrupt` with the
 * reason, the record is evicted, and the resolver carries that reason into
 * the terminal error the model reads (`resolve.ts`). The scholarly
 * subsystem deliberately runs no diagnostics ring of its own — the plugin's
 * ring belongs to the `zotero` namespace, and the scholarly row is isolated
 * from `ctx.zotero` by design (`docs/architecture.md`) — so the fault's
 * observable channel is the reader's, not an operator's.
 */
export class ScholarlyTextStore {
  private readonly memory = new Map<string, FullTextRecord>()
  private disposed = false

  constructor(
    /** Resolved cache root; defaults to the harness cache path for this component. */
    public readonly root: string = dshCachePath('zotero-scholarly'),
    private readonly memoryItems: number = DEFAULT_MEMORY_ITEMS,
  ) {}

  /**
   * Read one record.
   * @param key - the logical cache key.
   * @returns a discriminated outcome; a corrupt record is evicted, not returned.
   */
  async get(key: string): Promise<FullTextRead> {
    const cached = this.memory.get(key)
    if (cached !== undefined) return { kind: 'hit', record: cached }
    if (this.disposed) return { kind: 'miss' }

    const path = join(this.root, fileNameOf(key))
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return { kind: 'miss' }
      // EACCES, EISDIR, EIO: the directory exists but this record cannot be
      // read. That is a fault, reported through the `corrupt` outcome and
      // evicted, never a quiet miss.
      await this.evict(path)
      return { kind: 'corrupt', reason: `unreadable (${String(code ?? error)})` }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      await this.evict(path)
      return { kind: 'corrupt', reason: 'malformed JSON' }
    }

    const record = recordOf(parsed)
    if (record === undefined) {
      await this.evict(path)
      return { kind: 'corrupt', reason: 'record shape' }
    }

    this.remember(key, record)
    return { kind: 'hit', record }
  }

  /**
   * Store one record durably.
   *
   * The write is atomic (temp document + rename) so a killed process cannot
   * leave a valid-looking prefix behind.
   * @param key - the logical cache key.
   * @param record - the body to store.
   * @throws when the cache root refuses the write; the caller decides whether
   *   that should fail the read it is serving.
   */
  async set(key: string, record: FullTextRecord): Promise<void> {
    const encoded = JSON.stringify(record)
    if (Buffer.byteLength(encoded, 'utf8') > MAX_RECORD_BYTES) {
      throw new Error(
        `scholarly store: record "${key}" exceeds the ${MAX_RECORD_BYTES}-byte cache ceiling`,
      )
    }
    this.remember(key, record)
    if (this.disposed) return

    await mkdir(this.root, { recursive: true })
    const path = join(this.root, fileNameOf(key))
    const temporary = `${path}.${process.pid}.tmp`
    await writeFile(temporary, encoded, 'utf8')
    await rename(temporary, path)
  }

  /** Release the in-memory index. Idempotent. */
  dispose(): void {
    this.disposed = true
    this.memory.clear()
  }

  private async evict(path: string): Promise<void> {
    try {
      await rm(path, { force: true })
    } catch {
      // A record that cannot be evicted stays corrupt on the next read, which
      // answers `corrupt` again — the reader's outcome already carries it.
    }
  }

  private remember(key: string, record: FullTextRecord): void {
    this.memory.set(key, record)
    if (this.memory.size <= this.memoryItems) return
    const oldest = this.memory.keys().next().value
    if (oldest !== undefined) this.memory.delete(oldest)
  }
}
