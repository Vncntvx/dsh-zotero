/**
 * @module dsh-zotero/tool-diagnostics
 */
import { errorMessageOf } from './errors.js';
function toolCallDigest(execution) {
    let digest = '';
    try {
        digest = JSON.stringify(execution.arguments) ?? '';
    }
    catch {
        digest = '';
    }
    const args = digest.length > 300 ? `${digest.slice(0, 299)}…` : digest;
    return args === '' ? execution.name : `${execution.name} ${args}`;
}
export function installToolDiagnostics(ctx, diagnostics) {
    ctx.on('tools/execute', async (execution, next) => {
        if (!execution.name.startsWith('zotero_'))
            return await next();
        const startedAt = Date.now();
        if (diagnostics.admits('debug')) {
            diagnostics.sink.debug('tool.call', toolCallDigest(execution));
        }
        try {
            const result = await next();
            const ms = Date.now() - startedAt;
            if (result.isError) {
                const detail = { ms };
                const code = result.error.info?.code;
                if (code !== undefined)
                    detail.errorCode = code;
                diagnostics.sink.warn('tool.result', `${execution.name} failed: ${result.error.message}`, detail);
            }
            else {
                diagnostics.sink.debug('tool.result', `${execution.name} completed`, { ms });
            }
            return result;
        }
        catch (error) {
            diagnostics.sink.error('tool.result', `${execution.name} threw: ${errorMessageOf(error)}`, {
                ms: Date.now() - startedAt,
            });
            throw error;
        }
    });
}
//# sourceMappingURL=tool-diagnostics.js.map