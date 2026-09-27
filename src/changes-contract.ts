/** Shared pure wire descriptors for the `zotero_changes` projection. */

export const CHANGE_SECTIONS = [
  { key: 'items', label: 'toolChangesItems' },
  { key: 'childItems', label: 'toolChangesChildItems' },
  { key: 'trashedItems', label: 'toolChangesTrashedItems' },
  { key: 'collections', label: 'toolChangesCollections' },
  { key: 'savedSearches', label: 'toolChangesSavedSearches' },
  { key: 'fulltextAttachments', label: 'toolChangesFulltext' },
] as const

export const DELETION_SECTIONS = [
  { key: 'items', label: 'toolDeletedItems', totalKey: 'deletedItems' },
  { key: 'collections', label: 'toolDeletedCollections', totalKey: 'deletedCollections' },
  { key: 'savedSearches', label: 'toolDeletedSavedSearches', totalKey: 'deletedSavedSearches' },
  { key: 'tags', label: 'toolDeletedTags', totalKey: 'deletedTags' },
] as const

export const DELETED_OTHER_TOTAL_KEY = 'deletedOther' as const

export type ChangeSectionKey = (typeof CHANGE_SECTIONS)[number]['key']
export type DeletionSectionKey = (typeof DELETION_SECTIONS)[number]['key']
export type ChangeTotalKey =
  ChangeSectionKey | (typeof DELETION_SECTIONS)[number]['totalKey'] | typeof DELETED_OTHER_TOTAL_KEY
