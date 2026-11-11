/// <reference lib="esnext.disposable" />
/** Execute the write bridge through the real output-schema/render/meta pipeline. */
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime, { projectToolSchema } from '@deepseek-ai/dsh-tools'
import { ToolExecutionPipeline, executeToolBatch } from '@deepseek-ai/dsh-tools/pipeline'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { ZoteroCreateItemOutcome } from '../../src/types.js'
import { createScholarlySaveToZoteroTool } from '../../src/scholarly/tools/save-to-zotero.js'
import { createScholarlyHttp } from '../../src/scholarly/transport/http.js'
import { ZoteroJobRunner } from '../../src/job-runner.js'
import { bm25EvidenceRanker } from '../../src/local/evidence-ranker.js'

export async function scholarlySaveReceipt(outcome: ZoteroCreateItemOutcome) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  const runtime = ctx.plugin(ToolRuntime, {})
  await runtime
  ctx.tools.setExecutor({
    describe(tools) {
      return { schemas: tools.map((definition) => projectToolSchema(definition, false)) }
    },
    execute(input) {
      return executeToolBatch(input, new ToolExecutionPipeline(ctx), () => 10)
    },
  })
  let writes = 0
  const tool = createScholarlySaveToZoteroTool({
    http: createScholarlyHttp({
      fetchImpl: async () => {
        throw new Error('Saving must not query an external index')
      },
      // The save tool must never fetch, so the seam is inert here; it only
      // satisfies the transport's every-arm wiring requirement.
      publicAccess: {
        resolver: async () => [{ address: '93.184.216.34', family: 4 }],
        createDispatcher: () => ({ dispatcher: {}, close: async () => {} }),
        createValidatingDispatcher: () => ({ dispatcher: {}, close: async () => {} }),
      },
    }),
    keys: async () => ({}),
    maxResults: () => 10,
    jobPolicy: () => ({
      enableRunInBackground: false,
      promoteOnTimeout: false,
      foregroundWaitMs: 1_000,
    }),
    jobRunner: () => new ZoteroJobRunner(undefined),
    // The save tool never ranks passages, so the seam is the core's own ranker
    // here; it only satisfies the host's every-arm wiring requirement.
    evidenceRanker: () => bm25EvidenceRanker,
    evidenceChunkLimits: () => ({ chunkWords: 200, chunkChars: 6_000 }),
    zoteroService: () => ({
      writeEnabled: () => true,
      search: async () => {
        throw new Error('Saving must not perform an implicit search')
      },
      createItem: async () => {
        writes++
        return outcome
      },
      // The declared core face: the save tool never ranks, but the stub is a
      // ZoteroServiceLike and carries the real defaults.
      evidenceRanker: () => bm25EvidenceRanker,
      evidenceChunkLimits: () => ({ chunkWords: 200, chunkChars: 6_000 }),
    }),
  })
  const unregister = ctx.tools.register(tool)
  try {
    const batch = await ctx.tools.execute({
      calls: [
        {
          type: 'tool-call',
          id: ToolCallId('save-receipt'),
          name: tool.name,
          arguments: JSON.stringify({ title: 'A study' }),
        },
      ],
      signal: new AbortController().signal,
      agent: {} as never,
    })
    const call = batch.results[0]
    if (call === undefined) throw new Error('Tool execution produced no result')
    const result = call.result
    if (result.isError) throw new Error(result.error.message)
    return { result, writes, view: tool.presentResult?.({ title: 'A study' }, result) }
  } finally {
    unregister()
    await runtime.dispose()
  }
}
