import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write';
import { readRegularFile } from '../regular-file.js';
import { zoteroJournalMetricsReadySchema } from '../wire-schemas.js';
import { journalNameOf } from '../journal-metrics.js';
import { asRecord } from '../json.js';
export const JOURNAL_METRICS_CACHE_LIMIT = 512;
const MAX_BYTES = 256 * 1024;
const recordName = /^[a-f0-9]{64}\.json$/;
/** Successful snapshots survive a restart. File names hash the credential digest and journal name. */
export class JournalMetricsCache {
    root;
    constructor(root) {
        this.root = root;
    }
    path(digest, journal) {
        const key = createHash('sha256').update(digest).update(journal).digest('hex');
        return join(this.root, `${key}.json`);
    }
    async readPath(path) {
        try {
            const bytes = await readRegularFile(path, MAX_BYTES);
            const data = asRecord(JSON.parse(bytes.toString('utf8')));
            const publicationName = journalNameOf(data?.publicationName);
            const record = zoteroJournalMetricsReadySchema.safeParse(data?.result ?? data);
            if (record.success && record.data.fetchedAt <= Date.now()) {
                return { result: record.data, publicationName };
            }
        }
        catch {
            // Ignore missing, unreadable, or corrupt entries; the next lookup replaces them.
        }
        return undefined;
    }
    async read(digest, journal) {
        const saved = await this.readPath(this.path(digest, journal));
        return saved?.publicationName === undefined || saved.publicationName === journal
            ? saved
            : undefined;
    }
    async journals(digest, signal) {
        const names = await readdir(this.root).catch((error) => {
            if (error.code === 'ENOENT')
                return [];
            throw error;
        });
        const journals = [];
        for (const name of names.filter((name) => recordName.test(name))) {
            signal.throwIfAborted();
            const path = join(this.root, name);
            const saved = await this.readPath(path);
            const journal = saved?.publicationName;
            if (journal && this.path(digest, journal) === path)
                journals.push(journal);
        }
        return journals;
    }
    async write(digest, journal, record) {
        const data = JSON.stringify({ publicationName: journal, result: record });
        if (Buffer.byteLength(data) > MAX_BYTES)
            return;
        await mkdir(this.root, { recursive: true, mode: 0o700 });
        await withFileLock(join(this.root, 'cache'), async () => {
            const previous = await this.read(digest, journal);
            if (previous && previous.result.fetchedAt > record.fetchedAt)
                return;
            await writeFileAtomic(this.path(digest, journal), data, { mode: 0o600, dirMode: 0o700 });
            const names = (await readdir(this.root)).filter((name) => recordName.test(name));
            if (names.length <= JOURNAL_METRICS_CACHE_LIMIT)
                return;
            const entries = await Promise.all(names.map(async (name) => {
                const path = join(this.root, name);
                return { path, modified: (await lstat(path)).mtimeMs };
            }));
            entries.sort((left, right) => left.modified - right.modified);
            await Promise.all(entries
                .slice(0, names.length - JOURNAL_METRICS_CACHE_LIMIT)
                .map(({ path }) => rm(path, { force: true })));
        });
    }
}
//# sourceMappingURL=journal-metrics-cache.js.map