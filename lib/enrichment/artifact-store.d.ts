import type { NormalizedContentList } from './zip.js';
import { withFileLock } from '@deepseek-ai/dsh-atomic-write';
import { z } from 'zod';
import { artifactMetaSchema, sourceIndexSchema, type SourceIndexRecord } from './artifact-schema.js';
import type { ZoteroArtifactImageMediaType } from '../contract.js';
import type { FulltextSourceStamp, ParsedArtifact } from './types.js';
export type { SourceIndexRecord } from './artifact-schema.js';
/** External filesystem and cross-process lock ports. */
export interface ArtifactStoreDeps {
    readonly mkdir: (path: string) => Promise<void>;
    readonly readFile: (path: string) => Promise<Uint8Array>;
    readonly writeFile: (path: string, data: Uint8Array | string) => Promise<void>;
    readonly rename: (from: string, to: string) => Promise<void>;
    readonly rm: (path: string, options: {
        recursive: boolean;
        force: boolean;
    }) => Promise<void>;
    readonly readArtifactFile?: (path: string, maxBytes: number) => Promise<Uint8Array>;
    readonly readSourceIndex?: (path: string, maxBytes: number) => Promise<Uint8Array>;
    readonly withSourceLock?: typeof withFileLock;
    /** Directory enumeration for orphan recovery; host-only ports when omitted. */
    readonly readdir?: (path: string) => Promise<readonly string[]>;
    readonly stat?: (path: string) => Promise<{
        readonly mtimeMs: number;
    }>;
    readonly realpath?: (path: string) => Promise<string>;
}
/** The on-disk state of one parsed artifact, independent of its source-index pointer. */
export interface StoredArtifactMeta {
    readonly meta: z.infer<typeof artifactMetaSchema>;
    readonly committedAt: number;
}
/** One inventory row: an artifact's cached meta, or the fact that it is unreadable. */
export interface InventoryEntry {
    readonly cacheKey: string;
    readonly stored?: StoredArtifactMeta;
    /**
     * meta.json exists but could not be read or parsed. The raw message stays
     * host-side: it is sanitized at the wire boundary, never cached to disk.
     */
    readonly failureMessage?: string;
}
/** The source-index view of one artifact: its record and every alias key. */
export interface ArtifactGroup {
    readonly record?: SourceIndexRecord;
    readonly aliases: readonly string[];
}
declare const taskReceipt: z.ZodDiscriminatedUnion<[z.ZodObject<{
    taskId: z.ZodString;
    createdAt: z.ZodNumber;
    uploaded: z.ZodLiteral<true>;
}, z.core.$strict>, z.ZodObject<{
    taskId: z.ZodString;
    createdAt: z.ZodNumber;
    uploaded: z.ZodLiteral<false>;
    uploadUrl: z.ZodString;
}, z.core.$strict>], "uploaded">;
export type ParseTaskRecord = z.infer<typeof taskReceipt>;
export declare class ParsedArtifactStore {
    readonly root: string;
    private readonly deps;
    private rootEnsured;
    /** Every attempted write advances this; per-generation read caches invalidate on it. */
    private writes;
    private inventoryCache;
    constructor(root: string, deps?: ArtifactStoreDeps);
    /**
     * Any attempted write invalidates the read caches, whether or not it
     * succeeds: a failed atomic write may still have mutated the target, so
     * every write method opens with this. A new store write path must do the
     * same or the inventory cache goes stale (see DN-4). The source index
     * itself is deliberately read per call — its I/O failures must surface,
     * never hide behind a cache.
     */
    private touch;
    private ensureRoot;
    private dir;
    private taskPath;
    private indexPath;
    private atomicWrite;
    getTask(cacheKey: string): Promise<ParseTaskRecord | undefined>;
    putTask(cacheKey: string, task: ParseTaskRecord): Promise<void>;
    deleteTask(cacheKey: string): Promise<void>;
    /** Reads never create directories, acquire locks, evict, or repair corrupt data. */
    get(cacheKey: string): Promise<ParsedArtifact | undefined>;
    /** Validate before I/O; meta.json is the artifact's final commit marker. */
    put(cacheKey: string, artifact: ParsedArtifact): Promise<void>;
    /** Only the archive normalizer produces this semantic content-list type. */
    putNormalized(cacheKey: string, artifact: ParsedArtifact & {
        readonly contentList?: NormalizedContentList;
    }): Promise<void>;
    private persist;
    /** Read metadata against the already validated source-index pointer. */
    metadataFor(record: SourceIndexRecord): Promise<z.infer<typeof artifactMetaSchema> | undefined>;
    private readBounded;
    readMarkdown(cacheKey: string, characterCount: number, byteCount: number): Promise<string>;
    /** The caller supplies metadata captured by its source-bound read snapshot. */
    readImage(cacheKey: string, name: string, captured?: z.infer<typeof artifactMetaSchema>): Promise<{
        readonly data: Uint8Array;
        readonly mediaType: ZoteroArtifactImageMediaType;
    } | undefined>;
    private sourceSnapshot;
    /** The whole validated index; management lists from this rather than per-target probes. */
    snapshot(): Promise<z.infer<typeof sourceIndexSchema>>;
    /** Read a committed artifact's meta without an index record; undefined when absent. */
    metaFor(cacheKey: string): Promise<StoredArtifactMeta | undefined>;
    /** Directory names are cache keys; a symlink or unexpected root is refused. */
    listArtifactDirectories(): Promise<readonly string[]>;
    /**
     * One pass over the index: every artifact id with its record and all alias
     * keys, redirect aliases included. Management lists and discards group from
     * this instead of rescanning the index per artifact.
     */
    groupByArtifact(): Promise<ReadonlyMap<string, ArtifactGroup>>;
    /**
     * Every committed artifact, both index-backed and orphaned directories,
     * with its cached meta. Cached between writes: a page flip, refresh or
     * discard-driven refetch re-reads nothing until the store is written again.
     */
    inventory(signal?: AbortSignal): Promise<readonly InventoryEntry[]>;
    /** Whether the artifact directory exists as a regular, expected filesystem entry. */
    hasArtifactDirectory(cacheKey: string): Promise<boolean>;
    /**
     * Remove one committed artifact completely under the publication lock, so a
     * concurrent publication cannot re-point an alias at a removed directory:
     * aliases go first (the index pointer is the marker), then the directory,
     * then the task file. The caller has already retired the artifact's readers
     * and parse receipts.
     */
    discardArtifact(cacheKey: string, signal?: AbortSignal): Promise<number>;
    /** Remove every alias of one artifact; the caller holds the publication lock. */
    private deleteSourcesLocked;
    /** Remove the artifact directory; the caller has already retired its readers. */
    private removeArtifactDir;
    /** One rename commits all primary/verified aliases, retaining unrelated sources. */
    putSources(sourceKeys: readonly string[], record: SourceIndexRecord, signal?: AbortSignal): Promise<void>;
    putSource(sourceKey: string, record: SourceIndexRecord, signal?: AbortSignal): Promise<void>;
    sourceRecord(sourceKey: string): Promise<SourceIndexRecord | undefined>;
    /** The caller may have already read the candidate before probing its source. */
    artifactFor(record: SourceIndexRecord): Promise<ParsedArtifact | undefined>;
    lookupSource(sourceKey: string, stamp: FulltextSourceStamp): Promise<ParsedArtifact | undefined>;
}
//# sourceMappingURL=artifact-store.d.ts.map