/**
 * The `/zotero` status snapshot as a durable session fact.
 *
 * A command handler answers with text, so structured status travels through
 * {@link CommandResult.sourceEventSeq}: the handler appends the domain event
 * defined here, and the client reads the value through a session projection
 * (`docs/subsystems/commands.md`).
 *
 * The event carries the same {@link ZoteroStatusView} the Remote `status`
 * endpoint serves, produced by the same projection function, so the live probe
 * and the logged snapshot agree on every field.
 * @module dsh-zotero/session-events
 */
import type { ZoteroStatusView } from './contract.js';
import type { ZoteroStatus } from './types.js';
declare module '@deepseek-ai/dsh-session/types' {
    interface SessionEventMap {
        /**
         * One `/zotero` connectivity snapshot. The version tag lets a later
         * projection bump `stateVersion` without an older log being misread.
         */
        'zotero/status': {
            readonly version: 1;
            readonly status: ZoteroStatusView;
        };
    }
}
/**
 * Fold a host-internal status record into the wire view.
 *
 * Absent optional facts stay absent: the strict codec rejects undefined keys,
 * and a connected probe carries no diagnosis. The success sentinel is stripped
 * for the same reason the Remote endpoint strips it: it marks "nothing to
 * explain" internally and must never reach a renderer.
 * @param status - the provider's own status record.
 * @returns the view shared by the Remote endpoint and the logged event.
 */
export declare function toStatusView(status: ZoteroStatus): ZoteroStatusView;
//# sourceMappingURL=session-events.d.ts.map