/** Minimal host tool runtime shared by independent verification lanes. */
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import ToolRuntime, { projectToolSchema } from '@deepseek-ai/dsh-tools'
import { ToolExecutionPipeline, executeToolBatch } from '@deepseek-ai/dsh-tools/pipeline'

/** Mount the prompt and its required registry, optionally isolated from the plugin under test. */
export async function mountSystemPrompt(ctx: Context): Promise<void> {
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, {})
}

/** The caller owns and must dispose the returned root context. */
export async function bootToolContext(): Promise<Context> {
  const ctx = new Context()
  try {
    await mountSystemPrompt(ctx)
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
