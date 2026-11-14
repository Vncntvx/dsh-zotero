import type { FulltextArtifactProvenance } from '../../local/fulltext-enhancer.js';
interface FullTextBody {
    readonly text: string;
    readonly source: string;
    readonly url: string;
    /** Canonical route URL, including its query, without the fragment. */
    readonly sourceIdentity: string;
}
export type MarkdownRecord = FullTextBody & {
    readonly provider: 'arxiv-html' | 'ar5iv-html' | 'pmc-jats';
    readonly format: 'markdown';
    readonly provenance?: never;
};
export type PdfTextRecord = FullTextBody & {
    readonly provider: 'pdf-extract';
    readonly format: 'text';
    readonly provenance?: never;
};
/** The actual artifact provenance may identify a verified attachment alias. */
export type MineruRecord = FullTextBody & {
    readonly provider: 'mineru';
    readonly format: 'markdown';
    readonly provenance: FulltextArtifactProvenance;
};
export type FullTextRecord = MarkdownRecord | PdfTextRecord | MineruRecord;
/** A PDF target survives an artifact hit; the artifact body never enters this cache. */
export type FullTextCacheEntry = {
    readonly kind: 'document';
    readonly record: MarkdownRecord;
} | {
    readonly kind: 'pdf';
    readonly url: string;
    readonly sourceIdentity: string;
    readonly record?: PdfTextRecord;
};
export type FullTextRead = {
    readonly kind: 'hit';
    readonly entry: FullTextCacheEntry;
} | {
    readonly kind: 'miss';
} | {
    readonly kind: 'corrupt';
    readonly reason: string;
};
/** Same-source URL identity: preserve query spelling/order, remove only the fragment. */
export declare function scholarlySourceIdentityOf(raw: string): string;
/**
 * A small memory index fronts a closed, versioned disk envelope. Old namespaces
 * are neither read nor migrated. Corrupt records are evicted and reported.
 */
export declare class ScholarlyTextStore {
    readonly root: string;
    private readonly memoryItems;
    private readonly memory;
    private disposed;
    private rootEnsured;
    constructor(root?: string, memoryItems?: number);
    private ensureRoot;
    get(key: string): Promise<FullTextRead>;
    /** Persist source targets and ordinary text, never an enrichment-owned body. */
    set(key: string, record: FullTextRecord): Promise<void>;
    /** Expiry removes both tiers before any refetch; deletion failures stay explicit. */
    delete(key: string): Promise<void>;
    dispose(): void;
    private remember;
}
export {};
//# sourceMappingURL=store.d.ts.map