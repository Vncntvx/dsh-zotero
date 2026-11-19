/**
 * @module dsh-zotero/service-lifecycle
 */
import { resolveConfig } from './config.js';
import { errorMessageOf } from './errors.js';
import { sameTransportConfig, touchesTransport } from './service-config.js';
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
export function isOwnConfigFiber(fiberArg, own) {
    return fiberArg === own;
}
export function installServiceConfigLifecycle(ctx, options) {
    let lastBuilt = options.initialConfig;
    const { diagnostics } = options;
    ctx.on('internal/config', (fiber, next) => {
        const raw = next();
        if (!isOwnConfigFiber(fiber, ctx.fiber))
            return raw;
        try {
            resolveConfig(raw);
        }
        catch (error) {
            diagnostics.sink.error('config.rejected', errorMessageOf(error), { scope: 'settings-commit' });
            throw error;
        }
        return raw;
    });
    ctx.on('loader/volatile-update', (paths) => {
        options.invalidateConfig();
        const config = options.configOf();
        diagnostics.setThreshold(config.debug ? 'debug' : 'info');
        try {
            if (!touchesTransport(paths) || sameTransportConfig(config, lastBuilt))
                return;
            options.applyTransportConfig(config);
            lastBuilt = config;
        }
        catch (error) {
            diagnostics.sink.error('config.apply.failed', errorMessageOf(error));
        }
    });
}
//# sourceMappingURL=service-lifecycle.js.map