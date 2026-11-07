/**
 * @module dsh-zotero/normalize-scope
 */
export interface ScopeNameEntry {
    readonly key: string;
    readonly name: string;
    /** Parent collection key; present only for non-root collections. */
    readonly parentKey?: string;
    /** Sub-collections Zotero counted (`meta.numCollections`); absent when unreported. */
    readonly childCount?: number;
    /** Items Zotero counted directly in this collection (`meta.numItems`); absent when unreported. */
    readonly itemCount?: number;
}
export declare function normalizeScopeEntry(json: unknown): ScopeNameEntry;
export declare function matchScopeName(entries: readonly ScopeNameEntry[], wanted: string): ScopeNameEntry[];
export declare function nearScopeCandidates(entries: readonly ScopeNameEntry[], wanted: string, limit?: number): ScopeNameEntry[];
//# sourceMappingURL=normalize-scope.d.ts.map