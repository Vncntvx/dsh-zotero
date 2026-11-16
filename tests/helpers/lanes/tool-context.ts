/** Minimal host tool runtime shared by independent verification lanes. */
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { projectToolSchema } from '@deepseek-ai/dsh-tools'
import { ToolExecutionPipeline, executeToolBatch } from '@deepseek-ai/dsh-tools/pipeline'

/** The caller owns and must dispose the returned root context. */
export async function bootToolContext(): Promise<Context> {
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime, {})
    ctx.tools.setExecutor({
      describe(tools) {
        return { schemas: tools.map((definition) => projectToolSchema(definition, false)) }
      },
      execute(input) {
        return executeToolBatch(input, new ToolExecutionPipeline(ctx), () => 10)
      },
    })
    return ctx
  } catch (error) {
    await ctx.fiber.dispose()
    throw error
  }
}
