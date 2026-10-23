/**
 * Canonical tool arguments for testing every registered Zotero Chat tool card.
 * @module tests/client/helpers/toolview-fixtures
 */

export const CANONICAL_ITEM_REF = 'zotero://user/0/item/V5WYL8WM?server=Cq1f76x70ESV'
export const CANONICAL_ATTACHMENT_REF = 'zotero://user/0/attachment/FXYCSYX8?server=Cq1f76x70ESV'

/** Canonical mock arguments for every registered tool view. */
export function canonicalToolArgs(
  overrides: Record<string, Record<string, unknown>> = {},
): Record<string, Record<string, unknown>> {
  return {
    zotero_batch_items: {
      create: [{ itemType: 'journalArticle', title: 'A study' }],
      update: [{ ref: CANONICAL_ITEM_REF, addTags: ['ai'] }],
      delete: [],
    },
    zotero_search: { query: 'Proactive resource request for disaster response' },
    zotero_retrieve: { ref: CANONICAL_ITEM_REF, query: 'disaster response' },
    zotero_export: { format: 'bibtex', refs: [CANONICAL_ITEM_REF] },
    zotero_get: { ref: CANONICAL_ITEM_REF },
    zotero_children: { ref: CANONICAL_ITEM_REF },
    zotero_attachment: { ref: CANONICAL_ATTACHMENT_REF },
    zotero_create_note: { markdown: '# Note' },
    zotero_update_note: { ref: CANONICAL_ITEM_REF, markdown: '# Updated' },
    zotero_update_item_tags: { ref: CANONICAL_ITEM_REF, add: ['ai'] },
    zotero_update_item_collections: { ref: CANONICAL_ITEM_REF, add: ['Reading'] },
    zotero_create_collection: { name: 'Reading' },
    zotero_update_collection: { collection: 'Reading', name: 'Reading 2' },
    zotero_delete_collection: { collection: 'Reading' },
    zotero_create_item: { itemType: 'book', title: 'A study' },
    zotero_update_item: { ref: CANONICAL_ITEM_REF, set: { title: 'A study' } },
    zotero_restore_items: { refs: [CANONICAL_ITEM_REF] },
    zotero_create_saved_search: { name: 'Recent', conditions: [] },
    zotero_update_saved_search: { search: 'zotero://user/0/search/SEARCH01', name: 'Recent 2' },
    zotero_delete_saved_search: { search: 'zotero://user/0/search/SEARCH01' },
    scholarly_save_to_zotero: { title: 'A study' },
    zotero_delete_library_tags: { tags: ['ai'] },
    zotero_browse: { kind: 'collections' },
    zotero_changes: { since: { version: 10, serverId: 'abc' } },
    ...overrides,
  }
}
