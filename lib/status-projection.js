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
import { ZOTERO_STATUS_PROJECTION_KEY } from './projection-keys.js';
import { zoteroStatusSchema } from './status-codec.js';
/** Narrow one arbitrary session event to the status event this unit owns. */
function statusEventOf(event) {
    if (event.type !== 'zotero/status')
        return undefined;
    return event.data.status;
}
/**
 * The fold state and the wire view share one schema: the folded value *is* the
 * wire value, so a single nullable parse serves both slots and the two can
 * never drift. No assertion is needed — zod 4's `ZodType` is covariant in its
 * output, and `zoteroStatusSchema` (strict + readonly) already infers exactly
 * `ZoteroStatusView`, so `.nullable()` is assignable as it stands.
 */
const STATUS_VIEW_SCHEMA = zoteroStatusSchema.nullable();
/**
 * The `zoteroStatus` unit. Register it on the plugin fiber through
 * `ctx.sessionProjections.register(...)`; the registration unwinds with the
 * plugin, so a composition without the seam simply has no projected value and
 * the card falls back to its live probe.
 */
export const ZOTERO_STATUS_PROJECTION = {
    key: ZOTERO_STATUS_PROJECTION_KEY,
    stateSchema: STATUS_VIEW_SCHEMA,
    /**
     * Start from null ("nothing probed yet in this session"). A fork inherits
     * its parent's events, so the fold reconstructs the parent's last probe below.
     * @returns null before any probe has run.
     */
    init: () => null,
    /**
     * Whole-value fold: a status event replaces the previous view, and any other
     * event returns the same reference so the registry's change gate stays
     * silent.
     * @param state - the view covering all prior events.
     * @param event - the next committed session event.
     * @returns the next view, or the same reference when the event is not ours.
     */
    apply: (state, event) => statusEventOf(event) ?? state,
    wire: {
        viewSchema: STATUS_VIEW_SCHEMA,
        /**
         * The folded view is already the wire value.
         * @param state - the current folded view.
         * @returns that same reference.
         */
        view: (state) => state,
    },
    stateVersion: 1,
};
//# sourceMappingURL=status-projection.js.map