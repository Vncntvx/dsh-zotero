/** Structured citation-key facts shared by search, detail, and export views. */
export type CitationKeySource = 'native' | 'extra';
export interface CitationKeyConflict {
    readonly native: string;
    readonly extra: string;
}
export interface CitationKeyInfo {
    readonly citationKey?: string;
    readonly citationKeySource?: CitationKeySource;
    readonly citationKeyConflict?: CitationKeyConflict;
}
/** Parse the citekey convention used by Better BibTeX and legacy exports. */
export declare function citekeyOf(extra?: string): string | undefined;
/** Resolve Zotero's native field first, while retaining an explicit conflict. */
export declare function citationKeyInfoOf(data: Record<string, unknown> | undefined): CitationKeyInfo;
/** Format a citation-key conflict as `native=<native>; extra=<extra>`. */
export declare function formatCitationKeyConflict(conflict: CitationKeyConflict): string;
//# sourceMappingURL=citation-key.d.ts.map