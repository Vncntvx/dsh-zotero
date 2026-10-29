/**
 * @module dsh-zotero/service-lifecycle
 */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { Config, Options, ResolvedConfig } from './config.js'
import { resolveConfig } from './config.js'
import { errorMessageOf } from './errors.js'
import type { DiagnosticsRecorder } from './diagnostics.js'
import { sameTransportConfig, touchesTransport } from './service-config.js'

/**
 * Whether an `internal/config` waterfall `this` is this plugin's fiber.
 * The Loader passes the fiber itself; `ctx.plugin()` returns
 * `Object.create(fiber)`, so the prototype-linked face counts as the same
 * fiber. Anything else is another plugin's config resolution. Exported for
 * the unit lane: the false arms need a foreign `this` no in-lane waterfall
 * can carry.
 * @param thisArg - the waterfall's bound `this`.
 * @param own - the fiber that owns this service.
 * @returns true when the candidate config belongs to this plugin.
 */
export function isOwnConfigFiber(thisArg: unknown, own: Fiber): boolean {
  if (thisArg === own) return true
  return typeof thisArg === 'object' && thisArg !== null && Object.getPrototypeOf(thisArg) === own
}

export function installServiceConfigLifecycle(
  ctx: Context,
  options: {
    readonly diagnostics: DiagnosticsRecorder
    readonly initialConfig: ResolvedConfig
    readonly configOf: () => ResolvedConfig
    readonly invalidateConfig: () => void
    readonly applyTransportConfig: (config: ResolvedConfig) => void
  },
): void {
  let lastBuilt = options.initialConfig
  const { diagnostics } = options
  ctx.on('internal/config', function (this: Fiber | null, _raw, next) {
    const raw = next()
    if (!isOwnConfigFiber(this, ctx.fiber)) return raw
    try {
      resolveConfig(raw as Config | Options)
    } catch (error) {
      diagnostics.sink.error('config.rejected', errorMessageOf(error), { scope: 'settings-commit' })
      throw error
    }
    return raw
  })
  ctx.on('loader/volatile-update', (paths: readonly (readonly string[])[]) => {
    options.invalidateConfig()
    const config = options.configOf()
    diagnostics.setThreshold(config.debug ? 'debug' : 'info')
    try {
      if (!touchesTransport(paths) || sameTransportConfig(config, lastBuilt)) return
      options.applyTransportConfig(config)
      lastBuilt = config
    } catch (error) {
      diagnostics.sink.error('config.apply.failed', errorMessageOf(error))
    }
  })
}
