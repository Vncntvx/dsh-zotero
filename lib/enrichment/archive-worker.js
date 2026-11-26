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
/** Cancelable per-service archive admission; a slot lasts through persistence. */
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import { deadline } from '@deepseek-ai/dsh-timeout';
import { ARTIFACT_READER_DEFAULTS, } from '../artifact-reader-preferences.js';
import { ARTIFACT_IMAGE_NAME_PATTERN, ARCHIVE_MAX_IMAGES, ARCHIVE_MAX_IMAGE_BYTES, ARCHIVE_MAX_IMAGE_TOTAL_BYTES, } from '../artifact-images.js';
import { ZoteroError, ZOTERO_ENRICHMENT_ARCHIVE_INVALID, ZOTERO_ENRICHMENT_TASK_FAILED, } from '../errors.js';
import { ZIP_MAX_ARCHIVE_BYTES, ZIP_MAX_FILE_BYTES } from './archive-limits.js';
import { workerEntryUrl } from './worker-bootstrap.js';
const resultSchema = z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(false), message: z.string().max(4096) }).strict(),
    z
        .object({
        ok: z.literal(true),
        files: z
            .object({
            markdown: z.string().min(1).max(ZIP_MAX_FILE_BYTES),
            contentList: z.string().max(ZIP_MAX_FILE_BYTES).optional(),
            images: z
                .array(z
                .object({
                name: z.string().regex(ARTIFACT_IMAGE_NAME_PATTERN),
                mediaType: z.enum([
                    'image/png',
                    'image/jpeg',
                    'image/gif',
                    'image/webp',
                    'image/bmp',
                ]),
                data: z
                    .instanceof(Uint8Array)
                    .refine((data) => data.byteLength > 0 && data.byteLength <= ARCHIVE_MAX_IMAGE_BYTES),
            })
                .strict())
                .max(ARCHIVE_MAX_IMAGES),
        })
            .strict()
            .refine((files) => files.images.reduce((total, image) => total + image.data.byteLength, 0) <=
            ARCHIVE_MAX_IMAGE_TOTAL_BYTES),
    })
        .strict(),
]);
/** Source launches use Node's native TypeScript support; published launches use only emitted JS. */
const spawnWorker = (entry, bytes) => {
    const resourceLimits = {
        maxOldGenerationSizeMb: 256,
        maxYoungGenerationSizeMb: 32,
        stackSizeMb: 4,
    };
    return new Worker(workerEntryUrl(entry), {
        workerData: bytes,
        transferList: [bytes.buffer],
        execArgv: [],
        resourceLimits,
    });
};
export class ArchiveProcessor {
    policy;
    factory;
    running = 0;
    queue = [];
    constructor(policy = () => ARTIFACT_READER_DEFAULTS, factory = spawnWorker) {
        this.policy = policy;
        this.factory = factory;
    }
    release = () => {
        this.running--;
        this.drain();
    };
    drain() {
        while (this.running < this.policy().archiveConcurrency && this.queue.length > 0) {
            const next = this.queue.shift();
            next.signal.removeEventListener('abort', next.abort);
            if (next.signal.aborted) {
                next.reject(next.signal.reason);
                continue;
            }
            this.running++;
            next.resolve(this.release);
        }
    }
    async acquire(signal) {
        signal.throwIfAborted();
        // A larger live limit belongs to queued callers before a new arrival.
        this.drain();
        if (this.running < this.policy().archiveConcurrency) {
            this.running++;
            return this.release;
        }
        if (this.queue.length >= this.policy().archiveQueueLimit)
            throw new ZoteroError('Archive processing is busy. Retry the parsing operation later.', ZOTERO_ENRICHMENT_TASK_FAILED);
        return await new Promise((resolve, reject) => {
            const entry = {
                signal,
                resolve,
                reject,
                abort: () => {
                    const index = this.queue.indexOf(entry);
                    if (index !== -1)
                        this.queue.splice(index, 1);
                    reject(signal.reason);
                },
            };
            this.queue.push(entry);
            signal.addEventListener('abort', entry.abort, { once: true });
            if (signal.aborted)
                entry.abort();
        });
    }
    async run(signal, task) {
        const release = await this.acquire(signal);
        try {
            signal.throwIfAborted();
            return await task();
        }
        finally {
            release();
        }
    }
    async extract(input, signal) {
        const env_1 = { stack: [], error: void 0, hasError: false };
        try {
            signal.throwIfAborted();
            const budget = __addDisposableResource(env_1, deadline(signal, 30_000, ZOTERO_ENRICHMENT_ARCHIVE_INVALID), false);
            signal = budget.signal;
            if (input.byteLength > ZIP_MAX_ARCHIVE_BYTES)
                throw new ZoteroError('The result archive exceeds its size ceiling.', ZOTERO_ENRICHMENT_ARCHIVE_INVALID);
            // Copy at this ownership boundary: detaching a pooled or shared download buffer is forbidden.
            const bytes = new Uint8Array(input);
            const worker = this.factory(new URL('./zip-worker.js', import.meta.url), bytes);
            return await new Promise((resolve, reject) => {
                let settled = false;
                const settle = (finish) => {
                    if (settled)
                        return;
                    settled = true;
                    signal.removeEventListener('abort', abort);
                    worker.removeAllListeners();
                    // Keep an error listener until termination completes, including errors racing cancellation.
                    worker.on('error', () => { });
                    void worker.terminate().then(finish, finish);
                };
                const abort = () => settle(() => reject(signal.reason));
                worker.once('message', (message) => {
                    const result = resultSchema.safeParse(message);
                    settle(() => {
                        if (!result.success)
                            reject(new ZoteroError('The archive worker returned an invalid result.', ZOTERO_ENRICHMENT_TASK_FAILED));
                        else if (!result.data.ok)
                            reject(new ZoteroError(result.data.message, ZOTERO_ENRICHMENT_ARCHIVE_INVALID));
                        else {
                            const { contentList, ...files } = result.data.files;
                            resolve({
                                ...files,
                                ...(contentList !== undefined
                                    ? { contentList: contentList }
                                    : {}),
                            });
                        }
                    });
                });
                worker.once('error', (error) => settle(() => reject(new ZoteroError(`Archive worker failed: ${error.message}`, ZOTERO_ENRICHMENT_TASK_FAILED))));
                worker.once('exit', (code) => settle(() => reject(new ZoteroError(`Archive worker exited without a result (${code}).`, ZOTERO_ENRICHMENT_TASK_FAILED))));
                signal.addEventListener('abort', abort, { once: true });
                if (signal.aborted)
                    abort();
            });
        }
        catch (e_1) {
            env_1.error = e_1;
            env_1.hasError = true;
        }
        finally {
            __disposeResources(env_1);
        }
    }
}
//# sourceMappingURL=archive-worker.js.map