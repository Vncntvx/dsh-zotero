/**
 * Canonical tool arguments for testing all 16 Zotero Chat tool cards.
 * @module tests/client/helpers/toolview-fixtures
 */

export const CANONICAL_ITEM_REF = 'zotero://user/0/item/V5WYL8WM?server=Cq1f76x70ESV'
export const CANONICAL_ATTACHMENT_REF = 'zotero://user/0/attachment/FXYCSYX8?server=Cq1f76x70ESV'

/** Canonical mock arguments for all 16 registered tool views. */
export function canonicalToolArgs(
  overrides: Record<string, Record<string, unknown>> = {},
): Record<string, Record<string, unknown>> {
  return {
    zotero_search: { query: 'Proactive resource request for disaster response' },
    zotero_retrieve: { ref: CANONICAL_ITEM_REF, query: 'disaster response' },
    zotero_export: { format: 'bibtex', refs: [CANONICAL_ITEM_REF] },
    zotero_get: { ref: CANONICAL_ITEM_REF },
    zotero_children: { ref: CANONICAL_ITEM_REF },
    zotero_attachment: { ref: CANONICAL_ATTACHMENT_REF },
    zotero_create_note: { markdown: '# Note' },
    zotero_update_item_tags: { ref: CANONICAL_ITEM_REF, add: ['ai'] },
    zotero_update_item_collections: { ref: CANONICAL_ITEM_REF, add: ['Reading'] },
    zotero_create_collection: { name: 'Reading' },
    zotero_delete_collection: { collection: 'Reading' },
    zotero_create_item: { itemType: 'book', title: 'A study' },
    zotero_update_item: { ref: CANONICAL_ITEM_REF, set: { title: 'A study' } },
    zotero_delete_library_tags: { tags: ['ai'] },
    zotero_browse: { kind: 'collections' },
    zotero_changes: { since: { version: 10, serverId: 'abc' } },
    ...overrides,
  }
}
