/** Private, bounded reading files for the Harness's public file-preview seam. */
import { mkdtemp, writeFile, rm, realpath, readdir, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ZoteroError } from '../errors.js';
export class PdfReadingFiles {
    files = new Map();
    pending = new Set();
    disposed = false;
    cleanup;
    /** Only this plugin's private directories belonging to exited processes are reclaimed. */
    async removeAbandoned() {
        for (const entry of await readdir(tmpdir(), { withFileTypes: true })) {
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
            const path = join(tmpdir(), entry.name);
            try {
                const info = await lstat(path);
                if (info.isDirectory() && info.uid === process.getuid?.())
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
            throw new ZoteroError('Close a URL PDF reader before opening another.', 'ZOTERO_URL_PDF_BUSY');
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
        const directory = await mkdtemp(join(tmpdir(), `dsh-zotero-pdf-${process.pid}-`));
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
            return;
        await rm(directory, { recursive: true, force: true });
        this.files.delete(lease);
    }
    async dispose() {
        this.disposed = true;
        await Promise.allSettled([...this.pending]);
        await Promise.all([...this.files.keys()].map((lease) => this.release(lease)));
    }
}
//# sourceMappingURL=pdf-files.js.map