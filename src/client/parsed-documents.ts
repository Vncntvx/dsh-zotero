/** Complete document preparation owned by the host resource model, outside React. */
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import { RemoteError, remoteErrorOf, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ZoteroArtifactMetadataView,
  ZoteroDocumentArtifactRequestView,
  ZoteroDocumentArtifactResultView,
} from '../contract.ts'
import { ZOTERO_ARTIFACT_PAGE_CHARS } from '../contract.ts'
import { parsedDisplayMarkdown } from './parsed-markdown.ts'
import { parseParsedTabAddress, parsedTabAddress } from './parsed-tab.ts'
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
        const document = await this.prepare(target.sessionId, target.ref, abort.signal, (next) => {
          if (generation === entry.generation)
            this.publish(entry, {
              ok: true,
              value: {
                phase: 'preparing',
                progress: next,
                ...(entry.document !== undefined ? { document: entry.document } : {}),
              },
            })
        })
        if (entry.closed || generation !== entry.generation || abort.signal.aborted) {
          this.revoke(document)
          return
        }
        const previous = entry.document
        entry.document = document
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
    this.refresh(parsedTabAddress({ sessionId, ref, title: '' }))
  }

  private async call(request: ZoteroDocumentArtifactRequestView, signal: AbortSignal) {
    const result = await this.read(request, signal)
    signal.throwIfAborted()
    if (!result.ok) throw result.error
    return result.value
  }

  private async prepare(
    sessionId: string,
    ref: string,
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
      const opened = await this.call(
        { sessionId, op: 'open', requestId, target: { kind: 'attachment', ref } },
        combined,
      )
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
