/**
 * The `zoteroStatus` session projection: the durable half of the `/zotero`
 * command's answer.
 *
 * A `CommandResult` carries text only (with an optional `sourceEventSeq`). The
 * handler appends `zotero/status`
 * ({@link import('./session-events.js').ZOTERO_STATUS_PROJECTION_KEY}), and the
 * card reads it through `useProjection`
 * (`packages/session/session-projection/README.md`).
 *
 * The unit is a **last-value only** fold: a session keeps the most recent
 * probe, because the card renders one status and the log already holds the
 * history. Returning the same reference for events it does not own keeps the
 * registry's `Object.is` gate cheap.
 * @module dsh-zotero/status-projection
 */
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
import type { ZoteroStatusView } from './contract.js';
/**
 * The `zoteroStatus` unit. Register it on the plugin fiber through
 * `ctx.sessionProjections.register(...)`; the registration unwinds with the
 * plugin, so a composition without the seam simply has no projected value and
 * the card falls back to its live probe.
 */
export declare const ZOTERO_STATUS_PROJECTION: ProjectionDefinition<'zoteroStatus', ZoteroStatusView | null> & {
    readonly wire: NonNullable<ProjectionDefinition<'zoteroStatus', ZoteroStatusView | null>['wire']>;
};
//# sourceMappingURL=status-projection.d.ts.map