/** Source-bound read leases, held only while the browser prepares a complete document. */
import { raceWithSignal } from '../race-signal.js';
import { randomUUID } from 'node:crypto';
import { ZOTERO_ARTIFACT_PAGE_CHARS, } from '../contract.js';
import { ZoteroError, ZOTERO_INVALID_ARGUMENT, ZOTERO_NOT_FOUND, ZOTERO_PROVIDER_UNAVAILABLE, ZOTERO_ENRICHMENT_TASK_FAILED, } from '../errors.js';
/** Every resource has a bounded lifetime; no polling or source revalidation runs behind the user. */
export class ArtifactReads {
    deps;
    requests = new Map();
    tokens = new Map();
    draining = new Set();
    bytes = 0;
    closed = false;
    constructor(deps) {
        this.deps = deps;
    }
    key(peer, sessionId, requestId) {
        return JSON.stringify([peer.id, sessionId, requestId]);
    }
    arm(entry) {
        clearTimeout(entry.timer);
        const remaining = Math.max(0, Math.min(entry.policy.idleTimeoutMs, entry.started + entry.policy.maxLifetimeMs - Date.now()));
        entry.timer = setTimeout(() => {
            this.retire(entry);
            this.requests.delete(entry.key);
        }, remaining);
        entry.timer.unref();
    }
    releaseData(entry) {
        if (!entry.retired || entry.active !== 0)
            return;
        this.bytes -= entry.bytes;
        entry.bytes = 0;
        delete entry.candidate;
        delete entry.text;
        delete entry.task;
        entry.finish();
        this.draining.delete(entry);
    }
    retire(entry) {
        if (!entry.retired) {
            entry.retired = true;
            if (entry.active > 0)
                this.draining.add(entry);
            this.tokens.delete(entry.token);
            entry.abort.abort(new DOMException('Document read retired', 'AbortError'));
            const detach = entry.detach;
            delete entry.detach;
            detach?.();
        }
        this.releaseData(entry);
    }
    current(entry, owner) {
        if (entry.retired || entry.owner.peer.id !== owner.peer.id || entry.owner.agent !== owner.agent)
            throw new ZoteroError('The document read is no longer available. Reload the document.', ZOTERO_NOT_FOUND);
    }
    page(entry, offset) {
        const text = entry.text;
        if (offset > text.length)
            throw new ZoteroError('The document offset exceeds its length.', ZOTERO_INVALID_ARGUMENT);
        return {
            offset,
            text: text.slice(offset, offset + ZOTERO_ARTIFACT_PAGE_CHARS),
            totalChars: text.length,
        };
    }
    async request(request, signal, ctx) {
        signal.throwIfAborted();
        if (this.closed)
            throw new ZoteroError('Document reading is closed.', ZOTERO_PROVIDER_UNAVAILABLE);
        const peer = ctx.invocation?.peer;
        if (peer === undefined)
            throw new ZoteroError('Document reading requires an invocation peer.', ZOTERO_INVALID_ARGUMENT);
        if (request.op === 'release') {
            const key = this.key(peer, request.sessionId, request.requestId);
            const entry = this.requests.get(key);
            if (entry !== undefined)
                this.retire(entry);
            else
                this.tombstone(key, request.sessionId, peer);
            return { kind: 'released' };
        }
        let owner;
        try {
            owner = await this.deps.owner(request.sessionId, signal, ctx);
        }
        catch (error) {
            if (request.op === 'page' || request.op === 'image') {
                const entry = this.tokens.get(request.lease);
                if (entry?.owner.peer.id === peer.id && entry.sessionId === request.sessionId)
                    this.retire(entry);
            }
            throw error;
        }
        if (this.closed)
            throw new ZoteroError('Document reading is closed.', ZOTERO_PROVIDER_UNAVAILABLE);
        if (request.op === 'inspect') {
            const combined = AbortSignal.any([signal, peer.signal]);
            const candidate = await this.deps.candidate(request, combined);
            const checked = await this.deps.owner(request.sessionId, combined, ctx);
            if (checked.agent !== owner.agent)
                throw new ZoteroError('The document owner changed.', ZOTERO_NOT_FOUND);
            return 'kind' in candidate ? candidate : { kind: 'ready', ...candidate.metadata };
        }
        if (request.op === 'meta') {
            const combined = AbortSignal.any([signal, peer.signal]);
            const resolved = await this.deps.metadata(request, combined);
            const checked = await this.deps.owner(request.sessionId, combined, ctx);
            if (checked.agent !== owner.agent)
                throw new ZoteroError('The document owner changed.', ZOTERO_NOT_FOUND);
            return 'kind' in resolved ? resolved : { kind: 'meta', ...resolved.metadata };
        }
        if (request.op === 'probe') {
            const combined = AbortSignal.any([signal, peer.signal]);
            const probed = await this.deps.probe(request, combined);
            const checked = await this.deps.owner(request.sessionId, combined, ctx);
            if (checked.agent !== owner.agent)
                throw new ZoteroError('The document owner changed.', ZOTERO_NOT_FOUND);
            return probed;
        }
        if (request.op === 'open')
            return await this.open(request, owner, signal, ctx);
        const entry = this.tokens.get(request.lease);
        if (entry === undefined || entry.sessionId !== request.sessionId)
            throw new ZoteroError('The document read is no longer available. Reload the document.', ZOTERO_NOT_FOUND);
        this.current(entry, owner);
        entry.active++;
        this.arm(entry);
        const combined = AbortSignal.any([signal, peer.signal, entry.abort.signal]);
        let transferBytes = 0;
        try {
            combined.throwIfAborted();
            let result;
            if (request.op === 'page')
                result = {
                    kind: 'page',
                    lease: entry.token,
                    artifactId: entry.candidate.metadata.artifactId,
                    page: this.page(entry, request.offset),
                };
            else {
                const candidate = entry.candidate;
                const declared = candidate.metadata.images.find((image) => image.name === request.name);
                if (declared === undefined)
                    throw new ZoteroError('The figure does not belong to this document.', ZOTERO_INVALID_ARGUMENT);
                // File bytes, the encoding copy and UTF-16 base64 all coexist while returning the frame.
                const reserved = declared.bytes * 5;
                if (this.bytes + reserved > entry.policy.maxBytes)
                    throw new ZoteroError('Document image transfer capacity is full. Retry the preparation.', ZOTERO_PROVIDER_UNAVAILABLE);
                this.bytes += reserved;
                transferBytes = reserved;
                const image = await candidate.image(request.name);
                if (image === undefined)
                    throw new ZoteroError('A stored figure is missing. Reload or parse the document again.', ZOTERO_ENRICHMENT_TASK_FAILED);
                result = {
                    kind: 'image',
                    lease: entry.token,
                    artifactId: candidate.metadata.artifactId,
                    name: request.name,
                    mediaType: image.mediaType,
                    base64: Buffer.from(image.data).toString('base64'),
                };
            }
            combined.throwIfAborted();
            this.current(entry, await this.deps.owner(request.sessionId, combined, ctx));
            return result;
        }
        catch (error) {
            this.retire(entry);
            throw error;
        }
        finally {
            this.bytes -= transferBytes;
            entry.active--;
            this.releaseData(entry);
        }
    }
    tombstone(key, sessionId, peer) {
        const policy = this.deps.policy();
        if (this.requests.size >= policy.maxOpen * 64)
            throw new ZoteroError('Document read cleanup capacity is full. Retry later.', ZOTERO_PROVIDER_UNAVAILABLE);
        let finish;
        const entry = {
            key,
            token: randomUUID(),
            sessionId,
            owner: { peer },
            binding: '',
            policy,
            started: Date.now(),
            abort: new AbortController(),
            done: new Promise((resolve) => {
                finish = resolve;
            }),
            finish: () => finish(),
            bytes: 0,
            active: 0,
            retired: true,
        };
        this.requests.set(key, entry);
        finish();
        this.arm(entry);
    }
    async open(request, owner, signal, ctx) {
        const key = this.key(owner.peer, request.sessionId, request.requestId);
        const binding = JSON.stringify(request.target);
        const old = this.requests.get(key);
        if (old !== undefined) {
            this.current(old, owner);
            if (old.binding !== binding)
                throw new ZoteroError('The read request id belongs to another target.', ZOTERO_INVALID_ARGUMENT);
            this.arm(old);
            return await raceWithSignal(old.task, signal);
        }
        const policy = this.deps.policy();
        if (this.tokens.size + this.draining.size >= policy.maxOpen ||
            this.requests.size >= policy.maxOpen * 64)
            throw new ZoteroError('Too many documents are being prepared. Retry after a preparation finishes.', ZOTERO_PROVIDER_UNAVAILABLE);
        let finish;
        const entry = {
            key,
            token: randomUUID(),
            sessionId: request.sessionId,
            owner,
            binding,
            policy,
            started: Date.now(),
            abort: new AbortController(),
            done: new Promise((resolve) => {
                finish = resolve;
            }),
            finish: () => finish(),
            bytes: 0,
            active: 1,
            retired: false,
        };
        this.requests.set(key, entry);
        this.tokens.set(entry.token, entry);
        const retire = () => this.retire(entry);
        owner.peer.signal.addEventListener('abort', retire, { once: true });
        const detachAgent = owner.agent.ctx.effect(() => retire);
        entry.detach = () => {
            owner.peer.signal.removeEventListener('abort', retire);
            detachAgent();
        };
        this.arm(entry);
        const combined = AbortSignal.any([signal, owner.peer.signal, entry.abort.signal]);
        entry.task = (async () => {
            try {
                const candidate = await this.deps.candidate(request, combined);
                combined.throwIfAborted();
                this.current(entry, await this.deps.owner(request.sessionId, combined, ctx));
                if ('kind' in candidate) {
                    this.retire(entry);
                    return candidate;
                }
                const reserve = candidate.markdownBytes +
                    candidate.metadata.characterCount * 2 +
                    Buffer.byteLength(JSON.stringify(candidate.metadata));
                if (this.bytes + reserve > policy.maxBytes)
                    throw new ZoteroError('Document preparation memory is full. Close another preparation and retry.', ZOTERO_PROVIDER_UNAVAILABLE);
                this.bytes += reserve;
                entry.bytes = reserve;
                entry.candidate = candidate;
                const text = await candidate.read();
                combined.throwIfAborted();
                this.current(entry, await this.deps.owner(request.sessionId, combined, ctx));
                if (text.length !== candidate.metadata.characterCount)
                    throw new ZoteroError('The document length changed while opening it.', ZOTERO_ENRICHMENT_TASK_FAILED);
                entry.text = text;
                this.bytes -= candidate.markdownBytes;
                entry.bytes -= candidate.markdownBytes;
                return {
                    kind: 'opened',
                    ...candidate.metadata,
                    lease: entry.token,
                    expiresAt: Math.min(Date.now() + policy.idleTimeoutMs, entry.started + policy.maxLifetimeMs),
                    policy,
                    page: this.page(entry, 0),
                };
            }
            catch (error) {
                this.retire(entry);
                throw error;
            }
            finally {
                entry.active--;
                this.releaseData(entry);
            }
        })();
        return await entry.task;
    }
    retireAgent(agent) {
        for (const entry of this.requests.values())
            if (entry.owner.agent === agent)
                this.retire(entry);
    }
    /** Invalidate open leases for one artifact before its files are removed. */
    retireArtifact(artifactId) {
        for (const entry of this.requests.values())
            if (entry.candidate?.metadata.artifactId === artifactId)
                this.retire(entry);
        for (const entry of this.draining)
            if (entry.candidate?.metadata.artifactId === artifactId)
                this.retire(entry);
    }
    async dispose() {
        this.closed = true;
        const entries = [...new Set([...this.requests.values(), ...this.draining])];
        for (const entry of entries) {
            clearTimeout(entry.timer);
            this.retire(entry);
        }
        await Promise.all(entries.map((entry) => entry.done));
        this.requests.clear();
    }
}
//# sourceMappingURL=artifact-reads.js.map