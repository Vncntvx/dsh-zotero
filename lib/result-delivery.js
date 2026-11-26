import { receiptSchema } from './result-contract.js';
export { fileSchema, receiptSchema, isFileAttachmentRef } from './result-contract.js';
import { isAttachmentError } from '@deepseek-ai/dsh-attachment';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { estimateContent } from '@deepseek-ai/dsh-token-meter/estimate';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools';
import { ToolContextUnavailableError, ToolOutputError } from '@deepseek-ai/dsh-tools';
import { snapshotJsonValue } from '@deepseek-ai/dsh-util-values';
import { RESULT_RECEIPT_PREFIX } from './constants.js';
import { ZOTERO_OUTPUT_TOO_LARGE, errorMessageOf, ZoteroError } from './errors.js';
import { asRecord } from './json.js';
import { isJobArm } from './job-runner.js';
/** A broken producer cannot hold plugin teardown forever. */
export const RESULT_DELIVERY_DRAIN_MS = 5_000;
const MAX_SESSION_DELIVERIES = 128;
const MAX_TOTAL_DELIVERIES = 1024;
/** Opaque path-safe keys work with every official storageDomain backend. */
export async function resultReceiptKey(...coordinates) {
    const bytes = new TextEncoder().encode(JSON.stringify(coordinates));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
const resultDomain = defineDomain({
    name: 'zotero_results',
    version: 1,
    layout: 'per-record',
    invalidRecords: 'backup-and-skip',
    tables: { receipts: domainTable(receiptSchema) },
});
/** The pass-through wrapper for registrations that need no delivery envelope. */
export const identityToolWrapper = (definition) => definition;
/** JSON encoder with bounded string chunks, including pathological single-line fields. */
export async function* jsonBytes(value, signal) {
    const encode = (text) => new TextEncoder().encode(text);
    signal?.throwIfAborted();
    if (typeof value === 'string') {
        yield encode('"');
        for (let offset = 0; offset < value.length;) {
            signal?.throwIfAborted();
            let end = Math.min(value.length, offset + 4096);
            if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1]))
                end--;
            yield encode(JSON.stringify(value.slice(offset, end)).slice(1, -1));
            offset = end;
        }
        yield encode('"');
    }
    else if (Array.isArray(value)) {
        yield encode('[');
        for (let index = 0; index < value.length; index++) {
            if (index > 0)
                yield encode(',');
            yield* jsonBytes(value[index] ?? null, signal);
        }
        yield encode(']');
    }
    else if (value !== null && typeof value === 'object') {
        yield encode('{');
        let first = true;
        for (const [key, entry] of Object.entries(value)) {
            if (entry === undefined)
                continue;
            if (!first)
                yield encode(',');
            first = false;
            yield encode(`${JSON.stringify(key)}:`);
            yield* jsonBytes(entry, signal);
        }
        yield encode('}');
    }
    else
        yield encode(JSON.stringify(value) ?? 'null');
}
/**
 * Count an inline result's bytes and recover its canonical text in one pass.
 *
 * `jsonBytes` is the only encoder: decoding each chunk with a streaming
 * `TextDecoder` rebuilds exactly the text that encoder emitted, so the caller
 * no longer pays for a second `JSON.stringify` of the same object. A chunk may
 * split a multi-byte UTF-8 sequence, which is why the decoder stays open until
 * the final `decode()`; `jsonBytes` additionally avoids splitting surrogate
 * pairs. Returning `undefined` at the first chunk past `limit` preserves the
 * original early-exit behaviour (including the generator's cleanup).
 *
 * The value must be JSON-shaped (`JsonValue`): encoder and `JSON.stringify`
 * agree on strings, arrays, plain objects, skipped `undefined` properties and
 * non-finite numbers, but not on `toJSON()` hosts such as `Date` or BigInt.
 * @param value - the object to encode.
 * @param limit - maximum byte length before the inline branch gives up.
 * @param signal - cancellation carried into every encoded chunk.
 * @returns byte count and canonical text, or undefined when over the limit.
 */
export async function inlineJson(value, limit, signal) {
    const decoder = new TextDecoder();
    let bytes = 0;
    let canonical = '';
    for await (const chunk of jsonBytes(value, signal)) {
        bytes += chunk.byteLength;
        if (bytes > limit)
            return undefined;
        canonical += decoder.decode(chunk, { stream: true });
    }
    canonical += decoder.decode();
    return { bytes, canonical };
}
export function renderDelivered(value, render) {
    return value.delivery === 'inline'
        ? render(value.data)
        : [
            {
                type: 'text',
                text: receiptText(JSON.stringify(value)),
            },
            { type: 'file', attachment: value.file },
        ];
}
function receiptText(canonical) {
    return `${RESULT_RECEIPT_PREFIX}${canonical}\nFull versioned JSON is in the attached file. Parse with run_code Node file APIs for long fields; line-based read previews may truncate individual lines.`;
}
function receiptContentWithinBudget(receipt, config) {
    const content = renderDelivered(receipt, () => []);
    return estimateContent(content) <= config.maxInlineResultTokens &&
        new TextEncoder().encode(JSON.stringify(content)).byteLength <= config.maxInlineResultBytes
        ? content
        : undefined;
}
function compactEvidenceReceipt(receipt) {
    if (receipt.facts?.evidenceRefs === undefined)
        return receipt;
    const { evidenceRefs: _evidenceRefs, ...facts } = receipt.facts;
    return { ...receipt, facts: { ...facts, detailOmitted: true } };
}
export class ResultDelivery {
    ctx;
    config;
    diagnostics;
    facility;
    domain;
    domains = new Set();
    stopping = false;
    committing = Promise.resolve();
    pending = new Set();
    outputs = new Map();
    /**
     * One publication per owning call. A foreground settle and a promotion can
     * both reach the same call after a timeout; deduplicating in flight keeps
     * them from streaming the same body twice.
     */
    publishing = new Map();
    constructor(ctx, config, diagnostics) {
        this.ctx = ctx;
        this.config = config;
        this.diagnostics = diagnostics;
        ctx.effect(() => async () => {
            this.stopping = true;
            const cleanup = (async () => {
                // Accepted producers retain their storage handles until they settle.
                // A late producer can finish its receipt without writing to a closed table.
                while (this.pending.size > 0)
                    await Promise.allSettled([...this.pending]);
                await Promise.all([...this.domains].map(async (opening) => (await opening).close()));
            })();
            {
                let timer;
                const deadline = new Promise((resolve) => {
                    timer = setTimeout(() => resolve('timeout'), RESULT_DELIVERY_DRAIN_MS);
                    timer.unref?.();
                });
                try {
                    const outcome = await Promise.race([cleanup.then(() => 'drained'), deadline]);
                    if (outcome === 'timeout') {
                        this.diagnostics?.warn('delivery.drain.timeout', 'Result delivery cleanup exceeded its deadline; accepted producers retain their storage until settlement.', { pending: this.pending.size, deadlineMs: RESULT_DELIVERY_DRAIN_MS });
                        void cleanup.catch((error) => this.diagnostics?.warn('delivery.drain.failed', errorMessageOf(error)));
                    }
                }
                finally {
                    if (timer !== undefined)
                        clearTimeout(timer);
                }
            }
        });
    }
    track(promise) {
        this.pending.add(promise);
        void promise.then(() => this.pending.delete(promise), () => this.pending.delete(promise));
        return promise;
    }
    async receipts() {
        this.assertActive();
        // The facility is resolved per call and the opened domain is cached
        // against it: a storageDomain replacement must be picked up instead of
        // pinning a handle to a facility that was disposed with its own fiber.
        const facility = this.ctx.get('storageDomain');
        if (!facility) {
            throw new ToolContextUnavailableError('Complete result delivery requires storageDomain and attachments services.');
        }
        if (this.domain === undefined || this.facility !== facility) {
            this.facility = facility;
            const opening = facility.open(resultDomain);
            this.domain = opening;
            this.domains.add(opening);
            void opening.catch(() => {
                this.domains.delete(opening);
                if (this.domain === opening) {
                    this.domain = undefined;
                    this.facility = undefined;
                }
            });
        }
        return (await this.domain).table('receipts');
    }
    async prepare(exec, data, render, signal, jobId, facts) {
        return (await this.prepareResult(exec, data, render, signal, jobId, facts)).result;
    }
    async prepareResult(exec, data, render, signal, jobId, facts) {
        this.assertActive();
        const dedupeKey = JSON.stringify([exec.agent?.session?.header.id, exec.callId]);
        const running = this.publishing.get(dedupeKey);
        if (running)
            return await running;
        const task = this.track(this.publish(exec, data, render, signal, jobId, facts));
        this.publishing.set(dedupeKey, task);
        try {
            return await task;
        }
        finally {
            if (this.publishing.get(dedupeKey) === task)
                this.publishing.delete(dedupeKey);
        }
    }
    assertActive() {
        if (this.stopping)
            throw new ToolContextUnavailableError('Result delivery is stopping.');
    }
    async publish(exec, data, render, signal, jobId, facts) {
        const config = this.config();
        if (jobId === undefined) {
            const inline = await inlineJson(data, config.maxInlineResultBytes, signal);
            if (inline !== undefined) {
                const content = render(data);
                if (estimateContent([{ type: 'text', text: inline.canonical }]) <=
                    config.maxInlineResultTokens &&
                    estimateContent(content) <= config.maxInlineResultTokens &&
                    new TextEncoder().encode(JSON.stringify(content)).byteLength <=
                        config.maxInlineResultBytes)
                    return { result: { delivery: 'inline', data } };
            }
        }
        const attachments = this.ctx.get('attachments');
        const sessionId = exec.agent?.session?.header.id;
        if (!attachments || sessionId === undefined)
            throw new ToolContextUnavailableError('Complete result delivery requires attachments and an owning Session.');
        const table = await this.receipts();
        const key = await resultReceiptKey(sessionId, exec.callId);
        const existing = table.get(key);
        const projected = typeof facts === 'function'
            ? facts()
            : (facts ?? this.outputs.get(exec.name)?.presentationMeta?.(exec.arguments, data));
        const projection = asRecord(projected) === undefined ? undefined : { ...asRecord(projected) };
        const record = asRecord(data);
        if (projection && typeof record?.outputFile === 'string')
            Object.assign(projection, {
                outputFile: record.outputFile,
                delivered: record.delivered === true,
            });
        let file = existing?.file;
        if (file === undefined) {
            try {
                file = await attachments.saveFileStream({
                    name: `${exec.name}-result.json`,
                    signal,
                    data: jsonBytes({ version: 1, tool: exec.name, request: exec.arguments, data }, signal),
                });
            }
            catch (error) {
                if (isAttachmentError(error) && error.code === 'ATTACHMENT_FILES_UNSUPPORTED')
                    throw new ZoteroError('This result exceeds the inline budget, and the configured attachment backend cannot store complete files. Configure a file-capable attachment backend and repeat the read.', ZOTERO_OUTPUT_TOO_LARGE);
                throw error;
            }
        }
        // Publication is settle-once-begun from here: saveFileStream itself cleans
        // up a mid-stream abort (staged temp files), but once the file is
        // published the attachment store has no way to reclaim it, so the receipt
        // writes below run to completion regardless of the signal — either no file
        // and no receipt, or the file and all of its receipts. Cancelling before
        // the save still aborts cleanly, and the aborted caller still observes its
        // own abort; the durable record must not depend on that race.
        const receipt = receiptSchema.parse({
            delivery: 'file',
            version: 1,
            tool: exec.name,
            sessionId,
            callId: exec.callId,
            ...(jobId ? { jobId } : {}),
            summary: `${exec.name}: full result persisted (${file.bytes} bytes).`,
            createdAt: existing?.createdAt ?? Date.now(),
            file,
            ...(asRecord(projection) ? { facts: projection } : {}),
        });
        let content = receiptContentWithinBudget(receipt, config);
        for (const field of ['items', 'notesPreview', 'annotationsPreview']) {
            if (content !== undefined)
                break;
            if (receipt.facts?.[field] !== undefined) {
                delete receipt.facts[field];
                receipt.facts.detailOmitted = true;
                content = receiptContentWithinBudget(receipt, config);
            }
        }
        // The durable receipt also supplies the chat's evidence links. A smaller
        // model-facing announcement can omit those refs while keeping the file.
        if (content === undefined && receipt.facts?.evidenceRefs !== undefined) {
            receipt.facts.detailOmitted = true;
            content = receiptContentWithinBudget(compactEvidenceReceipt(receipt), config);
        }
        if (content === undefined) {
            throw new ZoteroError('Result reference exceeds the configured inline budget.', ZOTERO_OUTPUT_TOO_LARGE);
        }
        const commit = this.committing.then(async () => {
            await table.put(key, receipt);
            if (jobId)
                await table.put(await resultReceiptKey('job', sessionId, jobId), receipt);
            await this.pruneTable(table, sessionId);
        });
        this.committing = commit.catch(() => { });
        await commit;
        return { result: receipt, content };
    }
    wrap(definition) {
        const output = definition.output;
        this.outputs.set(definition.name, output);
        const contentByCall = new WeakMap();
        const deliveryByArguments = new WeakMap();
        return {
            ...definition,
            output: {
                ...output,
                presentationMeta: (args, value) => {
                    const key = asRecord(args);
                    const delivered = key === undefined ? undefined : deliveryByArguments.get(key);
                    if (key !== undefined)
                        deliveryByArguments.delete(key);
                    if (delivered?.delivery === 'file')
                        return {
                            ...(asRecord(delivered.facts) ?? {}),
                            delivery: 'file',
                            file: delivered.file,
                        };
                    const meta = output.presentationMeta?.(args, value);
                    return delivered?.delivery === 'inline'
                        ? { ...(asRecord(meta) ?? {}), delivery: 'inline' }
                        : (meta ?? {});
                },
            },
            projectContent: (exec, result) => {
                const content = contentByCall.get(exec.token);
                contentByCall.delete(exec.token);
                return !result.isError && content !== undefined
                    ? content
                    : definition.projectContent?.(exec, result);
            },
            execute: (args, exec) => {
                this.assertActive();
                return this.track((async () => {
                    const candidate = await definition.execute(args, exec);
                    const value = snapshotJsonValue(candidate);
                    if (value === undefined)
                        throw new ToolOutputError(definition.name, ['Result must be lossless JSON data.']);
                    if (isJobArm(value))
                        return value;
                    const violations = validateJsonSchemaValue(output.schema, value);
                    if (violations.length)
                        throw new ToolOutputError(definition.name, violations);
                    const { result: delivered, content } = await this.prepareResult(exec, value, (data) => output.render(args, data), exec.signal, undefined, () => output.presentationMeta?.(args, value));
                    const key = asRecord(exec.arguments);
                    if (key !== undefined)
                        deliveryByArguments.set(key, delivered);
                    if (content !== undefined) {
                        contentByCall.set(exec.token, content);
                        if (exec.parent)
                            exec.deferContext(createUserMessage({ content, source: { kind: 'ptc-mode' } }));
                    }
                    return value;
                })());
            },
        };
    }
    async receipt(sessionId, callId) {
        return (await this.receipts()).get(await resultReceiptKey(sessionId, callId));
    }
    /** FIFO retention counts deliveries, keeping their call and job aliases together. */
    async pruneReceipts(sessionId, max = MAX_SESSION_DELIVERIES) {
        const table = await this.receipts();
        return this.pruneTable(table, sessionId, max);
    }
    async pruneTable(table, sessionId, max = MAX_SESSION_DELIVERIES) {
        const deliveries = new Map();
        for (const [key, receipt] of table.entries()) {
            const identity = JSON.stringify([receipt.sessionId, receipt.callId]);
            let entry = deliveries.get(identity);
            if (entry === undefined) {
                entry = { sessionId: receipt.sessionId, createdAt: receipt.createdAt, keys: [] };
                deliveries.set(identity, entry);
            }
            entry.keys.push(key);
        }
        const ordered = [...deliveries].sort((a, b) => a[1].createdAt - b[1].createdAt);
        const sessionDeliveries = ordered
            .filter(([, entry]) => entry.sessionId === sessionId)
            .map(([key]) => key);
        const remove = new Set(sessionDeliveries.slice(0, Math.max(0, sessionDeliveries.length - max)));
        let remaining = deliveries.size - remove.size;
        for (const [identity] of ordered) {
            if (remaining <= MAX_TOTAL_DELIVERIES)
                break;
            if (remove.has(identity))
                continue;
            remove.add(identity);
            remaining -= 1;
        }
        const keys = [...remove].flatMap((identity) => deliveries.get(identity).keys);
        return keys.length === 0 ? 0 : await table.deleteMany(keys);
    }
    installJobs() {
        this.ctx.on('tools/post-execute', async (exec, result, next) => {
            if (exec.name !== 'job_output' || result.isError || !exec.agent)
                return next();
            const jobId = asRecord(exec.arguments)?.job_id;
            if (typeof jobId !== 'string')
                return next();
            const job = this.ctx
                .get('jobs')
                ?.list(exec.agent.id)
                .find((entry) => entry.id === jobId);
            if (!job ||
                job.kind !== 'zotero' ||
                job.owner !== exec.agent.id ||
                job.status !== 'completed')
                return next();
            const session = exec.agent.session.header.id;
            // Receipt lookup is a delivery enhancement, not a job-output requirement:
            // a missing or failing storage facility leaves the job's own result intact
            // instead of turning a completed job into a tool failure.
            let receipt;
            try {
                const table = await this.receipts();
                receipt = table.get(await resultReceiptKey('job', session, jobId));
                if (!receipt) {
                    // The two receipt puts are not atomic: a crash or storage failure
                    // between them can leave the per-call receipt without its job-key
                    // twin. Reconcile by the job id the receipt itself carries instead of
                    // dropping the re-attach — the write domain's reconcile-never-retry
                    // discipline applied to the delivery side.
                    for (const [, candidate] of table.entries()) {
                        if (candidate.jobId === jobId && candidate.sessionId === session) {
                            receipt = candidate;
                            break;
                        }
                    }
                }
            }
            catch (error) {
                this.ctx.logger?.warn?.(`job_output receipt lookup failed; delivering the job result without it: ${errorMessageOf(error)}`);
                return next();
            }
            if (!receipt)
                return next();
            const decision = await next();
            if (decision.kind !== 'accept' || Object.hasOwn(decision, 'value'))
                return decision;
            const content = renderDelivered(compactEvidenceReceipt(receipt), () => []);
            return {
                kind: 'accept',
                content: [...(decision.content ?? result.content), ...content],
                additionalContexts: [
                    ...(decision.additionalContexts ?? []),
                    ...(exec.parent ? [createUserMessage({ content, source: { kind: 'ptc-mode' } })] : []),
                ],
            };
        });
    }
}
//# sourceMappingURL=result-delivery.js.map