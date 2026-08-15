import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-zotero'

/**
 * Default plugin entry.
 *
 * Add your Zotero integration here:
 * - register tools with `ctx.tools.register(...)`
 * - expose services by extending `Service`
 * - listen to harness events with `ctx.on(...)`
 * - accept configuration via `Config` + Schemastery schema
 */
export function apply(ctx: Context) {
  console.log('[dsh-zotero] plugin loaded')
}
