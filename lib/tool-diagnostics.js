/**
 * Tool-call diagnostics: a debug digest when a `zotero_` call enters dispatch,
 * and one outcome line when the harness publishes the result.
 *
 * `tools/result` is the authoritative, frozen outcome, and it also fires for
 * calls the pipeline refused before dispatch (a `tools/pre-execute` denial, a
 * guard, a cancellation). Those report their outcome without `ms`; `ms`
 * therefore spans dispatch entry to result publication, including post-execute
 * and finalization. A retrying wrapper above this listener re-stamps the start,
 * so `ms` covers the last attempt.
 * @module dsh-zotero/tool-diagnostics
 */
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
/** Structured facts for one outcome line; absent when there are none. */
function outcomeDetail(ms, errorCode) {
    if (ms === undefined && errorCode === undefined)
        return undefined;
    return {
        ...(ms === undefined ? {} : { ms }),
        ...(errorCode === undefined ? {} : { errorCode }),
    };
}
export function installToolDiagnostics(ctx, diagnostics) {
    // The harness passes the same execution object to `tools/execute` and, after
    // freezing it, to `tools/result`.
    const startedAt = new WeakMap();
    ctx.on('tools/execute', async (execution, next) => {
        if (!execution.name.startsWith('zotero_'))
            return await next();
        startedAt.set(execution, Date.now());
        if (diagnostics.admits('debug')) {
            diagnostics.sink.debug('tool.call', toolCallDigest(execution));
        }
        return await next();
    });
    ctx.on('tools/result', (execution, result) => {
        if (!execution.name.startsWith('zotero_'))
            return;
        const started = startedAt.get(execution);
        const ms = started === undefined ? undefined : Date.now() - started;
        if (result.isError) {
            diagnostics.sink.warn('tool.result', `${execution.name} failed: ${result.error.message}`, outcomeDetail(ms, result.error.info?.code));
            return;
        }
        diagnostics.sink.debug('tool.result', `${execution.name} completed`, outcomeDetail(ms));
    });
}
//# sourceMappingURL=tool-diagnostics.js.map