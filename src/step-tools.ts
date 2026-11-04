/**
 * Per-assembly access to the step's admitted tool names.
 *
 * Prompt sections must follow the same admission the executor uses. The
 * harness documents `ctx.tools.definitions(scope, toolSet)` as the lookup for
 * that set; resolving it here once per assembly keeps the core and scholarly
 * sections from duplicating the scope guard and rebuilding the registry view
 * twice.
 *
 * `undefined` means the assembly named no resolvable step (no `toolSet`, or a
 * `toolSet` without the owning scope), so callers keep their full text. An
 * empty set means the step admits none of the caller's tools.
 *
 * @module dsh-zotero/step-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
// Type-only: brings the `ctx.tools` merge and `AssembleContext.toolSet` here.
import type {} from '@deepseek-ai/dsh-tools'

/** One assembly's resolved names; the harness passes the same context to every section. */
const namesByAssembly = new WeakMap<AssembleContext, ReadonlySet<string>>()

/**
 * The names the step admits, or undefined when the assembly cannot resolve one.
 * @param ctx - the plugin context carrying the tool registry.
 * @param context - the assembly context the harness passes to every provider.
 * @returns the admitted names, cached for this assembly.
 */
export function stepToolNamesOf(
  ctx: Context,
  context: AssembleContext,
): ReadonlySet<string> | undefined {
  if (context.toolSet === undefined || context.scope === undefined) return undefined
  const cached = namesByAssembly.get(context)
  if (cached !== undefined) return cached
  const names = new Set(
    ctx.tools.definitions(context.scope, context.toolSet).map((definition) => definition.name),
  )
  namesByAssembly.set(context, names)
  return names
}
