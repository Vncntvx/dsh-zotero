/**
 * The literature-trail projection: a pure fold over committed session events
 * that serves the whole trail to the browser without the history window.
 *
 * `apply` records settled Zotero outcomes; `view` freezes the workspace the
 * event fold accumulates. The fold is incremental and its cache is owned by
 * this instance: `apply` extends one {@link SourceWorkspaceIndex} per session
 * state chain, and `view` costs the blocks folded since the last read instead
 * of the whole log. A module-level memo would outlive the registration, so the
 * factory hands back a `dispose` and the service calls it on unload.
 *
 * `evidenceMatch` is left `unknown` here because the connected Server ID is a
 * client probe fact; the browser materializes it with {@link withEvidenceMatch}.
 * @module dsh-zotero/session-projection/source-ledger
 */
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
import { type SourceLedgerProjectionState } from '../sources/event-ledger.js';
import type { SourceWorkspace } from '../sources/model.js';
import { sourceWorkspaceSchema } from '../sources/workspace-schema.js';
/** The projection key the browser reads. */
export declare const SOURCE_LEDGER_KEY = "zoteroSources";
type SourceLedgerProjectionDefinition = Omit<ProjectionDefinition<typeof SOURCE_LEDGER_KEY, SourceLedgerProjectionState>, 'wire'> & {
    readonly wire: {
        readonly viewSchema: typeof sourceWorkspaceSchema;
        readonly view: (state: SourceLedgerProjectionState) => SourceWorkspace;
        readonly summary: false;
    };
};
/** The literature-trail projection together with the fold cache it owns. */
export interface SourceLedgerProjection {
    readonly definition: SourceLedgerProjectionDefinition;
    /**
     * The complete (unwindowed) workspace at one state. Repeated reads of the
     * same state and windowing shape return the same object, and the full and
     * wire views share one fold/index (not one object: their shapes differ).
     * @param state - the projection state to read.
     * @param currentServerId - the connected instance's Server ID, when known.
     * @returns the aggregated workspace over the full fold.
     */
    fullWorkspaceOf(state: SourceLedgerProjectionState, currentServerId?: string): SourceWorkspace;
    /**
     * Drop every cached fold and view. The definition stays usable: the next
     * read rebuilds once from the state it is handed.
     */
    dispose(): void;
}
/**
 * Create the literature-trail projection and the fold cache it owns.
 *
 * Fork-inherited events are folded like any other: a forked session's trail is
 * the history its user can see. The fold is lazy: a session whose trail is
 * never viewed stores its blocks but builds no index; the first view builds
 * one from the whole log, and every later apply extends it.
 * @returns the definition to register, plus the full-view reader and the disposer.
 */
export declare function createSourceLedgerProjection(): SourceLedgerProjection;
export {};
//# sourceMappingURL=source-ledger.d.ts.map