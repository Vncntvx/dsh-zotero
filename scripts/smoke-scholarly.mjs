/** Manual network acceptance: build first, then run against the real index socket stack. */
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ScholarlyService from '../lib/scholarly/service.js'
import { egressRouteFor } from '../lib/transport/connections.js'

const doi = '10.1038/nature14539'
const ctx = new Context()
try {
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, {})
  await ctx.plugin(ScholarlyService, {})
  const pipeline = new ToolExecutionPipeline(ctx)
  const prepared = await pipeline.prepare({
    callId: ToolCallId('scholarly-live-socket-probe'),
    name: 'scholarly_get',
    arguments: { id: doi },
    signal: AbortSignal.timeout(60_000),
  })
  const outcome = prepared.kind === 'dispatch' ? await pipeline.dispatch(prepared.exec) : prepared
  const result = await pipeline.complete(prepared.exec, outcome)
  assert.equal(result.isError, false, JSON.stringify(result))
  const value = result.value
  assert.ok(value && typeof value === 'object' && !Array.isArray(value))
  assert.ok(Array.isArray(value.papers), 'scholarly_get must return its canonical paper array')
  const papers = /** @type {{ doi?: string, title: string, sources: unknown[] }[]} */ (
    /** @type {unknown} */ (value.papers)
  )
  const paper = papers.find((paper) => paper.doi?.toLowerCase() === doi)
  assert.ok(paper, `The real indexes must return the requested DOI: ${JSON.stringify(value)}`)
  assert.equal(paper.title.trim().toLowerCase(), 'deep learning')
  assert.ok(paper.sources.length > 0, 'At least one actual index must confirm this work')
  const report = {
    checkedAt: new Date().toISOString(),
    status: 'passed',
    doi,
    title: paper.title,
    sources: paper.sources,
    issues: value.issues ?? [],
    configuredRoutes: Object.fromEntries(
      ['api.crossref.org', 'api.openalex.org', 'api.semanticscholar.org', 'www.ebi.ac.uk'].map(
        (host) => [host, egressRouteFor(new URL(`https://${host}`)).proxied ? 'proxy' : 'direct'],
      ),
    ),
    scope:
      'Real published harness tool pipeline and production DNS/undici/TLS/proxy selection; no fake dispatcher or fetch fixture. This invocation does not exercise every address-refusal or proxy configuration.',
  }
  if (process.argv[2]) await writeFile(process.argv[2], `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
} finally {
  await ctx.fiber.dispose()
}
