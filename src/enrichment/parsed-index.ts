/** Foreground reconciliation of committed MinerU artifacts with the derived FTS5 index. */
import { createHash } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { lstat, mkdtemp, open, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { mapWithConcurrency } from '../concurrency.js'
import {
  isNotFoundError,
  ZoteroError,
  ZOTERO_ENRICHMENT_ARTIFACT_NOT_FOUND,
  ZOTERO_FILE_UNREADABLE,
  ZOTERO_NO_ATTACHMENT,
  ZOTERO_PROVIDER_UNAVAILABLE,
} from '../errors.js'
import { queryTermsOf } from '../evidence.js'
import { queryTextsOf } from '../local/evidence-ranker.js'
import { formatRef, parseSupportedRef } from '../refs.js'
import { raceWithSignal } from '../race-signal.js'
import type { ZoteroService } from '../service.js'
import type { SupportedLocalLibrary } from '../types.js'
import type {
  ParsedArtifactStore,
  SourceIndexRecord,
  StoredArtifactMeta,
} from './artifact-store.js'
import type { IndexOperation, IndexedDocument, IndexedPassage } from './parsed-index-worker.js'
import { resolveSafeDirectory } from './safe-directory.js'
import { sourceKeyOf } from './source-stamp.js'
import { workerEntryUrl } from './worker-bootstrap.js'
import type { ZoteroParsedIndexStatusView } from '../contract.js'

type ParsedArtifactMeta = StoredArtifactMeta['meta']

export type ParsedScope =
  | { kind: 'library'; library: SupportedLocalLibrary }
  | { kind: 'collection'; ref: string }
  | { kind: 'artifacts'; artifactIds: readonly string[] }

type Provider = ReturnType<ZoteroService['parsedSearchProvider']>
type Attachment = Awaited<ReturnType<Provider['parsedSearchAttachment']>>
type Snapshot = Awaited<ReturnType<ParsedArtifactStore['snapshot']>>
type SearchRequest = {
  query: string
  variants?: readonly string[]
  scope: ParsedScope
  limit: number
}
type Coverage = {
  status: 'complete' | 'partial' | 'unavailable'
  discovered: number
  searchable: number
  stale: number
  missing: number
}
type Candidate = {
  readonly document: IndexedDocument
  readonly meta: ParsedArtifactMeta
  readonly origin?: {
    readonly key: string
    readonly record: SourceIndexRecord
    readonly ref: string
  }
  readonly attachment?: Attachment
}
type Entry =
  | { readonly candidate: Candidate }
  | { readonly gap: 'stale' | 'missing'; readonly collectionKeys?: readonly string[] }
  | undefined

interface SearchDependencies {
  readonly store: ParsedArtifactStore
  readonly provider: () => Provider
  readonly probe: (
    ref: string,
    record: SourceIndexRecord,
    meta: ParsedArtifactMeta,
    signal: AbortSignal,
  ) => Promise<boolean>
}

function workerOf(path: string): Worker {
  return new Worker(workerEntryUrl(new URL('./parsed-index-worker.js', import.meta.url)), {
    workerData: path,
    execArgv: [],
  })
}

type WorkerReply = { id: number } & ({ ok: true; value: unknown } | { ok: false; message: string })

class IndexConnection {
  private worker?: Worker
  private sequence = 0
  private readonly pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: unknown): void }
  >()

  constructor(private readonly path: string) {}

  private connect() {
    const worker = workerOf(this.path)
    this.worker = worker
    const fail = (error: unknown) => {
      if (this.worker !== worker) return
      delete this.worker
      for (const task of this.pending.values()) task.reject(error)
      this.pending.clear()
    }
    worker.on('error', fail)
    worker.on('exit', () => fail(new Error('The parsed index worker exited.')))
    worker.on('message', (reply: WorkerReply) => {
      const task = this.pending.get(reply.id)
      this.pending.delete(reply.id)
      if (this.pending.size === 0) worker.unref()
      if (reply.ok) task?.resolve(reply.value)
      else task?.reject(new Error(reply.message))
    })
    return worker
  }

  async run<T>(operation: IndexOperation, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    const worker = this.worker ?? this.connect()
    worker.ref()
    const id = ++this.sequence
    const task = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        worker.postMessage({ id, operation })
      } catch (error) {
        this.pending.delete(id)
        if (this.pending.size === 0) worker.unref()
        reject(error)
      }
    })
    return (await raceWithSignal(task, signal)) as T
  }

  async close(): Promise<void> {
    await this.worker?.terminate()
  }
}

function indexedDocument(artifactId: string, meta: ParsedArtifactMeta): IndexedDocument {
  return {
    artifactId,
    sourceId: meta.sourceId,
    generation: meta.generation,
    digest: meta.markdownSha256,
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

// One index belongs to one output directory. The partition must survive
// moving that directory to another absolute path.
const ROOT_PARTITION = digest('zotero-parsed')
// The worker uses a 64-character root prefix for discard and requires a
// 128-character partition name. The second digest denotes the unfiltered index.
const PARTITION = ROOT_PARTITION + digest('[]')

function unavailable(error: unknown): boolean {
  return (
    isNotFoundError(error) ||
    (error instanceof ZoteroError &&
      (error.code === ZOTERO_NO_ATTACHMENT || error.code === ZOTERO_ENRICHMENT_ARTIFACT_NOT_FOUND))
  )
}

function sameRecord(before: SourceIndexRecord, after: SourceIndexRecord | undefined): boolean {
  return JSON.stringify(before) === JSON.stringify(after)
}

const readMarkdown = (store: ParsedArtifactStore, candidate: Candidate) =>
  store.readMarkdown(
    candidate.document.artifactId,
    candidate.meta.characterCount,
    candidate.meta.markdownBytes,
    candidate.meta.markdownSha256,
  )

const versionOf = (document: IndexedDocument) =>
  JSON.stringify([document.artifactId, document.sourceId, document.generation, document.digest])

async function inventoryOf(store: ParsedArtifactStore, signal: AbortSignal) {
  const entries = await store.inventory(signal, undefined, true)
  const candidates: Candidate[] = []
  for (const { cacheKey, stored } of entries) {
    if (stored === undefined) continue
    candidates.push({ document: indexedDocument(cacheKey, stored.meta), meta: stored.meta })
  }
  return { candidates, unreadable: entries.length - candidates.length }
}

type IndexCoverage = Omit<ZoteroParsedIndexStatusView, 'progress' | 'rebuild'>

export class ParsedIndex {
  private readonly databases = new Map<string, { connection: IndexConnection; users: number }>()
  private latestPath?: string
  private readonly shutdown = new AbortController()
  private active = false
  private rebuildProgress?: {
    root: string
    done: number
    total: number
    coverage: Promise<IndexCoverage>
  }
  private rebuilding = false

  constructor(private readonly resolveDirectory = resolveSafeDirectory) {}

  private async path(root: string, create: boolean): Promise<string> {
    const directory = await this.resolveDirectory({
      configured: '',
      defaultRoot: root,
      create,
      readOnly: !create,
      allowMissing: !create,
      privateOwner: true,
      errorCode: ZOTERO_FILE_UNREADABLE,
      label: 'parsed document index directory',
    })
    if (directory !== root)
      throw new ZoteroError('The parsed output directory changed.', ZOTERO_FILE_UNREADABLE)
    return join(directory, 'index.db')
  }

  private async existingPath(root: string): Promise<string | undefined> {
    const path = await this.path(root, false)
    try {
      await lstat(path)
      return path
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return undefined
    }
  }

  private async retireIdle(path: string): Promise<void> {
    const entry = this.databases.get(path)
    if (path !== this.latestPath && entry?.users === 0) {
      this.databases.delete(path)
      await entry.connection.close()
    }
  }

  private async useDatabase<T>(
    path: string,
    task: (connection: IndexConnection) => Promise<T>,
  ): Promise<T> {
    this.shutdown.signal.throwIfAborted()
    const previous = this.latestPath
    const entry = this.databases.get(path) ?? { connection: new IndexConnection(path), users: 0 }
    this.databases.set(path, entry)
    this.latestPath = path
    entry.users += 1
    try {
      if (previous !== undefined && previous !== path) await this.retireIdle(previous)
      this.shutdown.signal.throwIfAborted()
      return await task(entry.connection)
    } finally {
      entry.users -= 1
      await this.retireIdle(path)
    }
  }

  async close(): Promise<void> {
    this.shutdown.abort(new DOMException('Parsed document search is closed.', 'AbortError'))
    await Promise.all([...this.databases.values()].map(({ connection }) => connection.close()))
    this.databases.clear()
  }

  async status(
    store: ParsedArtifactStore,
    externalSignal: AbortSignal,
  ): Promise<ZoteroParsedIndexStatusView> {
    const signal = AbortSignal.any([externalSignal, this.shutdown.signal])
    const progress = this.rebuildProgress
    if (progress?.root === store.root) {
      const current = await raceWithSignal(progress.coverage, signal).catch(() => {
        signal.throwIfAborted()
        return undefined
      })
      if (current && progress === this.rebuildProgress)
        return { ...current, progress: { done: progress.done, total: progress.total } }
    }
    const inventory = await inventoryOf(store, signal)
    return await this.coverage(store.root, inventory, signal)
  }

  private async coverage(
    root: string,
    { candidates, unreadable }: Awaited<ReturnType<typeof inventoryOf>>,
    signal: AbortSignal,
  ): Promise<IndexCoverage> {
    const path = await this.existingPath(root)
    const known =
      path === undefined
        ? []
        : await this.useDatabase(path, (connection) =>
            connection.run<IndexedDocument[]>({ kind: 'inspect', partition: PARTITION }, signal),
          )
    const stored = new Set(known.map(versionOf))
    const indexed = candidates.filter(({ document }) => stored.has(versionOf(document))).length
    const liveIds = new Set(candidates.map(({ document }) => document.artifactId))
    return {
      indexed,
      total: candidates.length,
      unreadable,
      obsolete: known.filter(({ artifactId }) => !liveIds.has(artifactId)).length,
    }
  }

  async rebuild(
    store: ParsedArtifactStore,
    externalSignal: AbortSignal,
    authorize: () => void = () => {},
    report?: (done: number, total: number) => void,
  ): Promise<void> {
    const signal = AbortSignal.any([externalSignal, this.shutdown.signal])
    signal.throwIfAborted()
    if (this.rebuilding)
      throw new ZoteroError(
        'A parsed index rebuild is already running.',
        ZOTERO_PROVIDER_UNAVAILABLE,
      )
    this.rebuilding = true
    const inventory = inventoryOf(store, signal)
    const progress = {
      root: store.root,
      done: 0,
      total: 0,
      coverage: inventory.then(async (entries) => await this.coverage(store.root, entries, signal)),
    }
    this.rebuildProgress = progress
    const cancelled = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
    const cancel = () => {
      Atomics.store(cancelled, 0, 1)
    }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      await progress.coverage
      const { candidates } = await inventory
      progress.total = candidates.length
      report?.(0, progress.total)
      const path = await this.path(store.root, true)
      await this.useDatabase(path, async (connection) => {
        const scratch = await mkdtemp(join(dirname(path), '.index-rebuild-'))
        const stage = join(scratch, 'staging.db')
        let attached = false
        try {
          await (await open(stage, 'wx', 0o600)).close()
          signal.throwIfAborted()
          await connection.run({ kind: 'rebuild-start', path: stage })
          attached = true
          for (const candidate of candidates) {
            signal.throwIfAborted()
            const markdown = await readMarkdown(store, candidate)
            signal.throwIfAborted()
            await connection.run({ kind: 'rebuild-stage', document: candidate.document, markdown })
            progress.done += 1
            if (
              progress.done === progress.total ||
              progress.done % Math.max(1, Math.ceil(progress.total / 100)) === 0
            )
              report?.(progress.done, progress.total)
          }
          const versions = new Set(candidates.map(({ document }) => versionOf(document)))
          await store.withSourcePublicationLock(async () => {
            const current = (await inventoryOf(store, signal)).candidates
            if (
              current.length !== versions.size ||
              current.some(({ document }) => !versions.has(versionOf(document)))
            )
              throw new ZoteroError(
                'Parsed documents changed during the rebuild. Run the rebuild again.',
                ZOTERO_PROVIDER_UNAVAILABLE,
              )
            signal.throwIfAborted()
            authorize()
            await connection.run({ kind: 'rebuild-commit', partition: PARTITION, cancelled })
          }, signal)
        } finally {
          try {
            if (attached && !this.shutdown.signal.aborted)
              await connection.run({ kind: 'rebuild-drop' }).catch(() => connection.close())
          } finally {
            await rm(scratch, { recursive: true, force: true })
          }
        }
      })
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof ZoteroError) throw error
      throw new ZoteroError('The parsed index could not be rebuilt.', ZOTERO_FILE_UNREADABLE, {
        cause: error,
      })
    } finally {
      signal.removeEventListener('abort', cancel)
      this.rebuildProgress = undefined
      this.rebuilding = false
    }
  }

  async discard(root: string, artifactId: string): Promise<void> {
    const path = await this.existingPath(root)
    if (path === undefined) return
    await this.useDatabase(path, (connection) =>
      connection.run({ kind: 'discard', root: ROOT_PARTITION, artifactId }),
    )
  }

  async search(deps: SearchDependencies, request: SearchRequest, externalSignal: AbortSignal) {
    const signal = AbortSignal.any([externalSignal, this.shutdown.signal])
    signal.throwIfAborted()
    if (this.active)
      throw new ZoteroError(
        'A parsed document search is already running. Retry after it completes.',
        ZOTERO_PROVIDER_UNAVAILABLE,
      )
    this.active = true
    try {
      const path = await this.path(deps.store.root, true)
      return await this.useDatabase(path, (connection) =>
        this.searchActive(deps, request, connection, signal),
      )
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof ZoteroError) throw error
      throw new ZoteroError(
        'The parsed document index could not complete the search.',
        ZOTERO_FILE_UNREADABLE,
        { cause: error },
      )
    } finally {
      this.active = false
    }
  }

  async publish(store: ParsedArtifactStore, artifactId: string): Promise<void> {
    const signal = this.shutdown.signal
    const path = await this.path(store.root, true)
    await this.useDatabase(path, (connection) =>
      this.indexCurrent(store, artifactId, connection, signal),
    )
  }

  private async indexCurrent(
    store: ParsedArtifactStore,
    artifactId: string,
    connection: IndexConnection,
    signal: AbortSignal,
    expected?: IndexedDocument,
  ): Promise<void> {
    await store.withSourcePublicationLock(async () => {
      const stored = await store.metaFor(artifactId)
      if (stored === undefined) return
      const document = indexedDocument(artifactId, stored.meta)
      if (
        expected !== undefined &&
        (document.generation !== expected.generation || document.digest !== expected.digest)
      )
        throw new ZoteroError(
          'A parsed document changed during indexing. Run the query again.',
          ZOTERO_PROVIDER_UNAVAILABLE,
        )
      const markdown = await readMarkdown(store, { document, meta: stored.meta })
      // Keep the filesystem lock until SQLite settles even if the caller
      // cancels. Otherwise a discard could overtake an in-flight put.
      signal.throwIfAborted()
      await connection.run({
        kind: 'put',
        partition: PARTITION,
        document,
        markdown,
      })
    }, signal)
  }

  private async searchActive(
    deps: SearchDependencies,
    request: SearchRequest,
    connection: IndexConnection,
    signal: AbortSignal,
  ) {
    const { store } = deps
    const run = <T>(operation: IndexOperation) => connection.run<T>(operation, signal)
    const partition = PARTITION
    const known = await run<IndexedDocument[]>({ kind: 'known', partition })
    const versions = new Map(known.map((doc) => [doc.artifactId, doc]))
    const explicit = request.scope.kind === 'artifacts'
    const snapshot = explicit ? undefined : await store.snapshot()
    const ids =
      request.scope.kind === 'artifacts'
        ? [...new Set(request.scope.artifactIds)]
        : [
            ...new Set([
              ...Object.values(snapshot!.sources).map((record) => record.cacheKey),
              ...(await store.listArtifactDirectories()),
            ]),
          ]
    const inventory = await mapWithConcurrency(
      ids,
      8,
      async (artifactId) => ({
        artifactId,
        stored: await store.metaFor(artifactId),
      }),
      { signal },
    )
    const stale: IndexedDocument[] = []
    const present = new Set<string>()
    for (const { artifactId, stored } of inventory) {
      if (stored === undefined) continue
      present.add(artifactId)
      const document = indexedDocument(artifactId, stored.meta)
      const old = versions.get(artifactId)
      if (old?.generation !== document.generation || old.digest !== document.digest)
        await this.indexCurrent(store, artifactId, connection, signal, document)
    }
    const requested = new Set(ids)
    for (const doc of known)
      if (!present.has(doc.artifactId) && (!explicit || requested.has(doc.artifactId)))
        stale.push(doc)
    if (stale.length !== 0)
      await store.withSourcePublicationLock(async () => {
        const absent: IndexedDocument[] = []
        for (const doc of stale)
          if ((await store.metaFor(doc.artifactId)) === undefined) absent.push(doc)
        signal.throwIfAborted()
        await connection.run({ kind: 'prune', partition, stale: absent })
      }, signal)
    let entries: readonly Entry[]
    let collection: string | undefined
    let verifyAuthority: (() => Promise<string>) | undefined
    if (request.scope.kind === 'artifacts') {
      entries = inventory.map(({ artifactId, stored }) => {
        return stored === undefined
          ? { gap: 'missing' as const }
          : { candidate: { document: indexedDocument(artifactId, stored.meta), meta: stored.meta } }
      })
    } else {
      const collectionRef =
        request.scope.kind === 'collection'
          ? parseSupportedRef(request.scope.ref, ['collection'])
          : undefined
      const library =
        request.scope.kind === 'library'
          ? request.scope.library
          : (collectionRef!.library as SupportedLocalLibrary)
      collection = collectionRef?.key
      const provider = deps.provider()
      const server = await provider.parsedSearchAuthority(
        library,
        collection,
        collectionRef?.serverId,
        signal,
      )
      verifyAuthority = () => provider.parsedSearchAuthority(library, collection, server, signal)
      entries = await mapWithConcurrency(
        inventory,
        8,
        async ({ artifactId, stored }, workSignal) => {
          const meta = stored?.meta
          if (meta === undefined) return undefined
          return await this.libraryEntry(
            deps,
            provider,
            snapshot!,
            library,
            server,
            artifactId,
            meta,
            workSignal,
          )
        },
        { signal },
      )
    }

    const documents = new Map<string, Candidate>()
    const allowed: IndexedDocument[] = []
    const coverage: Coverage = {
      status: 'complete',
      discovered: 0,
      searchable: 0,
      stale: 0,
      missing: 0,
    }
    for (const entry of entries) {
      if (entry === undefined) continue
      if ('gap' in entry) {
        if (collection !== undefined && !entry.collectionKeys?.includes(collection)) continue
        coverage.discovered++
        coverage[entry.gap]++
        continue
      }
      const { candidate } = entry
      documents.set(candidate.document.artifactId, candidate)
      if (collection !== undefined && !candidate.attachment?.collectionKeys?.includes(collection))
        continue
      coverage.discovered++
      coverage.searchable++
      allowed.push(candidate.document)
    }
    if (coverage.missing + coverage.stale > 0)
      coverage.status = coverage.searchable === 0 ? 'unavailable' : 'partial'

    const variants = queryTextsOf(request.query, request.variants).map(queryTermsOf)
    const matched = await run<IndexedPassage[]>({
      kind: 'match',
      partition,
      allowed,
      variants,
      limit: request.limit,
      isolate: request.scope.kind === 'artifacts',
    })
    const current = explicit ? undefined : await store.snapshot()
    const hits = []
    // SQLite is derived data. Resolve passages from the current verified
    // Markdown once per returned artifact, then emit their exact spans.
    const byArtifact = new Map<string, IndexedPassage[]>()
    for (const match of matched) {
      const bucket = byArtifact.get(match.artifactId) ?? []
      bucket.push(match)
      byArtifact.set(match.artifactId, bucket)
    }
    const positions = new Map(matched.map((match, index) => [match, index]))
    for (const [artifactId, passages] of byArtifact) {
      signal.throwIfAborted()
      const candidate = documents.get(artifactId)!
      const latest = await store.metaFor(artifactId)
      const origin = candidate.origin
      if (
        latest?.meta.generation !== candidate.document.generation ||
        latest.meta.markdownSha256 !== candidate.document.digest ||
        (origin !== undefined && !sameRecord(origin.record, current!.sources[origin.key]))
      )
        throw new ZoteroError(
          'A parsed document changed during search. Run the query again.',
          ZOTERO_PROVIDER_UNAVAILABLE,
        )
      if (origin !== undefined) {
        const fresh = await deps.provider().parsedSearchAttachment(origin.ref, signal)
        if (
          fresh.item?.ref !== candidate.attachment?.item?.ref ||
          (collection !== undefined && !fresh.collectionKeys?.includes(collection)) ||
          !(await deps.probe(origin.ref, origin.record, latest.meta, signal))
        )
          throw new ZoteroError(
            'The source or collection changed during parsed search. Run the query again.',
            ZOTERO_PROVIDER_UNAVAILABLE,
          )
      }
      // Always read and validate the file at the time of delivery. The artifact
      // may have been discarded or replaced since backfill began.
      const markdown = await readMarkdown(store, candidate)
      for (const match of passages) {
        if (
          !Number.isSafeInteger(match.start) ||
          !Number.isSafeInteger(match.end) ||
          match.start < 0 ||
          match.end <= match.start ||
          match.end > markdown.length
        )
          throw new Error('The parsed index returned an invalid Markdown span.')
        hits.push({
          position: positions.get(match)!,
          artifactId,
          sourceId: candidate.document.sourceId,
          generation: match.generation,
          mode: candidate.meta.mode,
          fingerprint: candidate.meta.contentFingerprint,
          start: match.start,
          end: match.end,
          heading: match.heading,
          text: markdown.slice(match.start, match.end),
          ...(candidate.attachment === undefined
            ? candidate.meta.identity.startsWith('zotero://')
              ? { attachmentRef: candidate.meta.identity }
              : {}
            : { attachmentRef: candidate.attachment.attachmentRef }),
          ...(candidate.attachment?.item === undefined
            ? {}
            : { itemRef: candidate.attachment.item.ref }),
        })
      }
    }
    await verifyAuthority?.()
    signal.throwIfAborted()
    return {
      query: request.query,
      queryTerms: [...new Set(variants.flat())],
      coverage,
      passages: hits
        .sort((a, b) => a.position - b.position)
        .map(({ position: _position, ...hit }) => hit),
    }
  }

  private async libraryEntry(
    deps: SearchDependencies,
    provider: Provider,
    snapshot: Snapshot,
    library: SupportedLocalLibrary,
    server: string,
    artifactId: string,
    meta: ParsedArtifactMeta,
    signal: AbortSignal,
  ): Promise<Entry> {
    if (!meta.identity.startsWith('zotero://')) return undefined
    const ref = parseSupportedRef(meta.identity, ['attachment'])
    if (
      ref.library.type !== library.type ||
      ref.library.id !== library.id ||
      (ref.serverId !== undefined && ref.serverId !== server)
    )
      return undefined
    const qualified = formatRef({ ...ref, serverId: server })
    const boundKey = sourceKeyOf(qualified)
    const key = snapshot.sources[boundKey] === undefined ? meta.sourceId : boundKey
    const record = snapshot.sources[key]
    // Superseded or orphaned artifacts are available by explicit id only.
    if (record?.cacheKey !== artifactId) return undefined
    let attachment: Attachment | undefined
    try {
      attachment = await provider.parsedSearchAttachment(qualified, signal)
      if (
        record.generation !== meta.generation ||
        record.fingerprint !== meta.contentFingerprint ||
        record.parser !== meta.parser ||
        record.format !== meta.format ||
        !(await deps.probe(qualified, record, meta, signal))
      )
        return { gap: 'stale', collectionKeys: attachment.collectionKeys }
      return {
        candidate: {
          document: indexedDocument(artifactId, meta),
          meta,
          attachment,
          origin: { key, record, ref: qualified },
        },
      }
    } catch (error) {
      if (unavailable(error) || (error as NodeJS.ErrnoException).code === 'ENOENT')
        return {
          gap: 'missing',
          ...(attachment?.collectionKeys === undefined
            ? {}
            : { collectionKeys: attachment.collectionKeys }),
        }
      throw error
    }
  }
}
