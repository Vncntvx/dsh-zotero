/**
 * The boot every host-lane spec shares: a scripted Zotero Local API, a Cordis
 * context carrying the system prompt and the tool runtime, and the plugin
 * mounted over the mock's base URL.
 *
 * The lane is returned as one object rather than installed by a global setup
 * file, so each spec calls `setupHostLane()` in its own `beforeEach` — or in
 * the test body where the boot varies per case — and `teardown()` in its own
 * `afterEach`: the wiring is visible at the call site that depends on it.
 * `runTool` keeps the call-id scheme the tool specs were written against
 * (`tool-<n>`, counted per lane), so `ctx.tools` sees the assembly it always
 * did. {@link expectValue} lives here too: it settles the success arm of one
 * `runTool` result, which is the one assertion every tool spec needs.
 *
 * The optional compositions are the seams the host specs exercise beyond the
 * tool lane. Each one mounts before the plugin, because the plugin resolves
 * its injects at mount time: the stub command registry (`commands`), the
 * Typert registry (`typert`, whose endpoint registration has to be up while
 * the service mounts), and the in-memory settings provider (`settings`).
 * @module tests/helpers/lanes/host-lane
 */

import { Context, type Fiber } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, {
  type ToolDefinition,
  type ToolExecutionFailure,
  type ToolExecutionResult,
  type ToolExecutionSuccess,
} from '@deepseek-ai/dsh-tools'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import type { Options } from '../../../src/config.js'
import ZoteroService from '../../../src/index.js'
import { MockZotero } from '../mock-zotero.js'
import { StubCommands } from '../stub-commands.js'

/** The optional services a lane composes before the plugin mounts. */
export interface HostLaneOptions {
  /**
   * Compose the stub command registry, so the plugin's optional `/zotero`
   * command path registers; the registry itself is {@link HostLane.stub}.
   */
  readonly commands?: boolean
  /**
   * Compose the Typert registry before the plugin, so the host manifest
   * self-registers while the service is mounting (the optional inject waits
   * for it).
   */
  readonly typert?: boolean
  /**
   * Compose any further service before the plugin mounts — a user-questions
   * stand-in, for one: a plugin fiber resolves services at call time, but a
   * seam the tools must find has to exist before the plugin's own fiber
   * snapshot is taken.
   */
  readonly compose?: (ctx: Context) => Promise<void>
}

/** One booted lane: the mounted context, the scripted server, and the call surface. */
export interface HostLane {
  /** The context the plugin is mounted on. */
  readonly ctx: Context
  /** The scripted Zotero Local API the plugin talks to. */
  readonly mock: MockZotero
  /** The plugin's own fiber; disposing it unwinds every registration. */
  readonly zoteroFiber: Fiber
  /** The stub command registry, present only when `commands` composed it. */
  readonly stub: StubCommands | undefined
  /** Execute one tool call the way the harness does, with a fresh signal and call id. */
  runTool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult>
  /** The registered definition for one tool name, if the assembly carries it. */
  tool(name: string): ToolDefinition | undefined
  /** Close the mock server; call it from the spec's `afterEach`. */
  teardown(): Promise<void>
}

/**
 * Boot the lane: a fresh mock server and a plugin mounted over it.
 * @param config - plugin options merged over the mock's base URL.
 * @param options - the optional services to compose before the plugin mounts.
 * @returns the booted lane; call {@link HostLane.teardown} when the test ends.
 */
export async function setupHostLane(
  config: Options = {},
  options: HostLaneOptions = {},
): Promise<HostLane> {
  const mock = await MockZotero.start()
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, {})
  if (options.commands === true) await ctx.plugin(StubCommands)
  if (options.typert === true) await ctx.plugin(TypertRegistry)
  if (options.compose !== undefined) await options.compose(ctx)
  const entry: Options = { baseUrl: mock.baseUrl, ...config }
  const zoteroFiber = ctx.plugin(ZoteroService, entry)
  await zoteroFiber
  let callCounter = 0
  return {
    ctx,
    mock,
    zoteroFiber,
    stub: options.commands === true ? (ctx.get('commands') as unknown as StubCommands) : undefined,
    runTool(name, args) {
      return ctx.tools.execute({
        callId: ToolCallId(`tool-${++callCounter}`),
        name,
        arguments: args,
        signal: new AbortController().signal,
      })
    },
    tool(name) {
      return ctx.tools.get(name)
    },
    async teardown() {
      await mock.close()
    },
  }
}

/**
 * Assert one tool call succeeded, then hand the result back narrowed to its
 * success arm. This is the `expect(result.isError).toBe(false)` plus
 * `if (result.isError) throw new Error('unreachable')` pair the tool specs
 * spelled out at every call, in one place: the call site keeps reading
 * `.value`, `.content`, and `.meta` off the same binding, and the compiler
 * still sees the arm that carries them.
 *
 * The returned result is the input object itself. A failure throws instead of
 * returning, so every assertion after the call runs only on a success — and
 * the thrown message names the tool and carries the text a reader would
 * otherwise have to fetch from the result by hand: the registry's failure
 * message, its `{ name, code }` when the tool threw a `HarnessError`, and the
 * model-facing content blocks.
 * @param result - a settled `ctx.tools.execute` result.
 * @param tool - the tool name the call used, for the failure message.
 * @returns the same result, typed as its success arm.
 */
export function expectValue(result: ToolExecutionResult, tool: string): ToolExecutionSuccess {
  if (!result.isError) return result
  throw new Error(`${tool} failed${failureCode(result)}: ${failureText(result)}`)
}

/** ` [ZoteroError: ZOTERO_NOT_RUNNING]`, when the tool threw a `HarnessError`. */
function failureCode(result: ToolExecutionFailure): string {
  const info = result.error.info
  return info === undefined ? '' : ` [${info.name}: ${info.code}]`
}

/**
 * The failure text a spec would inspect: the registry's message, plus the
 * model-facing blocks when they say more than the `Error: ` envelope the
 * registry derives from that same message.
 */
function failureText(result: ToolExecutionFailure): string {
  const blocks = result.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n')
  if (blocks === '' || blocks === `Error: ${result.error.message}`) return result.error.message
  return `${result.error.message}\n${blocks}`
}
