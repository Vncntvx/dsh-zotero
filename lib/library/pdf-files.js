/** Private, bounded reading files for the Harness's public file-preview seam. */
import { mkdtemp, writeFile, rm, realpath, readdir, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ZoteroError, ZOTERO_URL_PDF_BUSY } from '../errors.js';
export class PdfReadingFiles {
    root;
    ownerUid;
    files = new Map();
    pending = new Set();
    disposed = false;
    cleanup;
    /**
     * @param root - the directory the reading files live in; the process temp
     * directory unless a test supplies its own, so an abandoned-directory reap
     * can be driven without inspecting the shared one.
     */
    constructor(root = tmpdir(), ownerUid = () => process.getuid?.()) {
        this.root = root;
        this.ownerUid = ownerUid;
    }
    /** Only this plugin's private directories belonging to exited processes are reclaimed. */
    async removeAbandoned() {
        for (const entry of await readdir(this.root, { withFileTypes: true })) {
            const match = /^dsh-zotero-pdf-(\d+)-[A-Za-z0-9]+$/.exec(entry.name);
            if (!match || !entry.isDirectory())
                continue;
            const pid = Number(match[1]);
            try {
                process.kill(pid, 0);
                continue;
            }
            catch (error) {
                if (error.code !== 'ESRCH')
                    continue;
            }
            const path = join(this.root, entry.name);
            try {
                const info = await lstat(path);
                const uid = this.ownerUid();
                // Windows uses the current user's TEMP directory and has no POSIX uid.
                // POSIX temp roots are shared, so their owner check remains mandatory.
                if (info.isDirectory() && (uid === undefined || info.uid === uid))
                    await rm(path, { recursive: true, force: true });
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
            }
        }
    }
    async stage(data, signal) {
        if (this.disposed || this.files.size + this.pending.size >= 16)
            throw new ZoteroError('Close a URL PDF reader before opening another.', ZOTERO_URL_PDF_BUSY);
        const task = this.create(data, signal);
        this.pending.add(task);
        try {
            return await task;
        }
        finally {
            this.pending.delete(task);
        }
    }
    async create(data, signal) {
        signal.throwIfAborted();
        await (this.cleanup ??= this.removeAbandoned().catch((error) => {
            this.cleanup = undefined;
            throw error;
        }));
        const directory = await mkdtemp(join(this.root, `dsh-zotero-pdf-${process.pid}-`));
        try {
            const path = join(directory, 'document.pdf');
            await writeFile(path, data, { mode: 0o600, signal });
            signal.throwIfAborted();
            if (this.disposed)
                throw new Error('PDF reader has been disposed.');
            const resolvedPath = await realpath(path);
            const lease = randomUUID();
            this.files.set(lease, directory);
            return { path: resolvedPath, lease };
        }
        catch (error) {
            await rm(directory, { recursive: true, force: true });
            throw error;
        }
    }
    async release(lease) {
        const directory = this.files.get(lease);
        if (!directory)
            return false;
        await rm(directory, { recursive: true, force: true });
        this.files.delete(lease);
        return true;
    }
    async dispose() {
        this.disposed = true;
        await Promise.allSettled([...this.pending]);
        await Promise.all([...this.files.keys()].map((lease) => this.release(lease)));
    }
}
//# sourceMappingURL=pdf-files.js.map