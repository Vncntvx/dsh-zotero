/**
 * @module dsh-zotero/service-lifecycle
 */
import type { Context, Fiber } from '@deepseek-ai/cordis';
import type { ResolvedConfig } from './config.js';
import type { DiagnosticsRecorder } from './diagnostics.js';
/**
 * Whether the fiber carried by an `internal/config` waterfall is this plugin's
 * fiber. The Loader hands the resolving fiber itself as the event's first
 * argument, so identity is the whole test — the same strict comparison the
 * official mcp-manager and llm-pi-ai listeners use. A prototype-linked face is
 * never the waterfall's subject.
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