/**
 * Open-access text cache. HTML/JATS bodies and locally extracted PDF text live
 * on disk; MinerU bodies remain owned by enrichment and are looked up per read.
 * @module dsh-zotero/scholarly/fulltext/store
 */
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write';
import { join } from 'node:path';
import { dshCachePath } from '@deepseek-ai/dsh-home-paths';
import { readRegularFile } from '../../regular-file.js';
import { errorDetailOf } from '../../errors.js';
const CACHE_VERSION = 3;
const CACHE_DIRECTORY = `v${CACHE_VERSION}`;
const MAX_RECORD_BYTES = 4 * 1_048_576;
const DEFAULT_MEMORY_ITEMS = 8;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_MAX_RECORDS = 256;
const CACHE_MAX_BYTES = 128 * 1_048_576;
/** Same-source URL identity: preserve query spelling/order, remove only the fragment. */
export function scholarlySourceIdentityOf(raw) {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new Error('scholarly store: source must be an HTTP(S) URL');
    }
    url.hash = '';
    return url.href;
}
function fileNameOf(key) {
    return `${createHash('sha256').update(key, 'utf8').digest('hex')}.json`;
}
function objectOf(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : undefined;
}
function hasKeys(value, required, optional = []) {
    return (required.every((key) => Object.hasOwn(value, key)) &&
        Object.keys(value).every((key) => required.includes(key) || optional.includes(key)));
}
function validSource(value) {
    if (typeof value.url !== 'string' || typeof value.sourceIdentity !== 'string')
        return false;
    try {
        return (value.url === value.sourceIdentity &&
            scholarlySourceIdentityOf(value.url) === value.sourceIdentity);
    }
    catch {
        return false;
    }
}
function bodyOf(value) {
    const body = objectOf(value);
    if (!body ||
        !hasKeys(body, ['provider', 'format', 'text', 'source', 'url', 'sourceIdentity']) ||
        typeof body.text !== 'string' ||
        typeof body.source !== 'string' ||
        !validSource(body))
        return undefined;
    const base = {
        text: body.text,
        source: body.source,
        url: String(body.url),
        sourceIdentity: String(body.sourceIdentity),
    };
    if (body.provider === 'pdf-extract' && body.format === 'text') {
        return { ...base, provider: body.provider, format: body.format };
    }
    if ((body.provider === 'arxiv-html' ||
        body.provider === 'ar5iv-html' ||
        body.provider === 'pmc-jats') &&
        body.format === 'markdown') {
        return { ...base, provider: body.provider, format: body.format };
    }
    return undefined;
}
function entryOf(value) {
    const entry = objectOf(value);
    if (!entry)
        return undefined;
    if (entry.kind === 'document' && hasKeys(entry, ['kind', 'record'])) {
        const record = bodyOf(entry.record);
        return record && record.provider !== 'pdf-extract' ? { kind: 'document', record } : undefined;
    }
    if (entry.kind !== 'pdf' ||
        !hasKeys(entry, ['kind', 'url', 'sourceIdentity'], ['record']) ||
        !validSource(entry))
        return undefined;
    const base = {
        kind: 'pdf',
        url: String(entry.url),
        sourceIdentity: String(entry.sourceIdentity),
    };
    if (!Object.hasOwn(entry, 'record'))
        return base;
    const record = bodyOf(entry.record);
    if (!record ||
        record.provider !== 'pdf-extract' ||
        record.sourceIdentity !== entry.sourceIdentity)
        return undefined;
    return { ...base, record };
}
/**
 * A small memory index fronts a closed, versioned disk envelope. Old namespaces
 * are neither read nor migrated. Corrupt records are evicted and reported.
 */
export class ScholarlyTextStore {
    root;
    memoryItems;
    memory = new Map();
    invalidated = new Set();
    diskReadsDisabled = false;
    disposed = false;
    rootEnsured;
    writing = Promise.resolve();
    policy;
    constructor(root = dshCachePath('zotero-scholarly'), memoryItems = DEFAULT_MEMORY_ITEMS, policy = {}) {
        this.root = root;
        this.memoryItems = memoryItems;
        this.policy = {
            ttlMs: CACHE_TTL_MS,
            maxRecords: CACHE_MAX_RECORDS,
            maxBytes: CACHE_MAX_BYTES,
            now: Date.now,
            ...policy,
        };
        for (const value of [this.policy.ttlMs, this.policy.maxRecords, this.policy.maxBytes])
            if (!Number.isSafeInteger(value) || value < 1)
                throw new Error('Invalid scholarly cache bound');
    }
    ensureRoot() {
        if (!this.rootEnsured) {
            this.rootEnsured = mkdir(join(this.root, CACHE_DIRECTORY), { recursive: true }).then(() => { }, (error) => {
                this.rootEnsured = undefined;
                throw error;
            });
        }
        return this.rootEnsured;
    }
    async get(key) {
        if (this.disposed)
            return { kind: 'miss' };
        const cached = this.memory.get(key);
        if (cached) {
            if (this.policy.now() - cached.createdAt >= this.policy.ttlMs) {
                return this.expire(key);
            }
            this.remember(key, cached.entry, cached.createdAt);
            return { kind: 'hit', entry: cached.entry };
        }
        if (this.diskReadsDisabled)
            return { kind: 'miss' };
        if (this.invalidated.has(key))
            return this.expire(key);
        const revision = this.writing;
        const diskReadCurrent = () => !this.disposed && revision === this.writing;
        await revision;
        if (!diskReadCurrent())
            return { kind: 'miss' };
        const path = join(this.root, CACHE_DIRECTORY, fileNameOf(key));
        const corrupt = async (reason) => {
            const issue = await this.delete(key);
            return { kind: 'corrupt', reason, ...(issue === undefined ? {} : { issue }) };
        };
        let raw;
        try {
            raw = (await readRegularFile(path, MAX_RECORD_BYTES)).toString('utf8');
        }
        catch (error) {
            if (!diskReadCurrent())
                return { kind: 'miss' };
            const code = error.code;
            return code === 'ENOENT'
                ? { kind: 'miss' }
                : await corrupt(`unreadable (${String(code ?? error)})`);
        }
        if (!diskReadCurrent())
            return { kind: 'miss' };
        if (Buffer.byteLength(raw, 'utf8') > MAX_RECORD_BYTES)
            return await corrupt('record size');
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            return await corrupt('malformed JSON');
        }
        const envelope = objectOf(parsed);
        if (!envelope ||
            !hasKeys(envelope, ['version', 'key', 'entry']) ||
            envelope.version !== CACHE_VERSION) {
            return await corrupt('record shape');
        }
        if (envelope.key !== key)
            return await corrupt('cache key mismatch');
        const fileInfo = await stat(path).catch(() => undefined);
        if (fileInfo === undefined || !diskReadCurrent())
            return { kind: 'miss' };
        if (this.policy.now() - fileInfo.mtimeMs >= this.policy.ttlMs) {
            return this.expire(key);
        }
        const entry = entryOf(envelope.entry);
        if (!entry)
            return await corrupt('record shape');
        this.remember(key, entry, fileInfo.mtimeMs);
        return { kind: 'hit', entry };
    }
    /** Persist source targets and ordinary text, never an enrichment-owned body. */
    async set(key, record) {
        if (this.disposed)
            return;
        const entry = record.provider === 'mineru'
            ? { kind: 'pdf', url: record.url, sourceIdentity: record.sourceIdentity }
            : record.provider === 'pdf-extract'
                ? { kind: 'pdf', url: record.url, sourceIdentity: record.sourceIdentity, record }
                : { kind: 'document', record };
        const validated = entryOf(entry);
        if (!validated)
            throw new Error('scholarly store: invalid record');
        const encoded = JSON.stringify({
            version: CACHE_VERSION,
            key,
            entry: validated,
        });
        if (Buffer.byteLength(encoded, 'utf8') > MAX_RECORD_BYTES) {
            throw new Error(`scholarly store: record "${key}" exceeds the ${MAX_RECORD_BYTES}-byte cache ceiling`);
        }
        const writing = this.writing.then(async () => {
            await this.ensureRoot();
            if (this.disposed)
                return;
            const path = join(this.root, CACHE_DIRECTORY, fileNameOf(key));
            await writeFileAtomic(path, encoded, { mode: 0o600, dirMode: 0o700 });
            this.invalidated.delete(key);
            if (!this.disposed)
                this.remember(key, validated, this.policy.now());
            await this.prune();
        });
        this.writing = writing.catch(() => { });
        await writing;
    }
    async delete(key) {
        this.memory.delete(key);
        if (!this.diskReadsDisabled) {
            this.invalidated.add(key);
            if (this.invalidated.size > this.policy.maxRecords) {
                this.diskReadsDisabled = true;
                this.invalidated.clear();
            }
        }
        const deletion = this.writing.then(async () => {
            this.memory.delete(key);
            try {
                await rm(join(this.root, CACHE_DIRECTORY, fileNameOf(key)), { force: true });
                this.invalidated.delete(key);
                return undefined;
            }
            catch (error) {
                return `cache: disk eviction failed (${errorDetailOf(error)})`;
            }
        });
        this.writing = deletion.then(() => { });
        return deletion;
    }
    async expire(key) {
        const issue = await this.delete(key);
        return { kind: 'miss', ...(issue === undefined ? {} : { issue }) };
    }
    dispose() {
        this.disposed = true;
        this.memory.clear();
        this.invalidated.clear();
    }
    async prune() {
        const root = join(this.root, CACHE_DIRECTORY);
        const entries = await readdir(root, { withFileTypes: true });
        const records = (await Promise.all(entries
            .filter((entry) => entry.isFile() && /^[a-f0-9]{64}\.json$/.test(entry.name))
            .map(async (entry) => {
            try {
                const info = await stat(join(root, entry.name));
                return { name: entry.name, bytes: info.size, createdAt: info.mtimeMs };
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    return undefined;
                throw error;
            }
        })))
            .filter((record) => record !== undefined)
            .sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name));
        let count = records.length, bytes = records.reduce((sum, record) => sum + record.bytes, 0);
        const removed = new Set();
        for (const record of records) {
            if (this.policy.now() - record.createdAt < this.policy.ttlMs &&
                count <= this.policy.maxRecords &&
                bytes <= this.policy.maxBytes)
                continue;
            await rm(join(root, record.name), { force: true });
            removed.add(record.name);
            count--;
            bytes -= record.bytes;
        }
        for (const key of this.memory.keys())
            if (removed.has(fileNameOf(key)))
                this.memory.delete(key);
    }
    remember(key, entry, createdAt) {
        this.memory.delete(key);
        this.memory.set(key, { entry, createdAt });
        if (this.memory.size <= this.memoryItems)
            return;
        const oldest = this.memory.keys().next().value;
        if (oldest !== undefined)
            this.memory.delete(oldest);
    }
}
//# sourceMappingURL=store.js.map