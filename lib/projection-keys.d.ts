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
import type { ZoteroStatusView } from './contract.js';
/** The projection key the `/zotero` card reads its snapshot under. */
export declare const ZOTERO_STATUS_PROJECTION_KEY = "zoteroStatus";
declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionMap {
        /**
         * The most recent `/zotero` connectivity snapshot in this session, or null
         * when the command has not run yet.
         */
        zoteroStatus: ZoteroStatusView | null;
    }
    interface SessionProjectionStateMap {
        /** Same shape as the wire value: the fold has no host-only fields. */
        zoteroStatus: ZoteroStatusView | null;
    }
}
//# sourceMappingURL=projection-keys.d.ts.map