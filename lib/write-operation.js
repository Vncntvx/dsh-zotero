var __addDisposableResource = (this && this.__addDisposableResource) || function (env, value, async) {
    if (value !== null && value !== void 0) {
        if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");
        var dispose, inner;
        if (async) {
            if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
            dispose = value[Symbol.asyncDispose];
        }
        if (dispose === void 0) {
            if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
            dispose = value[Symbol.dispose];
            if (async) inner = dispose;
        }
        if (typeof dispose !== "function") throw new TypeError("Object not disposable.");
        if (inner) dispose = function() { try { inner.call(this); } catch (e) { return Promise.reject(e); } };
        env.stack.push({ value: value, dispose: dispose, async: async });
    }
    else if (async) {
        env.stack.push({ async: true });
    }
    return value;
};
var __disposeResources = (this && this.__disposeResources) || (function (SuppressedError) {
    return function (env) {
        function fail(e) {
            env.error = env.hasError ? new SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
            env.hasError = true;
        }
        var r, s = 0;
        function next() {
            while (r = env.stack.pop()) {
                try {
                    if (!r.async && s === 1) return s = 0, env.stack.push(r), Promise.resolve().then(next);
                    if (r.dispose) {
                        var result = r.dispose.call(r.value);
                        if (r.async) return s |= 2, Promise.resolve(result).then(next, function(e) { fail(e); return next(); });
                    }
                    else s |= 1;
                }
                catch (e) {
                    fail(e);
                }
            }
            if (s === 1) return env.hasError ? Promise.reject(env.error) : Promise.resolve();
            if (env.hasError) throw env.error;
        }
        return next();
    };
})(typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
});
/** One foreground write owns its full read-modify-write cycle and deadline. */
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout';
import { acquireSlot } from './concurrency.js';
import { ZoteroError, ZoteroWriteCommitUnknownError, ZOTERO_TIMEOUT } from './errors.js';
/** Starts after plan approval; includes queueing, authorization and graph verification. */
export const WRITE_OPERATION_DEADLINE_MS = 15 * 60_000;
export async function runWriteOperation(gate, signal, operation) {
    const env_1 = { stack: [], error: void 0, hasError: false };
    try {
        const budget = __addDisposableResource(env_1, deadline(signal, WRITE_OPERATION_DEADLINE_MS, ZOTERO_TIMEOUT), false);
        try {
            const release = await acquireSlot(gate, budget.signal);
            try {
                return await operation(budget.signal);
            }
            finally {
                release();
            }
        }
        catch (error) {
            // A dispatched write may already have committed. Its reconciliation
            // outcome must survive both this deadline and caller cancellation.
            if (error instanceof ZoteroWriteCommitUnknownError)
                throw error;
            if (timeoutOf(budget.signal, ZOTERO_TIMEOUT) !== undefined)
                throw new ZoteroError('The Zotero write exceeded its 15-minute operation deadline. Check any completed or unverified refs before further action.', ZOTERO_TIMEOUT, { cause: error });
            throw error;
        }
    }
    catch (e_1) {
        env_1.error = e_1;
        env_1.hasError = true;
    }
    finally {
        __disposeResources(env_1);
    }
}
//# sourceMappingURL=write-operation.js.map