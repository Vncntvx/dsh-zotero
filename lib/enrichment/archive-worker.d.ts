/** Cancelable per-service archive admission; a slot lasts through persistence. */
import { Worker } from 'node:worker_threads';
import { type ArtifactReaderPreferences } from '../artifact-reader-preferences.js';
import type { ExtractedParsedFiles } from './zip.js';
export type ArchiveWorkerFactory = (entry: URL, bytes: Uint8Array) => Worker;
export declare class ArchiveProcessor {
    private readonly policy;
    private readonly factory;
    private running;
    private readonly queue;
    constructor(policy?: () => ArtifactReaderPreferences, factory?: ArchiveWorkerFactory);
    private release;
    private drain;
    private acquire;
    run<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T>;
    extract(input: Uint8Array, signal: AbortSignal): Promise<ExtractedParsedFiles>;
}
//# sourceMappingURL=archive-worker.d.ts.map