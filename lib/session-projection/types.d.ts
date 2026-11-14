/**
 * Client-visible projection table entry for the literature trail.
 *
 * The browser imports this module for its type-only augmentation only; the
 * host unit and its wire schema live in `source-ledger.ts`.
 * @module dsh-zotero/session-projection/types
 */
import type { SourceWorkspace } from '../sources/model.js';
declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionMap {
        /** The session's literature trail; excluded from Session list summaries. */
        zoteroSources: SessionProjectionSummaryExcluded<SourceWorkspace>;
    }
}
export {};
//# sourceMappingURL=types.d.ts.map