/**
 * @module dsh-zotero/service-lifecycle
 */
import type { Context, Fiber } from '@deepseek-ai/cordis';
import type { ResolvedConfig } from './config.js';
import type { DiagnosticsRecorder } from './diagnostics.js';
/**
 * Whether the fiber carried by an `internal/config` waterfall is this plugin's
 * fiber. The Loader passes the resolving fiber as the event's first argument;
 * `ctx.plugin()` returns `Object.create(fiber)`, so a prototype-linked face
 * counts as the same fiber. Anything else is another plugin's config
 * resolution. Exported for the unit lane: the false arms need a foreign fiber
 * no in-lane commit can carry.
 * @param fiberArg - the fiber the waterfall emitted.
 * @param own - the fiber that owns this service.
 * @returns true when the candidate config belongs to this plugin.
 */
export declare function isOwnConfigFiber(fiberArg: unknown, own: Fiber): boolean;
export declare function installServiceConfigLifecycle(ctx: Context, options: {
    readonly diagnostics: DiagnosticsRecorder;
    readonly initialConfig: ResolvedConfig;
    readonly configOf: () => ResolvedConfig;
    readonly invalidateConfig: () => void;
    readonly applyTransportConfig: (config: ResolvedConfig) => void;
}): void;
//# sourceMappingURL=service-lifecycle.d.ts.map