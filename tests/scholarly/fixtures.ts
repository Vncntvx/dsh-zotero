import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ScholarlyTextStore } from '../../src/scholarly/fulltext/store.js'
import { type ScholarlyReadHost } from '../../src/scholarly/tools/index.js'
import { createScholarlyHttp, type ScholarlyHttp } from '../../src/scholarly/transport/http.js'
import { HostPacer } from '../../src/scholarly/transport/pacing.js'
import type { ZoteroServiceLike } from '../../src/scholarly/zotero-link.js'

/**
 * Boot the context the scholarly component mounts on: the system prompt (it
 * owns a prompt section) and the tool runtime (it registers seven tools).
 *
 * The component itself is not mounted here. A spec that needs it mounts it on
 * this context; a spec that needs it with a specific config constructs it
 * directly, because mounting it twice would register one tool name twice.
 * @returns the booted context.
 */
export async function bootScholarlyContext(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, {})
  return ctx
}

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
  })
}

export function createMockHost(http: ScholarlyHttp, zotero?: ZoteroServiceLike): ScholarlyReadHost {
  return {
    http,
    keys: () => ({ email: 'test@example.com' }),
    maxResults: () => 10,
    maxContentChars: () => 10_000,
    cache: new ScholarlyTextStore(mkdtempSync(join(tmpdir(), 'scholarly-tools-'))),
    zoteroService: () => zotero,
  }
}

/**
 * The minimal execution context a tool body reads: only its cancellation signal.
 * Typed explicitly so the exported binding has a nameable type.
 */
export const EXEC_CONTEXT: { readonly signal: AbortSignal } = {
  signal: new AbortController().signal,
}

/**
 * The single `[n] …` result line from a verify summary, excluding the legend
 * that also names every badge. Asserting on the whole text would match a
 * legend word rather than this reference's own verdict.
 * @param text - the tool output.
 * @returns the result block.
 */
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

export function itemLineOf(text: string): string {
  const start = text.indexOf('[1]')
  return start < 0 ? text : text.slice(start)
}
