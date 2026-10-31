/**
 * The collaborators and per-read item state every write operation shares.
 * Kept out of `write-domain.ts` so the focused write modules (notes,
 * collections, item lists, batch, library maintenance, saved searches) and
 * the commit-proof module can name the contract without importing the
 * item-write operation home; `write-domain.ts` remains the home of the
 * versioned item write itself.
 * @module dsh-zotero/local/write-deps
 */
export {};
//# sourceMappingURL=write-deps.js.map