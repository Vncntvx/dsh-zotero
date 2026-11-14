import { ArtifactReads } from './artifact-reads.js';
import { expandRequestTarget } from './artifact-target.js';
import { mapWithConcurrency } from '../concurrency.js';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SessionId } from '@deepseek-ai/dsh-session';
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol';
import { JobId, JobError, } from '@deepseek-ai/dsh-jobs';
import { z } from 'zod';
import { errorMessageOf, ZoteroError, ZOTERO_ENRICHMENT_JOBS_UNAVAILABLE, ZOTERO_ENRICHMENT_OPERATION_CONFLICT, ZOTERO_ENRICHMENT_TASK_FAILED, ZOTERO_INVALID_ARGUMENT, ZOTERO_JOBS_LIMIT_REACHED, ZOTERO_NOT_FOUND, ZOTERO_PROVIDER_UNAVAILABLE, } from '../errors.js';
import { raceWithSignal } from '../race-signal.js';
import { zoteroDocumentArtifactRequestSchema, zoteroDocumentParseReceiptRequestSchema, zoteroDocumentParseReceiptResultSchema, zoteroStartDocumentParseRequestSchema, } from '../wire-schemas.js';
import { resolveEnrichmentConfig } from './config.js';
import { PARSE_TOTAL_TIMEOUT_MS } from './limits.js';
import { sanitizedErrorDetail } from './transport.js';
import { parseDigest, parseTargetOf, resolveParseTarget, safeParseText, } from './parse-target.js';
export const PARSE_JOB_KIND = 'zotero-enrichment';
export const PARSE_JOB_LABEL = '文档解析 · MinerU';
/**
 * One completion-notice waiter's lifetime, and the cadence at which its
 * successor is armed. These are slices, not job bounds: a queued reparse waits
 * for its lane predecessor, downloads its source, and parses, so the job can
 * outlive any single wait. A successor is armed while the current waiter is
 * still live, so at least one waiter is registered for the job's whole actual
 * lifetime.
 */
export const PARSE_NOTICE_WAIT_MS = PARSE_TOTAL_TIMEOUT_MS;
export const PARSE_NOTICE_REARM_MS = PARSE_TOTAL_TIMEOUT_MS / 2;
export const PARSE_CANCELLED_MESSAGE = 'Document parsing was cancelled.';
export const PARSE_FAILED_MESSAGE = 'Document parsing failed. Retry the operation to resume its generation.';
/** Real phase labels for the jobs roster; no invented percentages. */
export const PARSE_JOB_PHASES = {
    acquiring: '读取 PDF',
    uploading: '上传 PDF 到 MinerU',
    waiting: 'MinerU 解析中',
    downloading: '下载解析结果',
    validating: '校验解析结果',
    writing: '保存解析产物',
};
/**
 * The failed receipt's line: the request's own reason, not only its code.
 *
 * A bare "parsing failed" makes a security rejection, a MinerU task error, and
 * a filesystem failure indistinguishable in the dialog and in the persisted
 * record. The detail is bounded to 256 characters with addresses and bearer
 * tokens reduced, so a signed upload URL or a credential cannot cross the
 * durable receipt boundary. An empty message still falls back to the fixed
 * line, and cancellation keeps its own fixed line.
 */
function failureMessageOf(error) {
    return sanitizedErrorDetail(errorMessageOf(error)) ?? PARSE_FAILED_MESSAGE;
}
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const recordSchema = z
    .object({
    version: z.literal(1),
    owner: digest,
    operationId: z.uuid(),
    binding: digest,
    action: z.enum(['parse', 'reparse']),
    generation: z.uuid(),
    jobId: z.string().min(1).max(256),
    state: zoteroDocumentParseReceiptResultSchema,
})
    .strict();
/** Receipts survive service remounts. The root resolver must validate the snapshot directory. */
export class DiskParseJobPersistence {
    root;
    constructor(root) {
        this.root = root;
    }
    async directory(config, create) {
        const root = await realpath(await this.root(config, create));
        const dir = join(root, 'parse-jobs');
        if (create)
            await mkdir(dir, { mode: 0o700 }).catch((error) => {
                if (error.code !== 'EEXIST')
                    throw error;
            });
        const info = await lstat(dir);
        if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(dir)) !== dir)
            throw new Error('Unsafe parsing receipt directory');
        return dir;
    }
    async read(config, key) {
        try {
            return await this.readAt(await this.directory(config, false), key);
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return undefined;
            throw error;
        }
    }
    /** One receipt read against an already validated directory, so a scan validates once. */
    async readAt(dir, key) {
        try {
            const path = join(dir, `${key}.json`);
            const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
            try {
                const info = await file.stat();
                if (!info.isFile() || info.size > 65536)
                    throw new Error('Invalid parsing receipt file');
                const buffer = Buffer.alloc(65537);
                let size = 0;
                while (size < buffer.length) {
                    const read = await file.read(buffer, size, buffer.length - size, size);
                    if (read.bytesRead === 0)
                        break;
                    size += read.bytesRead;
                }
                if (size > 65536)
                    throw new Error('Oversized parsing receipt');
                return JSON.parse(buffer.subarray(0, size).toString('utf8'));
            }
            finally {
                await file.close();
            }
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return undefined;
            throw error;
        }
    }
    async write(config, key, value) {
        const dir = await this.directory(config, true);
        const path = join(dir, `${key}.json`);
        const temporary = `${path}.tmp-${randomUUID()}`;
        try {
            await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
            if ((await this.directory(config, false)) !== dir)
                throw new Error('Parsing receipt directory changed');
            await rename(temporary, path);
        }
        finally {
            await rm(temporary, { force: true });
        }
    }
    async get(config, owner, operationId) {
        const value = await this.read(config, parseDigest(JSON.stringify([owner, operationId])));
        if (value === undefined)
            return undefined;
        const record = recordSchema.parse(value);
        if (record.owner !== owner || record.operationId !== operationId)
            throw new Error('Parsing receipt identity mismatch');
        return record;
    }
    async put(config, record) {
        await this.write(config, parseDigest(JSON.stringify([record.owner, record.operationId])), recordSchema.parse(record));
    }
    async generation(config, source) {
        const value = await this.read(config, `source-${source}`);
        return value === undefined
            ? undefined
            : z.object({ generation: z.uuid() }).strict().parse(value).generation;
    }
    async putGeneration(config, source, generation) {
        await this.write(config, `source-${source}`, { generation: z.uuid().parse(generation) });
    }
    async deleteByGeneration(config, generation) {
        const wanted = z.uuid().parse(generation);
        let dir;
        try {
            dir = await this.directory(config, false);
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return 0;
            throw error;
        }
        // The directory is validated once above; each file's reads run against the
        // validated path, bounded so a large receipt scan cannot open the host wide.
        const names = (await readdir(dir)).filter((name) => name.endsWith('.json'));
        const results = await mapWithConcurrency(names, 4, async (name) => {
            const path = join(dir, name);
            const info = await lstat(path);
            if (info.isSymbolicLink() || !info.isFile())
                return false;
            const key = name.slice(0, -5);
            const value = name.startsWith('source-')
                ? z
                    .object({ generation: z.uuid() })
                    .strict()
                    .safeParse(await this.readAt(dir, key))
                : recordSchema.safeParse(await this.readAt(dir, key));
            if (!value.success || value.data.generation !== wanted)
                return false;
            await rm(path, { force: true });
            return true;
        });
        return results.filter((removed) => removed).length;
    }
}
function parseWire(schema, input) {
    const parsed = schema.safeParse(input);
    if (!parsed.success)
        throw new ZoteroError('Invalid document parsing request.', ZOTERO_INVALID_ARGUMENT);
    return parsed.data;
}
function snapshotKey(config) {
    return parseDigest(JSON.stringify([config.mode, config.mineruTokenRef, config.outputDir]));
}
function cancelled() {
    return new DOMException(PARSE_CANCELLED_MESSAGE, 'AbortError');
}
/** No tools are dispatched. Jobs are admitted against a live session and the real registry. */
export class EnrichmentParseJobs {
    ctx;
    deps;
    reads;
    closed = false;
    disposal;
    operations = new Map();
    owned = new Set();
    admissions = new Map();
    shared = new Map();
    tails = new Map();
    generations = new Map();
    constructor(ctx, deps) {
        this.ctx = ctx;
        this.deps = deps;
        this.reads = new ArtifactReads({
            policy: () => this.config().artifactReader,
            owner: async (id, signal, currentCtx) => {
                await this.owner(SessionId(id), 'documentArtifact', signal, currentCtx);
                const peer = currentCtx.invocation?.peer;
                const agent = currentCtx.get('agents')?.get(SessionId(id));
                if (peer === undefined || agent === undefined)
                    throw new ZoteroError('Document reading requires a live invocation.', ZOTERO_INVALID_ARGUMENT);
                return { peer, agent };
            },
            candidate: async (request, signal) => {
                const config = this.config();
                const resolved = await this.expand(request.target, config, signal);
                const target = await resolveParseTarget(parseTargetOf(resolved.target), this.deps.resolveAttachment, signal);
                signal.throwIfAborted();
                return await this.deps.displayCandidate(target.input, config, signal, target.targetLabel, resolved.record);
            },
            metadata: async (request, signal) => await this.deps.metadata(this.config(), request, signal),
            probe: async (request, signal) => await this.deps.probe(this.config(), request, signal),
        });
        ctx.on('agent/disposed', ({ agent }) => this.reads.retireAgent(agent));
    }
    open() {
        if (this.closed)
            throw new ZoteroError('Document parsing component is closed.', ZOTERO_PROVIDER_UNAVAILABLE);
    }
    authorize(sessionId, method, currentCtx = this.ctx) {
        if (currentCtx.get('remoteAccess')?.allows({ kind: 'session', id: sessionId }) === true)
            return;
        throw new RemoteError('remote-access/denied', 'Document parsing is not authorized for this session.', {
            action: `zotero/${method}`,
            reason: 'no-allow',
        });
    }
    config() {
        return Object.freeze({ ...resolveEnrichmentConfig(this.deps.config()) });
    }
    async expand(target, config, signal) {
        signal.throwIfAborted();
        if (target.kind !== 'artifact')
            return { target };
        const store = await this.deps.store(config);
        return await expandRequestTarget(target, store);
    }
    /** Drop in-memory job state bound to one artifact generation. */
    forgetGeneration(generation) {
        for (const [key, operation] of this.operations)
            if (operation.record.generation === generation) {
                this.operations.delete(key);
                this.owned.delete(operation);
            }
        for (const [source, value] of this.generations)
            if (value === generation)
                this.generations.delete(source);
        for (const [key, shared] of this.shared)
            if (shared.generation === generation)
                this.shared.delete(key);
    }
    /** Invalidate open document leases bound to one artifact. */
    retireArtifact(artifactId) {
        this.reads.retireArtifact(artifactId);
    }
    /** Session-only authorization for the management endpoints. */
    authorizeManagement(sessionId, method, currentCtx = this.ctx) {
        this.open();
        this.authorize(SessionId(sessionId), method, currentCtx);
    }
    async owner(sessionId, method, signal, currentCtx) {
        this.open();
        this.authorize(sessionId, method, currentCtx);
        const registry = currentCtx.get('jobs');
        const controller = currentCtx.get('sessionController');
        if (registry === undefined || controller === undefined) {
            throw new ZoteroError('Document parsing requires jobs and a session controller.', ZOTERO_ENRICHMENT_JOBS_UNAVAILABLE);
        }
        const resolved = await controller.resolveAgent(sessionId);
        signal.throwIfAborted();
        this.open();
        this.authorize(sessionId, method, currentCtx);
        if ('error' in resolved ||
            resolved.agent.id !== sessionId ||
            resolved.agent.session.id !== sessionId ||
            currentCtx.get('agents')?.get(sessionId) !== resolved.agent) {
            throw new ZoteroError('Document parsing requires a live session Agent.', ZOTERO_ENRICHMENT_JOBS_UNAVAILABLE);
        }
        return registry;
    }
    async startDocumentParse(input, signal, currentCtx = this.ctx) {
        signal.throwIfAborted();
        this.open();
        const config = this.config();
        const parsed = parseWire(zoteroStartDocumentParseRequestSchema, input);
        const resolved = await this.expand(parsed.target, config, signal);
        const request = { ...parsed, target: resolved.target };
        const target = parseTargetOf(request.target);
        const sessionId = SessionId(request.sessionId);
        const registry = await this.owner(sessionId, 'startDocumentParse', signal, currentCtx);
        const key = parseDigest(JSON.stringify([sessionId, request.operationId]));
        const binding = parseDigest(JSON.stringify([target.target, snapshotKey(config)]));
        const existing = this.operations.get(key);
        const admission = this.admissions.get(key);
        if ((existing !== undefined &&
            (existing.record.binding !== binding ||
                (request.action !== 'retry' && existing.record.action !== request.action))) ||
            (admission !== undefined &&
                (admission.binding !== binding ||
                    (request.action !== 'retry' && admission.action !== request.action)))) {
            throw new ZoteroError('The operation id is already bound to another parsing request.', ZOTERO_ENRICHMENT_OPERATION_CONFLICT);
        }
        const retry = request.action === 'retry' &&
            existing !== undefined &&
            (existing.record.state.kind === 'failed' || existing.record.state.kind === 'cancelled');
        const replay = !retry && (existing !== undefined || admission !== undefined);
        let operation;
        if (existing !== undefined && !retry)
            operation = existing;
        else if (admission !== undefined)
            operation = await raceWithSignal(admission.task, signal);
        else {
            const task = this.admit(request, target, config, binding, registry, signal, currentCtx, retry ? existing : undefined);
            this.admissions.set(key, { binding, action: request.action, task });
            try {
                operation = await task;
                this.operations.set(key, operation);
                this.trimTerminal();
            }
            finally {
                this.admissions.delete(key);
            }
        }
        this.open();
        this.authorize(sessionId, 'startDocumentParse', currentCtx);
        const completed = operation.record.state.kind === 'completed' ? operation.record.state.receipt : undefined;
        return {
            operationId: request.operationId,
            generation: operation.record.generation,
            jobId: operation.record.jobId,
            status: completed !== undefined ? 'completed' : replay ? 'joined' : 'started',
            ...(completed !== undefined ? { receipt: completed } : {}),
        };
    }
    async admit(request, target, config, binding, registry, signal, currentCtx, retry) {
        const owner = parseDigest(request.sessionId);
        const saved = retry?.record ?? (await this.deps.persistence.get(config, owner, request.operationId));
        signal.throwIfAborted();
        this.open();
        this.authorize(SessionId(request.sessionId), 'startDocumentParse', currentCtx);
        if (saved !== undefined) {
            if (saved.binding !== binding ||
                (request.action !== 'retry' && request.action !== saved.action)) {
                throw new ZoteroError('The operation id is already bound to another parsing request.', ZOTERO_ENRICHMENT_OPERATION_CONFLICT);
            }
        }
        else if (request.action === 'retry') {
            throw new ZoteroError('Retry requires a previous parsing operation in this session.', ZOTERO_NOT_FOUND);
        }
        if (saved !== undefined && (request.action !== 'retry' || saved.state.kind === 'completed')) {
            // A process restart never resumes a task as a side effect of RPC replay.
            const state = saved.state.kind === 'pending'
                ? {
                    kind: 'cancelled',
                    code: ZOTERO_ENRICHMENT_TASK_FAILED,
                    message: PARSE_CANCELLED_MESSAGE,
                }
                : saved.state;
            return {
                record: { ...saved, state },
                owner: SessionId(request.sessionId),
                config,
                registry,
                cancel() { },
                done: Promise.resolve({ status: state.kind === 'completed' ? 'completed' : 'killed' }),
            };
        }
        const source = parseDigest(JSON.stringify([target.sourceId, config.mode, snapshotKey(config)]));
        const previous = saved?.generation ??
            this.generations.get(source) ??
            (await this.deps.persistence.generation(config, source));
        signal.throwIfAborted();
        this.open();
        this.authorize(SessionId(request.sessionId), 'startDocumentParse', currentCtx);
        const generation = request.action === 'reparse' ? randomUUID() : (previous ?? randomUUID());
        let operation;
        let jobId;
        try {
            jobId = registry.start({
                kind: PARSE_JOB_KIND,
                label: PARSE_JOB_LABEL,
                owner: SessionId(request.sessionId),
                outputLimitBytes: 16384,
                run: (job) => {
                    const controller = new AbortController();
                    const cancel = () => {
                        if (!controller.signal.aborted)
                            controller.abort(cancelled());
                    };
                    const record = {
                        version: 1,
                        owner,
                        operationId: request.operationId,
                        binding,
                        generation,
                        action: saved?.action ?? (request.action === 'reparse' ? 'reparse' : 'parse'),
                        jobId: job.id,
                        state: { kind: 'pending', jobId: job.id, generation },
                    };
                    const ready = Promise.resolve().then(async () => await this.deps.persistence.put(config, record));
                    const shared = this.reserve(source, target, config, generation, request.action, ready);
                    const effective = {
                        ...record,
                        generation: shared.generation,
                        state: { kind: 'pending', jobId: job.id, generation: shared.generation },
                    };
                    // Install the waiter before the first asynchronous receipt write, so
                    // cancellation during admission revokes it synchronously as well.
                    const check = () => {
                        try {
                            this.open();
                            this.authorize(SessionId(request.sessionId), 'startDocumentParse', currentCtx);
                            if (currentCtx.get('agents')?.get(SessionId(request.sessionId)) === undefined)
                                throw cancelled();
                        }
                        catch (error) {
                            controller.abort(error);
                        }
                    };
                    const waiting = this.wait(shared, job, controller.signal, check).then((value) => ({ value }), (error) => ({ error }));
                    const done = Promise.resolve()
                        .then(async () => {
                        try {
                            await ready;
                            if (shared.generation !== record.generation)
                                await this.deps.persistence.put(config, effective);
                            const outcome = await waiting;
                            if ('error' in outcome)
                                throw outcome.error;
                            const value = outcome.value;
                            const receipt = this.receipt(request.operationId, shared.generation, config, value.target, value.result);
                            const completed = { kind: 'completed', receipt };
                            await this.deps.persistence.put(config, { ...effective, state: completed });
                            operation.record = { ...effective, state: completed };
                            return { status: 'completed', result: JSON.stringify(receipt) };
                        }
                        catch (error) {
                            // Publication can reject after cancellation. Its actual failure
                            // remains a failure; an already-aborted signal cannot replace it.
                            const wasCancelled = error instanceof Error && error.name === 'AbortError';
                            controller.abort(error);
                            await waiting;
                            const state = {
                                kind: wasCancelled ? 'cancelled' : 'failed',
                                code: error instanceof ZoteroError ? error.code : ZOTERO_ENRICHMENT_TASK_FAILED,
                                message: wasCancelled ? PARSE_CANCELLED_MESSAGE : failureMessageOf(error),
                            };
                            operation.record = { ...effective, state };
                            try {
                                await this.deps.persistence.put(config, operation.record);
                            }
                            catch {
                                /* The job still has a definite failure if storage failed. */
                            }
                            await waiting;
                            return { status: wasCancelled ? 'killed' : 'failed', detail: state.message };
                        }
                    })
                        .finally(() => {
                        this.owned.delete(operation);
                        this.trimTerminal();
                    });
                    operation = {
                        record: effective,
                        owner: SessionId(request.sessionId),
                        config,
                        registry,
                        cancel,
                        done,
                    };
                    this.owned.add(operation);
                    return { cancel, done };
                },
            });
        }
        catch (error) {
            // A full job registry is an actionable refusal, not an unavailable
            // session: the user can cancel an unused job and retry. Every other
            // start failure keeps the unavailable answer with its cause attached.
            if (error instanceof JobError && error.code === 'JOB_LIMIT_REACHED') {
                throw new ZoteroError('Document parsing is already running at this session’s job limit. Cancel an unused background job and retry.', ZOTERO_JOBS_LIMIT_REACHED, { cause: error });
            }
            throw new ZoteroError('Document parsing jobs are unavailable for this session.', ZOTERO_ENRICHMENT_JOBS_UNAVAILABLE, { cause: error });
        }
        this.holdNotice(registry, jobId, SessionId(request.sessionId));
        return operation;
    }
    /**
     * Keep this panel-owned job's completion out of the agent inbox.
     *
     * The harness announces every settled owned job to its session and wakes an
     * idle agent with a follow-up turn. That notice is meant for work the model
     * started: a panel parse has no user request behind it, and `job_output`
     * returns only the receipt, so the wake spends a turn hunting a host artifact
     * it cannot read. A settlement that released a live `wait` is reported as
     * already delivered (`awaited`), which the completion reporter skips, so the
     * host — the actual owner of the receipt — holds a waiter for as long as the
     * job runs.
     *
     * A single bounded wait cannot cover the job: a queued reparse waits on its
     * lane predecessor and then downloads and parses, so the job lifetime has no
     * constant upper bound. Successors are therefore armed while their
     * predecessor is still live (`PARSE_NOTICE_REARM_MS < PARSE_NOTICE_WAIT_MS`).
     * Node runs due timers in expiry order and drains microtasks between
     * callbacks, so a successor overdue with its predecessor still registers
     * first; every settlement therefore releases at least one waiter. The steady
     * state is two waiters and one interval, and settlement clears both.
     *
     * The settled record itself stays in place: the panel reads its terminal row
     * to fetch the receipt, and removing it would strand the dialog.
     */
    holdNotice(registry, jobId, owner) {
        let cadence;
        const stop = () => {
            if (cadence === undefined)
                return;
            clearInterval(cadence);
            cadence = undefined;
        };
        const watch = async () => {
            try {
                const view = await registry.wait(jobId, PARSE_NOTICE_WAIT_MS, owner);
                if (view.status === 'completed' || view.status === 'failed' || view.status === 'killed')
                    stop();
            }
            catch {
                /* A vanished job or a disposed registry has nothing left to announce. */
                stop();
            }
        };
        cadence = setInterval(() => void watch(), PARSE_NOTICE_REARM_MS);
        void watch();
    }
    reserve(source, target, config, proposed, action, ready) {
        const current = this.shared.get(source);
        if (action !== 'reparse' &&
            current !== undefined &&
            !current.controller.signal.aborted &&
            (action !== 'retry' || current.generation === proposed))
            return current;
        const generation = proposed;
        const controller = new AbortController();
        const waiters = new Map();
        const lane = parseDigest(JSON.stringify([target.sourceId, config.outputDir]));
        const predecessor = this.tails.get(lane) ?? Promise.resolve();
        let entry;
        const promise = Promise.resolve()
            .then(async () => {
            await ready;
            await predecessor;
            controller.signal.throwIfAborted();
            this.open();
            this.generations.set(source, generation);
            await this.deps.persistence.putGeneration(config, source, generation);
            controller.signal.throwIfAborted();
            for (const check of [...waiters.values()])
                check();
            controller.signal.throwIfAborted();
            const resolved = await resolveParseTarget(target, this.deps.resolveAttachment, controller.signal);
            for (const check of [...waiters.values()])
                check();
            controller.signal.throwIfAborted();
            const onProgress = (phase) => {
                const text = PARSE_JOB_PHASES[phase];
                if (text !== undefined)
                    for (const job of waiters.keys())
                        job.updateProgress(text);
            };
            onProgress('acquiring');
            const result = await this.deps.execute({
                input: resolved.input,
                config,
                generation,
                signal: controller.signal,
                onProgress,
            });
            return { result, target: resolved };
        })
            .then((value) => {
            entry.settled = true;
            return value;
        }, (error) => {
            entry.settled = true;
            throw error;
        });
        const tail = promise
            .then(() => { }, () => { })
            .finally(() => {
            entry.settled = true;
            if (this.shared.get(source) === entry)
                this.shared.delete(source);
            if (this.tails.get(lane) === tail)
                this.tails.delete(lane);
        });
        entry = { generation, controller, waiters, promise, settled: false };
        this.generations.set(source, generation);
        while (this.generations.size > 256)
            this.generations.delete(this.generations.keys().next().value);
        this.shared.set(source, entry);
        this.tails.set(lane, tail);
        return entry;
    }
    /** An independent waiter leaves synchronously; the last one awaits real shared cleanup. */
    async wait(shared, job, signal, check) {
        shared.waiters.set(job, check);
        const leave = () => {
            shared.waiters.delete(job);
            if (shared.waiters.size !== 0)
                return false;
            if (!shared.settled && !shared.controller.signal.aborted)
                shared.controller.abort(cancelled());
            return true;
        };
        let cancelledLast = false;
        const abort = () => {
            cancelledLast = leave();
        };
        signal.addEventListener('abort', abort, { once: true });
        try {
            if (signal.aborted)
                abort();
            signal.throwIfAborted();
            return await raceWithSignal(shared.promise, signal);
        }
        catch (error) {
            // The last cancellation waits through publication: a successfully
            // committed artifact is reported honestly even if abort raced its rename.
            if (signal.aborted && cancelledLast)
                return await shared.promise;
            throw error;
        }
        finally {
            signal.removeEventListener('abort', abort);
            if (leave())
                await shared.promise.then(() => { }, () => { });
        }
    }
    receipt(operationId, generation, config, target, result) {
        if (result.provenance.generation !== generation ||
            result.artifact.meta.generation !== generation ||
            result.provenance.sourceId !== result.artifact.meta.sourceId) {
            throw new ZoteroError('The parsed artifact does not match the admitted generation.', ZOTERO_ENRICHMENT_TASK_FAILED);
        }
        const pageCount = result.artifact.meta.pageCount;
        return {
            operationId,
            generation,
            sourceId: result.provenance.sourceId,
            targetLabel: target.targetLabel,
            mode: config.mode,
            cached: result.cached,
            artifactId: result.cacheKey,
            fingerprint: result.artifact.meta.contentFingerprint,
            format: 'markdown',
            characterCount: result.artifact.markdown.length,
            preview: safeParseText(result.artifact.markdown, 4096),
            ...(pageCount !== undefined && Number.isSafeInteger(pageCount) && pageCount > 0
                ? { pageCount }
                : {}),
        };
    }
    async documentArtifact(input, signal, currentCtx = this.ctx) {
        const request = parseWire(zoteroDocumentArtifactRequestSchema, input);
        return await this.reads.request(request, signal, currentCtx);
    }
    async documentParseReceipt(input, signal, currentCtx = this.ctx) {
        signal.throwIfAborted();
        this.open();
        const request = parseWire(zoteroDocumentParseReceiptRequestSchema, input);
        const sessionId = SessionId(request.sessionId);
        this.authorize(sessionId, 'documentParseReceipt', currentCtx);
        const key = parseDigest(JSON.stringify([sessionId, request.operationId]));
        const active = this.operations.get(key);
        const record = active?.record ??
            (await this.deps.persistence.get(this.config(), parseDigest(sessionId), request.operationId));
        signal.throwIfAborted();
        this.open();
        this.authorize(sessionId, 'documentParseReceipt', currentCtx);
        if (record === undefined)
            throw new ZoteroError('No parsing operation belongs to this session.', ZOTERO_NOT_FOUND);
        if (record.state.kind === 'pending' && active === undefined) {
            return {
                kind: 'cancelled',
                code: ZOTERO_ENRICHMENT_TASK_FAILED,
                message: PARSE_CANCELLED_MESSAGE,
            };
        }
        return record.state;
    }
    trimTerminal() {
        if (this.operations.size <= 256)
            return;
        for (const [key, operation] of this.operations) {
            if (!this.owned.has(operation) && operation.record.state.kind !== 'pending')
                this.operations.delete(key);
            if (this.operations.size <= 256)
                break;
        }
    }
    /** Stop admission synchronously, abort owned waiters, and wait for their actual cleanup. */
    dispose() {
        if (this.disposal !== undefined)
            return this.disposal;
        this.closed = true;
        for (const operation of this.owned) {
            if (operation.record.state.kind !== 'pending')
                continue;
            operation.cancel();
            try {
                operation.registry.kill(JobId(operation.record.jobId), operation.owner, 'enrichment disposed');
            }
            catch {
                /* Local cancellation above remains authoritative. */
            }
        }
        for (const entry of this.shared.values())
            if (!entry.controller.signal.aborted)
                entry.controller.abort(cancelled());
        this.disposal = (async () => {
            await this.reads.dispose();
            await Promise.allSettled([...this.admissions.values()].map(({ task }) => task));
            await Promise.allSettled([...this.owned].map(({ done }) => done));
            await Promise.allSettled(this.tails.values());
        })();
        return this.disposal;
    }
}
//# sourceMappingURL=parse-jobs.js.map