/**
 * Open-access text cache. HTML/JATS bodies and locally extracted PDF text live
 * on disk; MinerU bodies remain owned by enrichment and are looked up per read.
 * @module dsh-zotero/scholarly/fulltext/store
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { dshCachePath } from '@deepseek-ai/dsh-home-paths'
import type { FulltextArtifactProvenance } from '../../local/fulltext-enhancer.js'

interface FullTextBody {
  readonly text: string
  readonly source: string
  readonly url: string
  /** Canonical route URL, including its query, without the fragment. */
  readonly sourceIdentity: string
}

export type MarkdownRecord = FullTextBody & {
  readonly provider: 'arxiv-html' | 'ar5iv-html' | 'pmc-jats'
  readonly format: 'markdown'
  readonly provenance?: never
}

export type PdfTextRecord = FullTextBody & {
  readonly provider: 'pdf-extract'
  readonly format: 'text'
  readonly provenance?: never
}

/** The actual artifact provenance may identify a verified attachment alias. */
export type MineruRecord = FullTextBody & {
  readonly provider: 'mineru'
  readonly format: 'markdown'
  readonly provenance: FulltextArtifactProvenance
}

export type FullTextRecord = MarkdownRecord | PdfTextRecord | MineruRecord

/** A PDF target survives an artifact hit; the artifact body never enters this cache. */
export type FullTextCacheEntry =
  | { readonly kind: 'document'; readonly record: MarkdownRecord }
  | {
      readonly kind: 'pdf'
      readonly url: string
      readonly sourceIdentity: string
      readonly record?: PdfTextRecord
    }

export type FullTextRead =
  | { readonly kind: 'hit'; readonly entry: FullTextCacheEntry }
  | { readonly kind: 'miss' }
  | { readonly kind: 'corrupt'; readonly reason: string }

const CACHE_VERSION = 3
const CACHE_DIRECTORY = `v${CACHE_VERSION}`
const MAX_RECORD_BYTES = 4 * 1_048_576
const DEFAULT_MEMORY_ITEMS = 8

/** Same-source URL identity: preserve query spelling/order, remove only the fragment. */
export function scholarlySourceIdentityOf(raw: string): string {
  const url = new URL(raw)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('scholarly store: source must be an HTTP(S) URL')
  }
  url.hash = ''
  return url.href
}

function fileNameOf(key: string): string {
  return `${createHash('sha256').update(key, 'utf8').digest('hex')}.json`
}

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function hasKeys(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): boolean {
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  )
}

function validSource(value: Record<string, unknown>): boolean {
  if (typeof value.url !== 'string' || typeof value.sourceIdentity !== 'string') return false
  try {
    return (
      value.url === value.sourceIdentity &&
      scholarlySourceIdentityOf(value.url) === value.sourceIdentity
    )
  } catch {
    return false
  }
}

function bodyOf(value: unknown): MarkdownRecord | PdfTextRecord | undefined {
  const body = objectOf(value)
  if (
    !body ||
    !hasKeys(body, ['provider', 'format', 'text', 'source', 'url', 'sourceIdentity']) ||
    typeof body.text !== 'string' ||
    typeof body.source !== 'string' ||
    !validSource(body)
  )
    return undefined
  const base: FullTextBody = {
    text: body.text,
    source: body.source,
    url: String(body.url),
    sourceIdentity: String(body.sourceIdentity),
  }
  if (body.provider === 'pdf-extract' && body.format === 'text') {
    return { ...base, provider: body.provider, format: body.format }
  }
  if (
    (body.provider === 'arxiv-html' ||
      body.provider === 'ar5iv-html' ||
      body.provider === 'pmc-jats') &&
    body.format === 'markdown'
  ) {
    return { ...base, provider: body.provider, format: body.format }
  }
  return undefined
}

function entryOf(value: unknown): FullTextCacheEntry | undefined {
  const entry = objectOf(value)
  if (!entry) return undefined
  if (entry.kind === 'document' && hasKeys(entry, ['kind', 'record'])) {
    const record = bodyOf(entry.record)
    return record && record.provider !== 'pdf-extract' ? { kind: 'document', record } : undefined
  }
  if (
    entry.kind !== 'pdf' ||
    !hasKeys(entry, ['kind', 'url', 'sourceIdentity'], ['record']) ||
    !validSource(entry)
  )
    return undefined
  const base = {
    kind: 'pdf' as const,
    url: String(entry.url),
    sourceIdentity: String(entry.sourceIdentity),
  }
  if (!Object.hasOwn(entry, 'record')) return base
  const record = bodyOf(entry.record)
  if (
    !record ||
    record.provider !== 'pdf-extract' ||
    record.sourceIdentity !== entry.sourceIdentity
  )
    return undefined
  return { ...base, record }
}

/**
 * A small memory index fronts a closed, versioned disk envelope. Old namespaces
 * are neither read nor migrated. Corrupt records are evicted and reported.
 */
export class ScholarlyTextStore {
  private readonly memory = new Map<string, FullTextCacheEntry>()
  private disposed = false
  private rootEnsured: Promise<void> | undefined

  constructor(
    public readonly root: string = dshCachePath('zotero-scholarly'),
    private readonly memoryItems: number = DEFAULT_MEMORY_ITEMS,
  ) {}

  private ensureRoot(): Promise<void> {
    if (!this.rootEnsured) {
      this.rootEnsured = mkdir(join(this.root, CACHE_DIRECTORY), { recursive: true }).then(
        () => {},
        (error) => {
          this.rootEnsured = undefined
          throw error
        },
      )
    }
    return this.rootEnsured
  }

  async get(key: string): Promise<FullTextRead> {
    if (this.disposed) return { kind: 'miss' }
    const cached = this.memory.get(key)
    if (cached) {
      this.remember(key, cached)
      return { kind: 'hit', entry: cached }
    }
    const path = join(this.root, CACHE_DIRECTORY, fileNameOf(key))
    const corrupt = async (reason: string): Promise<FullTextRead> => {
      this.memory.delete(key)
      await rm(path, { force: true }).catch(() => {})
      return { kind: 'corrupt', reason }
    }
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      return code === 'ENOENT'
        ? { kind: 'miss' }
        : await corrupt(`unreadable (${String(code ?? error)})`)
    }
    if (Buffer.byteLength(raw, 'utf8') > MAX_RECORD_BYTES) return await corrupt('record size')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return await corrupt('malformed JSON')
    }
    const envelope = objectOf(parsed)
    if (
      !envelope ||
      !hasKeys(envelope, ['version', 'key', 'entry']) ||
      envelope.version !== CACHE_VERSION
    ) {
      return await corrupt('record shape')
    }
    if (envelope.key !== key) return await corrupt('cache key mismatch')
    const entry = entryOf(envelope.entry)
    if (!entry) return await corrupt('record shape')
    if (this.disposed) return { kind: 'miss' }
    this.remember(key, entry)
    return { kind: 'hit', entry }
  }

  /** Persist source targets and ordinary text, never an enrichment-owned body. */
  async set(key: string, record: FullTextRecord): Promise<void> {
    if (this.disposed) return
    const entry: FullTextCacheEntry =
      record.provider === 'mineru'
        ? { kind: 'pdf', url: record.url, sourceIdentity: record.sourceIdentity }
        : record.provider === 'pdf-extract'
          ? { kind: 'pdf', url: record.url, sourceIdentity: record.sourceIdentity, record }
          : { kind: 'document', record }
    const validated = entryOf(entry)
    if (!validated) throw new Error('scholarly store: invalid record')
    const encoded = JSON.stringify({ version: CACHE_VERSION, key, entry: validated })
    if (Buffer.byteLength(encoded, 'utf8') > MAX_RECORD_BYTES) {
      throw new Error(
        `scholarly store: record "${key}" exceeds the ${MAX_RECORD_BYTES}-byte cache ceiling`,
      )
    }
    await this.ensureRoot()
    if (this.disposed) return
    const path = join(this.root, CACHE_DIRECTORY, fileNameOf(key))
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, encoded, 'utf8')
      await rename(temporary, path)
    } finally {
      await rm(temporary, { force: true })
    }
    if (!this.disposed) this.remember(key, validated)
  }

  /** Expiry removes both tiers before any refetch; deletion failures stay explicit. */
  async delete(key: string): Promise<void> {
    this.memory.delete(key)
    await rm(join(this.root, CACHE_DIRECTORY, fileNameOf(key)), { force: true })
  }

  dispose(): void {
    this.disposed = true
    this.memory.clear()
  }

  private remember(key: string, entry: FullTextCacheEntry): void {
    this.memory.delete(key)
    this.memory.set(key, entry)
    if (this.memory.size <= this.memoryItems) return
    const oldest = this.memory.keys().next().value
    if (oldest !== undefined) this.memory.delete(oldest)
  }
}
