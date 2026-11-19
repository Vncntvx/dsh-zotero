/**
 * Shared domain types and limits for the MinerU document-enrichment component.
 * Pure data only — no host imports, so unit tests and the store can share it.
 * @module dsh-zotero/enrichment/types
 */
import { type EnrichmentMode } from '../enrichment-preferences.js';
import type { ZoteroArtifactImageMediaType } from '../contract.js';
import type { FulltextEnhancerInput } from '../local/fulltext-enhancer.js';
/** Source validators are private to enrichment, never an upload input to core reads. */
export type FulltextSourceStamp = {
    readonly kind: 'file';
    readonly size: number;
    readonly mtimeMs: number;
} | {
    readonly kind: 'url';
    readonly url: string;
    readonly etag?: string;
    readonly lastModified?: string;
    readonly contentLength?: number;
} | {
    readonly kind: 'bytes';
    readonly fingerprint: string;
};
/** Internal acquisition input; browser requests never supply bytes or source stamps. */
export interface ParseSourceInput extends FulltextEnhancerInput {
    readonly bytes?: Uint8Array;
    readonly sourceStamp?: FulltextSourceStamp;
    /**
     * The attachment as the core already reported it, when the caller resolved
     * it during target validation: the source probe then stats or HEADs without
     * a second resolution round-trip. Structurally `ResolvedAttachment`.
     */
    readonly resolvedAttachment?: {
        readonly kind: 'file' | 'url';
        readonly path?: string;
        readonly url?: string;
    };
}
/** Local byte and remote page limits, shared with the submission confirmation. */
export declare function limitsFor(mode: EnrichmentMode): {
    readonly maxBytes: number;
    readonly maxPages: number;
};
/** Provenance stored alongside one committed Markdown artifact in `meta.json`. */
export interface ParsedArtifactMeta {
    readonly version: 2;
    readonly parser: 'mineru';
    readonly format: 'markdown';
    /** SHA-256 of the canonical primary identity, never the alias used to read. */
    readonly sourceId: string;
    readonly generation: string;
    /** Canonical attachment ref or origin-only redacted URL display. */
    readonly identity: string;
    /** Canonical URL for a URL-sourced artifact; absent for Zotero attachments. */
    readonly sourceUrl?: string;
    readonly mode: EnrichmentMode;
    /** SHA-256 of the exact bytes that were sent. */
    readonly contentFingerprint: string;
    readonly taskId: string;
    /** The exact files represented by this artifact, in commit order. */
    readonly files: readonly ['full.md'] | readonly ['full.md', 'content_list.json'];
    /** Figures the stored Markdown references, in name order. */
    readonly images?: readonly ParsedImageMeta[];
    readonly pageCount?: number;
    /** The Markdown H1, captured at commit; the tab chip names the paper with it. */
    readonly title?: string;
}
/** One figure kept beside the Markdown it belongs to. */
export interface ParsedImageMeta {
    /** `images/<file>`, exactly the reference `full.md` carries. */
    readonly name: string;
    readonly mediaType: ZoteroArtifactImageMediaType;
    readonly bytes: number;
}
/** One parsed document, ready to be returned as full text. */
export interface ParsedArtifact {
    /** `full.md` content — the high-quality Markdown the model reads. */
    readonly markdown: string;
    /** `*_content_list.json` content, present for the precise API. */
    readonly contentList?: string;
    /** Figure bytes, in the order the meta lists them. */
    readonly images?: readonly {
        readonly name: string;
        readonly data: Uint8Array;
    }[];
    readonly meta: ParsedArtifactMeta;
}
//# sourceMappingURL=types.d.ts.map