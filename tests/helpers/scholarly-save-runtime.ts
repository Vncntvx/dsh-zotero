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
    }),
    keys: () => ({}),
    maxResults: () => 10,
    zoteroService: () => ({
      search: async () => {
        throw new Error('Saving must not perform an implicit search')
      },
      createItem: async () => {
        writes++
        return outcome
      },
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
