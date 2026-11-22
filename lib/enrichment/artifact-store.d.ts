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
    /**
     * The atomic replacement. The host default is the upstream
     * `writeFileAtomic` with the store's permission bits and an abort veto
     * before the commit; an injected deps object must supply its own — that is
     * the fixture's file map, which cannot honor a real temp+rename.
     */
    readonly writeAtomic: (path: string, data: Uint8Array | string, signal?: AbortSignal) => Promise<void>; /** Directory enumeration for orphan recovery; host-only ports when omitted. */
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
type ParseTaskRecord = z.infer<typeof taskReceipt>;
export declare class ParsedArtifactStore {
    #private;
    readonly root: string;
    private readonly deps;
    private rootEnsured;
    private inventoryCache;
    constructor(root: string, deps?: ArtifactStoreDeps);
    /**
     * Every attempted write advances this. Read-through caches key on it: a
     * store write is the one signal that any earlier read may now be stale,
     * whether or not the write succeeded.
     */
    get writes(): number;
    /**
     * Any attempted write invalidates the read caches, whether or not it
     * succeeds: a failed atomic write may still have mutated the target, so
     * every write method opens with this. A new store write path must do the
     * same or the inventory cache goes stale (see the artifact inventory
     * write-generation rule in docs/architecture.md). The source index
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
    /** Read exactly `byteCount` bytes: a shorter answer is a truncated artifact. */
    private readExact;
    readMarkdown(cacheKey: string, characterCount: number, byteCount: number, sha256: string): Promise<string>;
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
    groupByArtifact(snapshot?: Awaited<ReturnType<ParsedArtifactStore['snapshot']>>): Promise<ReadonlyMap<string, ArtifactGroup>>;
    /**
     * Every committed artifact, both index-backed and orphaned directories,
     * with its cached meta. Cached between writes: a page flip, refresh or
     * discard-driven refetch re-reads nothing until the store is written again.
     */
    inventory(signal?: AbortSignal, provided?: Awaited<ReturnType<ParsedArtifactStore['snapshot']>>, fresh?: boolean): Promise<readonly InventoryEntry[]>;
    /** Whether the artifact directory exists as a regular, expected filesystem entry. */
    hasArtifactDirectory(cacheKey: string): Promise<boolean>;
    /**
     * Remove one committed artifact under the source-index lock. The caller
     * has reserved and drained its generation; the lock serializes other index
     * edits. Remove aliases first, then the directory and task receipt.
     */
    discardArtifact(cacheKey: string, signal?: AbortSignal, afterDiscard?: () => Promise<void>): Promise<number>;
    /** Serialize a derived index update with source publication and artifact deletion. */
    withSourcePublicationLock<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T>;
    /** Remove every alias of one artifact; the caller holds the publication lock. */
    private deleteSourcesLocked;
    /** Remove the artifact directory; the caller has already retired its readers. */
    private removeArtifactDir;
    /** One rename commits all primary/verified aliases, retaining unrelated sources. */
    putSources(sourceKeys: readonly string[], record: SourceIndexRecord, signal?: AbortSignal): Promise<void>;
    putSource(sourceKey: string, record: SourceIndexRecord, signal?: AbortSignal): Promise<void>;
    sourceRecord(sourceKey: string): Promise<SourceIndexRecord | undefined>;
    /**
     * The caller may have already read the candidate before probing its source,
     * and may carry the meta that read produced, so one lookup reads meta.json
     * once. Without a captured meta the record's own meta is read here.
     */
    artifactFor(record: SourceIndexRecord, captured?: StoredArtifactMeta): Promise<ParsedArtifact | undefined>;
    lookupSource(sourceKey: string, stamp: FulltextSourceStamp): Promise<ParsedArtifact | undefined>;
}
//# sourceMappingURL=artifact-store.d.ts.map