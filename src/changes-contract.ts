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

export type ZoteroChangesInclude =
  'items' | 'collections' | 'savedSearches' | 'fulltext' | 'deleted'

/**
 * The kinds a call covers when the model names none. `fulltext` is excluded:
 * its endpoint answers in the full-text index's own version counter, not the
 * library version this tool diffs on, so it cannot be part of the cursor story
 * and is only read when asked for by name. The tool layer imports this table
 * so the contract and the read agree by construction.
 */
export const DEFAULT_CHANGES_INCLUDES: readonly ZoteroChangesInclude[] = [
  'items',
  'collections',
  'savedSearches',
  'deleted',
]

/** Canonical order for the coverage carried by a cursor. */
export const ALL_CHANGES_INCLUDES: readonly ZoteroChangesInclude[] = [
  'items',
  'collections',
  'savedSearches',
  'fulltext',
  'deleted',
]
