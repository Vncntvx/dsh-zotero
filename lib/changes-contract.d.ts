/** Shared pure wire descriptors for the `zotero_changes` projection. */
export declare const CHANGE_SECTIONS: readonly [{
    readonly key: "items";
    readonly label: "toolChangesItems";
}, {
    readonly key: "childItems";
    readonly label: "toolChangesChildItems";
}, {
    readonly key: "trashedItems";
    readonly label: "toolChangesTrashedItems";
}, {
    readonly key: "collections";
    readonly label: "toolChangesCollections";
}, {
    readonly key: "savedSearches";
    readonly label: "toolChangesSavedSearches";
}, {
    readonly key: "fulltextAttachments";
    readonly label: "toolChangesFulltext";
}];
export declare const DELETION_SECTIONS: readonly [{
    readonly key: "items";
    readonly label: "toolDeletedItems";
    readonly totalKey: "deletedItems";
}, {
    readonly key: "collections";
    readonly label: "toolDeletedCollections";
    readonly totalKey: "deletedCollections";
}, {
    readonly key: "savedSearches";
    readonly label: "toolDeletedSavedSearches";
    readonly totalKey: "deletedSavedSearches";
}, {
    readonly key: "tags";
    readonly label: "toolDeletedTags";
    readonly totalKey: "deletedTags";
}];
export declare const DELETED_OTHER_TOTAL_KEY: "deletedOther";
export type ChangeSectionKey = (typeof CHANGE_SECTIONS)[number]['key'];
export type DeletionSectionKey = (typeof DELETION_SECTIONS)[number]['key'];
export type ChangeTotalKey = ChangeSectionKey | (typeof DELETION_SECTIONS)[number]['totalKey'] | typeof DELETED_OTHER_TOTAL_KEY;
export type ZoteroChangesInclude = 'items' | 'collections' | 'savedSearches' | 'fulltext' | 'deleted';
/**
 * The kinds a call covers when the model names none. `fulltext` is excluded:
 * its endpoint answers in the full-text index's own version counter, not the
 * library version this tool diffs on, so it cannot be part of the cursor story
 * and is only read when asked for by name. The tool layer imports this table
 * so the contract and the read agree by construction.
 */
export declare const DEFAULT_CHANGES_INCLUDES: readonly ZoteroChangesInclude[];
/** Canonical order for the coverage carried by a cursor. */
export declare const ALL_CHANGES_INCLUDES: readonly ZoteroChangesInclude[];
//# sourceMappingURL=changes-contract.d.ts.map