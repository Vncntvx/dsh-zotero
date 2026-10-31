/**
 * The `zoteroStatus` session projection key and its map merge.
 *
 * Dependency-free on purpose: the host registers the projection under this key
 * and the browser reads it back through `useProjection`, so both halves have to
 * see the same `SessionProjectionMap` entry. This module carries only the key
 * and the type merge (no host imports), and `scripts/client-graph-authority.mjs`
 * admits it into the browser graph so the card's `useProjection('zoteroStatus')`
 * type-checks without importing host code.
 * @module dsh-zotero/projection-keys
 */
/** The projection key the `/zotero` card reads its snapshot under. */
export const ZOTERO_STATUS_PROJECTION_KEY = 'zoteroStatus';
//# sourceMappingURL=projection-keys.js.map