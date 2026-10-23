/// <reference lib="esnext.disposable" />
/** Execute the write bridge through the real output-schema/render/meta pipeline. */
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { ZoteroCreateItemOutcome } from '../../src/types.js'
import { createScholarlySaveToZoteroTool } from '../../src/scholarly/tools/save-to-zotero.js'
import { createScholarlyHttp } from '../../src/scholarly/transport/http.js'

export async function scholarlySaveReceipt(outcome: ZoteroCreateItemOutcome) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  const runtime = ctx.plugin(ToolRuntime, {})
  await runtime
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
    const result = await ctx.tools.execute({
      callId: ToolCallId('save-receipt'),
      name: tool.name,
      arguments: { title: 'A study' },
      signal: new AbortController().signal,
      agent: {} as never,
    })
    if (result.isError) throw new Error(result.error.message)
    return { result, writes, view: tool.presentResult?.({ title: 'A study' }, result) }
  } finally {
    unregister()
    await runtime.dispose()
  }
}
