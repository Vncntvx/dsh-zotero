/** Cancelable per-service archive admission; a slot lasts through persistence. */
import { Worker } from 'node:worker_threads'
import { z } from 'zod'
import {
  ARTIFACT_READER_DEFAULTS,
  type ArtifactReaderPreferences,
} from '../artifact-reader-preferences.js'
import {
  ARTIFACT_IMAGE_NAME_PATTERN,
  ARCHIVE_MAX_IMAGES,
  ARCHIVE_MAX_IMAGE_BYTES,
  ARCHIVE_MAX_IMAGE_TOTAL_BYTES,
} from '../artifact-images.js'
import {
  ZoteroError,
  ZOTERO_ENRICHMENT_ARCHIVE_INVALID,
  ZOTERO_ENRICHMENT_TASK_FAILED,
} from '../errors.js'
import { ZIP_MAX_ARCHIVE_BYTES, ZIP_MAX_FILE_BYTES } from './archive-limits.js'
import type { ExtractedParsedFiles, NormalizedContentList } from './zip.js'

const resultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(false), message: z.string().max(4096) }).strict(),
  z
    .object({
      ok: z.literal(true),
      files: z
        .object({
          markdown: z.string().min(1).max(ZIP_MAX_FILE_BYTES),
          contentList: z.string().max(ZIP_MAX_FILE_BYTES).optional(),
          images: z
            .array(
              z
                .object({
                  name: z.string().regex(ARTIFACT_IMAGE_NAME_PATTERN),
                  mediaType: z.enum([
                    'image/png',
                    'image/jpeg',
                    'image/gif',
                    'image/webp',
                    'image/bmp',
                  ]),
                  data: z
                    .instanceof(Uint8Array)
                    .refine(
                      (data) => data.byteLength > 0 && data.byteLength <= ARCHIVE_MAX_IMAGE_BYTES,
                    ),
                })
                .strict(),
            )
            .max(ARCHIVE_MAX_IMAGES),
        })
        .strict()
        .refine(
          (files) =>
            files.images.reduce((total, image) => total + image.data.byteLength, 0) <=
            ARCHIVE_MAX_IMAGE_TOTAL_BYTES,
        ),
    })
    .strict(),
])

export type ArchiveWorkerFactory = (entry: URL, bytes: Uint8Array) => Worker

/** Source launches use Node's native TypeScript support; published launches use only emitted JS. */
const spawnWorker: ArchiveWorkerFactory = (entry, bytes) => {
  if (!import.meta.url.endsWith('.ts'))
    return new Worker(entry, {
      workerData: bytes,
      transferList: [bytes.buffer as ArrayBuffer],
      execArgv: [],
    })
  const source = new URL('./zip-worker.ts', import.meta.url)
  const root = new URL('../', import.meta.url).href
  const bootstrap = `import { registerHooks } from 'node:module';
registerHooks({resolve(s,c,n){if(s.startsWith('.')&&s.endsWith('.js')&&c.parentURL?.startsWith(${JSON.stringify(root)}))return n(s.slice(0,-3)+'.ts',c);return n(s,c)}});
await import(${JSON.stringify(source.href)});`
  return new Worker(new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`), {
    workerData: bytes,
    transferList: [bytes.buffer as ArrayBuffer],
    execArgv: [],
  })
}

interface Waiting {
  readonly signal: AbortSignal
  readonly resolve: (release: () => void) => void
  readonly reject: (error: unknown) => void
  abort(): void
}

export class ArchiveProcessor {
  private running = 0
  private readonly queue: Waiting[] = []
  constructor(
    private readonly policy: () => ArtifactReaderPreferences = () => ARTIFACT_READER_DEFAULTS,
    private readonly factory: ArchiveWorkerFactory = spawnWorker,
  ) {}

  private release = (): void => {
    this.running--
    this.drain()
  }
  private drain(): void {
    while (this.running < this.policy().archiveConcurrency && this.queue.length > 0) {
      const next = this.queue.shift()!
      next.signal.removeEventListener('abort', next.abort)
      if (next.signal.aborted) {
        next.reject(next.signal.reason)
        continue
      }
      this.running++
      next.resolve(this.release)
    }
  }
  private async acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted()
    if (this.running < this.policy().archiveConcurrency) {
      this.running++
      return this.release
    }
    if (this.queue.length >= this.policy().archiveQueueLimit)
      throw new ZoteroError(
        'Archive processing is busy. Retry the parsing operation later.',
        ZOTERO_ENRICHMENT_TASK_FAILED,
      )
    return await new Promise((resolve, reject) => {
      const entry: Waiting = {
        signal,
        resolve,
        reject,
        abort: () => {
          const index = this.queue.indexOf(entry)
          if (index !== -1) this.queue.splice(index, 1)
          reject(signal.reason)
        },
      }
      this.queue.push(entry)
      signal.addEventListener('abort', entry.abort, { once: true })
      if (signal.aborted) entry.abort()
    })
  }
  async run<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> {
    const release = await this.acquire(signal)
    try {
      signal.throwIfAborted()
      return await task()
    } finally {
      release()
    }
  }

  async extract(input: Uint8Array, signal: AbortSignal): Promise<ExtractedParsedFiles> {
    signal.throwIfAborted()
    if (input.byteLength > ZIP_MAX_ARCHIVE_BYTES)
      throw new ZoteroError(
        'The result archive exceeds its size ceiling.',
        ZOTERO_ENRICHMENT_ARCHIVE_INVALID,
      )
    // Copy at this ownership boundary: detaching a pooled or shared download buffer is forbidden.
    const bytes = new Uint8Array(input)
    const worker = this.factory(new URL('./zip-worker.js', import.meta.url), bytes)
    return await new Promise((resolve, reject) => {
      let settled = false
      const settle = (finish: () => void): void => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', abort)
        worker.removeAllListeners()
        // Keep an error listener until termination completes, including errors racing cancellation.
        worker.on('error', () => {})
        void worker.terminate().then(finish, finish)
      }
      const abort = () => settle(() => reject(signal.reason))
      worker.once('message', (message: unknown) => {
        const result = resultSchema.safeParse(message)
        settle(() => {
          if (!result.success)
            reject(
              new ZoteroError(
                'The archive worker returned an invalid result.',
                ZOTERO_ENRICHMENT_TASK_FAILED,
              ),
            )
          else if (!result.data.ok)
            reject(new ZoteroError(result.data.message, ZOTERO_ENRICHMENT_ARCHIVE_INVALID))
          else {
            const { contentList, ...files } = result.data.files
            resolve({
              ...files,
              ...(contentList !== undefined
                ? { contentList: contentList as NormalizedContentList }
                : {}),
            })
          }
        })
      })
      worker.once('error', (error) =>
        settle(() =>
          reject(
            new ZoteroError(
              `Archive worker failed: ${error.message}`,
              ZOTERO_ENRICHMENT_TASK_FAILED,
            ),
          ),
        ),
      )
      worker.once('exit', (code) =>
        settle(() =>
          reject(
            new ZoteroError(
              `Archive worker exited without a result (${code}).`,
              ZOTERO_ENRICHMENT_TASK_FAILED,
            ),
          ),
        ),
      )
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
  }
}
