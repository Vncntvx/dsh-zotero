/** Shared pure wire descriptors for the `zotero_changes` projection. */
export const CHANGE_SECTIONS = [
    { key: 'items', label: 'toolChangesItems' },
    { key: 'childItems', label: 'toolChangesChildItems' },
    { key: 'trashedItems', label: 'toolChangesTrashedItems' },
    { key: 'collections', label: 'toolChangesCollections' },
    { key: 'savedSearches', label: 'toolChangesSavedSearches' },
    { key: 'fulltextAttachments', label: 'toolChangesFulltext' },
];
export const DELETION_SECTIONS = [
    { key: 'items', label: 'toolDeletedItems', totalKey: 'deletedItems' },
    { key: 'collections', label: 'toolDeletedCollections', totalKey: 'deletedCollections' },
    { key: 'savedSearches', label: 'toolDeletedSavedSearches', totalKey: 'deletedSavedSearches' },
    { key: 'tags', label: 'toolDeletedTags', totalKey: 'deletedTags' },
];
export const DELETED_OTHER_TOTAL_KEY = 'deletedOther';
//# sourceMappingURL=changes-contract.js.map