/**
 * @module dsh-zotero/service-lifecycle
 */
import { resolveConfig } from './config.js';
import { errorMessageOf } from './errors.js';
import { sameTransportConfig, touchesTransport } from './service-config.js';
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
export function isOwnConfigFiber(fiberArg, own) {
    if (fiberArg === own)
        return true;
    return (typeof fiberArg === 'object' && fiberArg !== null && Object.getPrototypeOf(fiberArg) === own);
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