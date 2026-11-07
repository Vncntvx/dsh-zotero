/**
 * The session source reducer: turns the session's zotero tool blocks into a
 * {@link SourceWorkspace}. The listed sources are the stable union (every
 * successful search's rows plus every directly referenced item), so viewing
 * one item never shrinks the others, and no search supersedes an earlier
 * one. Facts come only from settled, successful, structurally valid calls;
 * running, failed, and stopped calls count into operations, never into
 * achievements. Pure over the frozen blocks: the same slice builds the same
 * workspace.
 * @module dsh-zotero/sources/ledger
 */
import type { ToolBlockLike } from './block-types.js';
import type { SourceWorkspace } from './model.js';
interface BuildSourceWorkspaceOptions {
    /** The connected instance's Server ID from the status probe, when known. */
    readonly currentServerId?: string;
}
/**
 * Build the source workspace from the session's zotero call blocks.
 * @param blocks - zotero tool call blocks in transcript order.
 * @param options - the connected instance's Server ID, when known.
 * @returns the aggregated workspace.
 */
export declare function buildSourceWorkspace(blocks: readonly ToolBlockLike[], options?: BuildSourceWorkspaceOptions): SourceWorkspace;
export {};
//# sourceMappingURL=ledger.d.ts.map