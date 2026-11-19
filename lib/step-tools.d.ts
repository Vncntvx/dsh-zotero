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
import type { Context } from '@deepseek-ai/cordis';
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt';
/**
 * The names the step admits, or undefined when the assembly cannot resolve one.
 * @param ctx - the plugin context carrying the tool registry.
 * @param context - the assembly context the harness passes to every provider.
 * @returns the admitted names, cached for this assembly.
 */
export declare function stepToolNamesOf(ctx: Context, context: AssembleContext): ReadonlySet<string> | undefined;
//# sourceMappingURL=step-tools.d.ts.map