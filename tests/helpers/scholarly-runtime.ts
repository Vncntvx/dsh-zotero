/** Shared scripted scholarly runtime; the importing test owns its Vitest cleanup hooks. */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ScholarlyTextStore } from '../../src/scholarly/fulltext/store.js'
import { ZoteroJobRunner } from '../../src/job-runner.js'
import { bm25EvidenceRanker } from '../../src/local/evidence-ranker.js'
import { type ScholarlyReadHost } from '../../src/scholarly/tools/index.js'
import {
  createScholarlyHttp,
  type ScholarlyHttp,
  type ScholarlyPublicAccess,
} from '../../src/scholarly/transport/http.js'
import { HostPacer } from '../../src/scholarly/transport/pacing.js'
import type {
  AddressResolver,
  HostnamePredicate,
  ResolvedAddress,
} from '../../src/transport/network.js'
import type { ZoteroServiceLike } from '../../src/scholarly/zotero-link.js'

const toolRoots = new Set<string>()
type MockReadHost = ScholarlyReadHost & { cache: ScholarlyTextStore }
const toolHosts = new Set<MockReadHost>()
afterEach(async () => {
  for (const host of toolHosts) {
    host.cache.dispose()
    await host.http.dispose()
  }
  toolHosts.clear()
  await Promise.all([...toolRoots].map((root) => rm(root, { recursive: true, force: true })))
  toolRoots.clear()
})

export { bootToolContext as bootScholarlyContext } from './lanes/tool-context.js'

/** A resolver whose every name answers these addresses. */
export function resolverOf(answers: readonly ResolvedAddress[]): AddressResolver {
  return async () => answers
}

/**
 * The inert public-access stub every mocked transport carries: the fetch
 * replacement never opens a socket, so neither the resolver nor the
 * dispatcher factories are exercised — they only satisfy the seam the
 * transport now requires of every external request. A spec that needs to
 * observe the allowlist pool's fake-IP predicate passes `onPredicate`.
 * @param resolver - the DNS answer the unstubbed seam would return.
 * @param onPredicate - receives the predicate handed to the validating pool.
 * @returns the stub, with inert dispatcher factories.
 */
export function stubPublicAccessWith(
  resolver: AddressResolver,
  onPredicate?: (predicate: HostnamePredicate | undefined) => void,
): ScholarlyPublicAccess {
  return {
    resolver,
    createDispatcher: () => ({ dispatcher: {}, close: async () => {} }),
    createValidatingDispatcher: (predicate) => {
      onPredicate?.(predicate)
      return { dispatcher: {}, close: async () => {} }
    },
  }
}

/** The default stub: one public IPv4 answer and no sockets. */
export const stubPublicAccess: ScholarlyPublicAccess = stubPublicAccessWith(
  resolverOf([{ address: '93.184.216.34', family: 4 }]),
)

export function createMockHttp(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): ScholarlyHttp {
  const pacer = new HostPacer({
    'api.openalex.org': 0,
    'export.arxiv.org': 0,
    'api.crossref.org': 0,
    'doi.org': 0,
    'api.semanticscholar.org': 0,
    'www.ebi.ac.uk': 0,
    'eutils.ncbi.nlm.nih.gov': 0,
    'dblp.org': 0,
  })
  return createScholarlyHttp({
    fetchImpl: async (url, init) => {
      const urlStr = String(url)
      return handler(urlStr, init)
    },
    pacer,
    publicAccess: stubPublicAccess,
  })
}

export function createMockHost(http: ScholarlyHttp, zotero?: ZoteroServiceLike): MockReadHost {
  const root = mkdtempSync(join(tmpdir(), 'scholarly-tools-'))
  toolRoots.add(root)
  const host: MockReadHost = {
    http,
    keys: async () => ({ email: 'test@example.com' }),
    maxResults: () => 10,
    jobPolicy: () => ({
      enableRunInBackground: false,
      promoteOnTimeout: false,
      foregroundWaitMs: 1_000,
    }),
    jobRunner: () => new ZoteroJobRunner(undefined),
    maxContentChars: () => 10_000,
    cache: new ScholarlyTextStore(root),
    // The core's lexical ranker: these fixtures exercise the transport and the
    // section addressing, not a ranking strategy of their own.
    evidenceRanker: () => bm25EvidenceRanker,
    evidenceChunkLimits: () => ({ chunkWords: 200, chunkChars: 6_000 }),
    zoteroService: () => zotero,
  }
  toolHosts.add(host)
  return host
}

/**
 * The minimal execution context a tool body reads: only its cancellation signal.
 * Typed explicitly so the exported binding has a nameable type.
 */
export const EXEC_CONTEXT: { readonly signal: AbortSignal } = {
  signal: new AbortController().signal,
}

/**
 * Commit a value into a volatile reference the way the loader does.
 * @param reference - the live reference.
 * @param value - the new value.
 */
export function writeVolatile<T>(reference: unknown, value: T): void {
  const write = (reference as Record<symbol, unknown>)[Symbol.for('cosmokit.volatile.write')]
  if (typeof write !== 'function') throw new Error('not a volatile reference')
  ;(write as (next: T) => void)(value)
}

/**
 * The single `[n] …` result line from a verify summary, excluding the legend
 * that also names every badge. Asserting on the whole text would match a
 * legend word rather than this reference's own verdict.
 * @param text - the tool output.
 * @returns the result block.
 */
export function itemLineOf(text: string): string {
  const start = text.indexOf('[1]')
  return start < 0 ? text : text.slice(start)
}
