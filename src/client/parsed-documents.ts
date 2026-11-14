/** Complete document preparation owned by the host resource model, outside React. */
import { useEffect, useMemo, useState } from 'react'
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import { RemoteError, remoteErrorOf, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ZoteroArtifactMetadataView,
  ZoteroDocumentArtifactRequestView,
  ZoteroDocumentArtifactResultView,
  ZoteroParseTargetView,
} from '../contract.ts'
import { ZOTERO_ARTIFACT_PAGE_CHARS } from '../contract.ts'
import { parsedDisplayMarkdown } from './parsed-markdown.ts'
import { parseParsedTabAddress, type ParsedTabTarget } from './parsed-tab.ts'
import { isGenericParsedTitle } from '../parsed-title.ts'
import { en, type ZoteroLocaleKey } from './locales.ts'

export type ParsedArtifactRead = (
  request: ZoteroDocumentArtifactRequestView,
  signal?: AbortSignal,
) => Promise<RemoteResult<ZoteroDocumentArtifactResultView>>
export interface PreparedParsedDocument {
  readonly metadata: ZoteroArtifactMetadataView
  readonly text: string
  readonly display: string
  readonly images: Readonly<Record<string, string>>
  readonly bytes: number
}
export interface ParsedDocumentProgress {
  readonly pages: number
  readonly totalPages: number
  readonly images: number
  readonly totalImages: number
}
export interface ParsedDocumentResource {
  readonly phase: 'preparing' | 'ready' | 'denied'
  readonly message?: string
  readonly document?: PreparedParsedDocument
  readonly progress: ParsedDocumentProgress
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap {
    'zotero-parsed': ParsedDocumentResource
  }
}

interface AccessSource {
  getSnapshot(): boolean
  subscribe(listener: () => void): () => void
}
interface Entry {
  readonly address: string
  readonly listeners: Set<() => void>
  frame: RemoteResult<ParsedDocumentResource>
  document?: PreparedParsedDocument
  /** Set once a read opens; a discard refresh only touches matching tabs. */
  artifactId?: string
  abort?: AbortController
  work: Promise<void>
  generation: number
  closed: boolean
}
const progress = (): ParsedDocumentProgress => ({
  pages: 0,
  totalPages: 0,
  images: 0,
  totalImages: 0,
})
const failure = (message: string) => new RemoteError('gateway/internal', message, {})
type MessageKey = Extract<ZoteroLocaleKey, `parsedError${string}`> | 'parsedReadDenied'
interface PreparationOptions {
  readonly decode?: (url: string, signal: AbortSignal) => Promise<void>
  readonly translate?: (key: MessageKey) => string
}

/** Decode before publishing, so a corrupt image fails preparation beside the retained document. */
export async function decodeParsedFigure(url: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      image.onload = null
      image.onerror = null
      if (error !== undefined) {
        image.src = ''
        reject(error)
      } else resolve()
    }
    const abort = () => finish(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    image.onload = () => finish()
    image.onerror = () => finish(failure(en.parsedErrorFigureDecode))
    image.src = url
    if (signal.aborted) abort()
  })
}

export class ParsedDocuments implements ResourceProvider<'zotero-parsed'> {
  readonly protocol = 'zotero-parsed' as const
  private readonly entries = new Map<string, Entry>()
  private bytes = 0
  /** Lease-free tab titles keyed by address; `missing` entries re-resolve. */
  private readonly titles = new Map<string, ParsedTitleMeta>()
  private readonly titleListeners = new Map<string, Set<(meta: ParsedTitleMeta) => void>>()
  private readonly titleReads = new Map<string, AbortController>()
  /** Bumped by every commit and discard, so derived views re-probe without polling. */
  private probeGenerations = 0
  private readonly probeListeners = new Set<() => void>()
  readonly probeRevision = {
    getSnapshot: () => this.probeGenerations,
    subscribe: (listener: () => void): (() => void) => {
      this.probeListeners.add(listener)
      return () => {
        this.probeListeners.delete(listener)
      }
    },
  }

  private bumpProbeRevision(): void {
    this.probeGenerations++
    for (const listener of this.probeListeners) listener()
  }
  constructor(
    private readonly read: ParsedArtifactRead,
    private readonly access: (sessionId: string) => AccessSource,
    private readonly cleanupFailure: (error: unknown) => void,
    private readonly options: PreparationOptions = {},
  ) {}

  private message(key: MessageKey): string {
    return this.options.translate?.(key) ?? en[key]
  }

  private failure(key: MessageKey): ReturnType<typeof failure> {
    return failure(this.message(key))
  }

  private publish(entry: Entry, frame: RemoteResult<ParsedDocumentResource>): void {
    entry.frame = frame
    for (const notify of entry.listeners) notify()
  }
  private revoke(document: PreparedParsedDocument): void {
    for (const url of Object.values(document.images)) URL.revokeObjectURL(url)
    this.bytes -= document.bytes
  }

  async *open(
    address: string,
    { signal }: { signal: AbortSignal },
  ): AsyncIterable<RemoteResult<ParsedDocumentResource>> {
    const target = parseParsedTabAddress(address)
    if (target === undefined) {
      yield { ok: false, error: this.failure('parsedErrorAddress') }
      return
    }
    const entry: Entry = {
      address,
      listeners: new Set(),
      frame: { ok: true, value: { phase: 'preparing', progress: progress() } },
      work: Promise.resolve(),
      generation: 0,
      closed: false,
    }
    this.entries.set(address, entry)
    const access = this.access(target.sessionId)
    const denied = () => {
      entry.generation++
      entry.abort?.abort()
      if (entry.document !== undefined) {
        this.revoke(entry.document)
        delete entry.document
      }
      this.publish(entry, {
        ok: true,
        value: {
          phase: 'denied',
          message: this.message('parsedReadDenied'),
          progress: progress(),
        },
      })
    }
    let allowed = access.getSnapshot()
    const detach = access.subscribe(() => {
      const next = access.getSnapshot()
      if (!next) denied()
      else if (!allowed) this.refresh(address)
      allowed = next
    })
    let revision = 0
    let wake: (() => void) | undefined
    const notify = () => {
      revision++
      wake?.()
      wake = undefined
    }
    entry.listeners.add(notify)
    signal.addEventListener('abort', notify)
    if (access.getSnapshot()) this.refresh(address)
    else denied()
    try {
      let observed = -1
      while (!signal.aborted) {
        if (observed !== revision) {
          observed = revision
          yield entry.frame
          continue
        }
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    } finally {
      entry.closed = true
      entry.generation++
      entry.abort?.abort()
      signal.removeEventListener('abort', notify)
      detach()
      await entry.work
      if (entry.document !== undefined) this.revoke(entry.document)
      entry.listeners.clear()
      if (this.entries.get(address) === entry) this.entries.delete(address)
    }
  }

  refresh(address: string): void {
    const entry = this.entries.get(address)
    if (entry === undefined || entry.closed) return
    const target = parseParsedTabAddress(address)
    if (target === undefined || !this.access(target.sessionId).getSnapshot()) return
    const generation = ++entry.generation
    entry.abort?.abort()
    const abort = new AbortController()
    entry.abort = abort
    entry.work = entry.work.then(async () => {
      if (entry.closed || generation !== entry.generation) return
      this.publish(entry, {
        ok: true,
        value: {
          phase: 'preparing',
          progress: progress(),
          ...(entry.document !== undefined ? { document: entry.document } : {}),
        },
      })
      try {
        const document = await this.prepare(
          target.sessionId,
          target.artifactId !== undefined
            ? { kind: 'artifact', artifactId: target.artifactId }
            : { kind: 'attachment', ref: target.ref },
          abort.signal,
          (next) => {
            if (generation === entry.generation)
              this.publish(entry, {
                ok: true,
                value: {
                  phase: 'preparing',
                  progress: next,
                  ...(entry.document !== undefined ? { document: entry.document } : {}),
                },
              })
          },
        )
        if (entry.closed || generation !== entry.generation || abort.signal.aborted) {
          this.revoke(document)
          return
        }
        const previous = entry.document
        entry.document = document
        entry.artifactId = document.metadata.artifactId
        this.publish(entry, {
          ok: true,
          value: {
            phase: 'ready',
            document,
            progress: {
              pages: 1,
              totalPages: 1,
              images: document.metadata.images.length,
              totalImages: document.metadata.images.length,
            },
          },
        })
        if (previous !== undefined) this.revoke(previous)
      } catch (error) {
        if (!entry.closed && generation === entry.generation && !abort.signal.aborted)
          this.publish(entry, {
            ok: false,
            error:
              remoteErrorOf(error) ??
              failure(error instanceof Error ? error.message : String(error)),
          })
      }
    })
  }

  committed(sessionId: string, ref: string): void {
    // Addresses carry presentation values in their query, so open tabs match
    // structurally on (session, ref) rather than by exact address string.
    this.refreshMatching(sessionId, (target) => target.ref === ref)
    this.invalidateTitles(sessionId, (target) => target.ref === ref)
    this.bumpProbeRevision()
  }

  /** A discarded artifact invalidates every open tab bound to it. */
  discarded(sessionId: string, artifactId: string): void {
    this.refreshMatching(
      sessionId,
      (target, bound) => target.artifactId === artifactId || bound === artifactId,
    )
    this.invalidateTitles(sessionId, (target) => target.artifactId === artifactId)
    this.bumpProbeRevision()
  }

  private refreshMatching(
    sessionId: string,
    matches: (target: ParsedTabTarget, boundArtifactId?: string) => boolean,
  ): void {
    for (const [address, entry] of this.entries) {
      const target = parseParsedTabAddress(address)
      if (target === undefined || target.sessionId !== sessionId) continue
      if (matches(target, entry.artifactId)) this.refresh(address)
    }
  }

  /** The cached tab title for one address; `missing` entries re-resolve. */
  titleSnapshot(address: string): ParsedTitleMeta {
    return this.titles.get(address) ?? { state: 'missing' }
  }

  subscribeTitle(address: string, listener: (meta: ParsedTitleMeta) => void): () => void {
    const listeners = this.titleListeners.get(address) ?? new Set()
    listeners.add(listener)
    this.titleListeners.set(address, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0 && this.titleListeners.get(address) === listeners)
        this.titleListeners.delete(address)
    }
  }

  /**
   * Resolve one address's title through the lease-free `meta` arm, once: a
   * non-generic address title needs no read, a cached or in-flight read is
   * kept, and a `missing` result re-resolves on the next invalidation.
   */
  resolveTitle(address: string, target: ParsedTabTarget | undefined): void {
    if (target === undefined || !isGenericParsedTitle(target.title)) return
    const cached = this.titles.get(address)
    if (cached?.state === 'ready' || cached?.state === 'resolving') return
    if (this.titleReads.has(address)) return
    const controller = new AbortController()
    this.titleReads.set(address, controller)
    const request: ZoteroDocumentArtifactRequestView = {
      sessionId: target.sessionId,
      op: 'meta',
      target:
        target.artifactId !== undefined
          ? { kind: 'artifact', artifactId: target.artifactId }
          : { kind: 'attachment', ref: target.ref },
    }
    void this.read(request, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        const value =
          result.ok && result.value.kind !== 'missing' && result.value.kind !== 'expired'
            ? result.value
            : undefined
        if (value === undefined || !('title' in value) || value.title === undefined) {
          this.publishTitle(
            address,
            value === undefined ? { state: 'missing' } : { state: 'ready' },
          )
          return
        }
        this.publishTitle(address, { state: 'ready', title: value.title })
      })
      .catch(() => {
        if (!controller.signal.aborted) this.publishTitle(address, { state: 'missing' })
      })
      .finally(() => {
        if (this.titleReads.get(address) === controller) this.titleReads.delete(address)
      })
  }

  private publishTitle(address: string, meta: ParsedTitleMeta): void {
    this.titles.set(address, meta)
    for (const notify of this.titleListeners.get(address) ?? []) notify(meta)
  }

  private invalidateTitles(sessionId: string, matches: (target: ParsedTabTarget) => boolean): void {
    for (const address of new Set([...this.titleListeners.keys(), ...this.titles.keys()])) {
      const target = parseParsedTabAddress(address)
      if (target === undefined || target.sessionId !== sessionId || !matches(target)) continue
      this.titleReads.get(address)?.abort()
      this.titleReads.delete(address)
      this.titles.delete(address)
      this.publishTitle(address, { state: 'missing' })
      this.resolveTitle(address, target)
    }
  }

  private async call(request: ZoteroDocumentArtifactRequestView, signal: AbortSignal) {
    const result = await this.read(request, signal)
    signal.throwIfAborted()
    if (!result.ok) throw result.error
    return result.value
  }

  private async prepare(
    sessionId: string,
    target: ZoteroParseTargetView,
    signal: AbortSignal,
    report: (value: ParsedDocumentProgress) => void,
  ): Promise<PreparedParsedDocument> {
    const requestId = crypto.randomUUID()
    const abort = new AbortController()
    const combined = AbortSignal.any([signal, abort.signal])
    const images: Record<string, string> = {}
    let reserved = 0
    let published = false
    try {
      const opened = await this.call({ sessionId, op: 'open', requestId, target }, combined)
      if (opened.kind !== 'opened') throw this.failure('parsedErrorMissing')
      reserved =
        opened.characterCount * 6 + opened.images.reduce((total, image) => total + image.bytes, 0)
      if (this.bytes + reserved > opened.policy.preparedMaxBytes) {
        reserved = 0
        throw this.failure('parsedErrorCapacity')
      }
      this.bytes += reserved
      const pages = new Map<number, string>()
      const stats = {
        pages: 0,
        totalPages: Math.max(1, Math.ceil(opened.characterCount / ZOTERO_ARTIFACT_PAGE_CHARS)),
        images: 0,
        totalImages: opened.images.length,
      }
      const acceptPage = (page: typeof opened.page, offset: number) => {
        if (
          page.offset !== offset ||
          page.totalChars !== opened.characterCount ||
          page.text.length !== Math.min(ZOTERO_ARTIFACT_PAGE_CHARS, opened.characterCount - offset)
        )
          throw this.failure('parsedErrorPage')
        pages.set(offset, page.text)
        stats.pages++
        report({ ...stats })
      }
      acceptPage(opened.page, 0)
      const tasks: Array<() => Promise<void>> = []
      for (
        let offset = opened.page.text.length;
        offset < opened.characterCount;
        offset += ZOTERO_ARTIFACT_PAGE_CHARS
      ) {
        tasks.push(async () => {
          const result = await this.call(
            { sessionId, op: 'page', lease: opened.lease, offset },
            combined,
          )
          if (
            result.kind !== 'page' ||
            result.lease !== opened.lease ||
            result.artifactId !== opened.artifactId
          )
            throw this.failure('parsedErrorChanged')
          acceptPage(result.page, offset)
        })
      }
      for (const image of opened.images)
        tasks.push(async () => {
          const result = await this.call(
            { sessionId, op: 'image', lease: opened.lease, name: image.name },
            combined,
          )
          if (
            result.kind !== 'image' ||
            result.lease !== opened.lease ||
            result.artifactId !== opened.artifactId ||
            result.name !== image.name ||
            result.mediaType !== image.mediaType
          )
            throw this.failure('parsedErrorFigureIdentity')
          const bytes = Uint8Array.from(atob(result.base64), (character) => character.charCodeAt(0))
          if (bytes.byteLength !== image.bytes) throw this.failure('parsedErrorFigureSize')
          images[image.name] = URL.createObjectURL(new Blob([bytes], { type: image.mediaType }))
          try {
            await (this.options.decode ?? decodeParsedFigure)(images[image.name]!, combined)
          } catch {
            combined.throwIfAborted()
            throw this.failure('parsedErrorFigureDecode')
          }
          stats.images++
          report({ ...stats })
        })
      let next = 0
      const workers = Array.from(
        { length: Math.min(tasks.length, opened.policy.concurrency) },
        async () => {
          while (!combined.aborted) {
            const task = tasks[next++]
            if (task === undefined) return
            try {
              await task()
            } catch (error) {
              abort.abort(error)
              throw error
            }
          }
        },
      )
      const settled = await Promise.allSettled(workers)
      const rejected = settled.find((result) => result.status === 'rejected')
      if (rejected?.status === 'rejected') throw rejected.reason
      combined.throwIfAborted()
      const text = [...pages.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, value]) => value)
        .join('')
      if (text.length !== opened.characterCount) throw this.failure('parsedErrorIncomplete')
      const display = parsedDisplayMarkdown(text)
      published = true
      return { metadata: opened, text, display, images: Object.freeze(images), bytes: reserved }
    } finally {
      if (!published) {
        for (const url of Object.values(images)) URL.revokeObjectURL(url)
        this.bytes -= reserved
      }
      try {
        const result = await this.read({ sessionId, op: 'release', requestId })
        if (!result.ok) this.cleanupFailure(result.error)
      } catch (error) {
        this.cleanupFailure(error)
      }
    }
  }
}

/** The lease-free title state for one parsed-document tab address. */
export interface ParsedTitleMeta {
  readonly state: 'missing' | 'resolving' | 'ready'
  readonly title?: string
}

/**
 * Subscribe one tab chip to its lease-free title: one `meta` read per
 * unresolved generic title, cached until a commit or discard invalidates it.
 * The body keeps being the only full-document holder.
 */
export function useParsedTitleMeta(
  documents: ParsedDocuments,
  address: string,
  target: ParsedTabTarget | undefined,
): ParsedTitleMeta {
  // The parsed target is rebuilt per render; only its identity matters here.
  const stableTarget = useMemo(
    () => target,
    [target?.sessionId, target?.ref, target?.artifactId, target?.title, target?.item],
  )
  const [snapshot, setSnapshot] = useState<ParsedTitleMeta>(() => documents.titleSnapshot(address))
  useEffect(() => {
    setSnapshot(documents.titleSnapshot(address))
    documents.resolveTitle(address, stableTarget)
    return documents.subscribeTitle(address, setSnapshot)
  }, [documents, address, stableTarget])
  return snapshot
}
