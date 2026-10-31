/**
 * @module dsh-zotero/service-lifecycle
 */
import type { Context, Fiber } from '@deepseek-ai/cordis';
import type { ResolvedConfig } from './config.js';
import type { DiagnosticsRecorder } from './diagnostics.js';
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
export declare function isOwnConfigFiber(thisArg: unknown, own: Fiber): boolean;
export declare function installServiceConfigLifecycle(ctx: Context, options: {
    readonly diagnostics: DiagnosticsRecorder;
    readonly initialConfig: ResolvedConfig;
    readonly configOf: () => ResolvedConfig;
    readonly invalidateConfig: () => void;
    readonly applyTransportConfig: (config: ResolvedConfig) => void;
}): void;
//# sourceMappingURL=service-lifecycle.d.ts.map