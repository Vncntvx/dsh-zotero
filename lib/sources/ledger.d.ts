/**
 * The session source reducer: turns the session's zotero tool blocks into a
 * {@link SourceWorkspace}. The listed sources are the stable union (every
 * successful search's rows plus every directly referenced item), so viewing
 * one item never shrinks the others, and no search supersedes an earlier
 * one. Facts come only from settled, successful, structurally valid calls;
 * running, failed, and stopped calls count into operations, never into
 * achievements.
 *
 * The fold is incremental. `SourceWorkspaceIndex.apply` folds one block into a
 * mutable accumulator, and `workspace` freezes only the items whose draft
 * changed since the last freeze, reusing every other frozen item. The host
 * projection reads its view once per committed event on a session of any
 * length, so a per-view cost proportional to the whole log would make the
 * trail quadratic in the event count. `buildSourceWorkspace` keeps the
 * one-shot contract the browser fallback and the specs use: fold every block,
 * then freeze once. Both paths share the same fold and the same freeze, so the
 * incremental index cannot drift from the pure builder.
 * @module dsh-zotero/sources/ledger
 */
import type { ToolBlockLike } from './block-types.js';
import type { SourceWorkspace } from './model.js';
/** How one workspace read shapes its lists. */
export interface BuildSourceWorkspaceOptions {
    /** The connected instance's Server ID from the status probe, when known. */
    readonly currentServerId?: string;
    /** Keep the existing bounded view; internal session paging requests the full fold. */
    readonly windowed?: boolean;
}
/**
 * The incremental workspace fold: one mutable accumulator plus one frozen view
 * per Server ID, so a read costs the blocks folded since the last read rather
 * than the whole session.
 *
 * The index owns no lifecycle of its own; whoever creates it owns it. The host
 * projection creates one per session state chain (see
 * `createSourceLedgerProjection`) and the one-shot builder creates one per
 * call.
 */
export declare class SourceWorkspaceIndex {
    private readonly drafts;
    private readonly indexByKey;
    private readonly artifacts;
    private readonly artifactOperations;
    private readonly artifactRefs;
    private readonly viewCaches;
    private readonly filterTotals;
    private openSearch;
    private passages;
    private omitted;
    private folded;
    /**
     * The drafts whose frozen view must be rebuilt, in mutation order. Each view
     * cache keeps a cursor into this log, so a read costs the changes since its
     * last read rather than a scan of every source.
     */
    private readonly changeLog;
    /**
     * A counter for session-wide scalar aggregates that have no draft to bump
     * (`artifactOperations`, `omitted`). A cache whose views were built at an
     * older revision rebuilds even when no draft version changed.
     */
    private scalarRevision;
    constructor(startSeq?: number);
    /** How many blocks this index folded; the transcript index of the next one. */
    get applied(): number;
    /**
     * Fold one block. A running block only creates its item and counts a running
     * operation; every outcome fact needs a settled, successful result.
     * @param block - the next block in transcript order.
     */
    apply(block: ToolBlockLike): void;
    /**
     * The workspace at this point of the fold, with an optional tail of pending
     * blocks folded on top without mutating the index.
     *
     * A read that changes nothing returns the previous workspace object, so the
     * host projection's `Object.is` comparison suppresses a redundant publish.
     * @param pending - the calls still in flight, in transcript order, after every folded block.
     * @param options - the connected Server ID and the list window.
     * @returns the aggregated workspace.
     */
    workspace(pending?: readonly ToolBlockLike[], options?: BuildSourceWorkspaceOptions): SourceWorkspace;
    /**
     * The view cache for one connected Server ID. The wire view (`undefined`)
     * plus the one instance the paging endpoint currently reads are the whole
     * live set: a new ID evicts the previous page view instead of retaining a
     * full frozen source array per client-supplied string.
     */
    private cacheFor;
    /**
     * Freeze every draft this cache has not yet frozen at its current version.
     * The index records each mutation in `changeLog`, and a cache keeps a cursor
     * into it, so a read costs the changes since its last read plus the items it
     * actually has to rebuild, not a scan of every source.
     */
    private refreeze;
    /** Move the shared filter aggregates by one draft's membership change. */
    private retally;
    /**
     * Fold the pending tail through the same reducer, into a throwaway index
     * seeded at this fold's position. A pending block carries no result, so it
     * can only create an item and count a running operation; folding it here
     * rather than into the shared accumulator keeps every already-published view
     * untouched. The spec "pending tail equals the one-shot build" pins that
     * equivalence for every block kind.
     */
    private overlayOf;
    /**
     * Assemble one view: the cached items (bounded to `limit`, or all) plus the
     * pending tail. The overlay merge runs over the whole overlay either way, so
     * the aggregates stay exact over every source even when the list is windowed;
     * only the array writes are limited.
     */
    private assemble;
    /** The complete view: every source and every row. Internal paging reads this. */
    private freezeFull;
    /**
     * The wire view: the source union and each row list keep their transcript
     * head. The array itself is cut before it is built, so a long session's
     * per-event read does not walk the whole trail.
     */
    private freezeWindowed;
    private workspaceOf;
    /** The draft of one ref, created on first sight; marks it for refreeze. */
    private draftOf;
    /** Count one attributed call's state on the item's operations. */
    private countOperation;
    /** Mark one draft changed and record its index for the view caches. */
    private touchDraft;
    /** Mark a draft reached through an episode's member set. */
    private touchMember;
    /** A session-wide scalar aggregate changed with no draft to invalidate. */
    private bumpScalar;
    private pushEvidence;
    /** Fold one block at its transcript position. */
    private fold;
}
/**
 * The workspace's wire window is built by the index directly; the item-level
 * cut lives in `./window` and is shared with the paging endpoint.
 */
/**
 * Build the source workspace in one pass over the session's zotero call
 * blocks. The browser fallback and the specs use this; the host projection
 * keeps a {@link SourceWorkspaceIndex} instead so a long session does not
 * refold its whole log on every event.
 * @param blocks - zotero tool call blocks in transcript order.
 * @param options - the connected instance's Server ID, when known.
 * @returns the aggregated workspace.
 */
export declare function buildSourceWorkspace(blocks: readonly ToolBlockLike[], options?: BuildSourceWorkspaceOptions): SourceWorkspace;
//# sourceMappingURL=ledger.d.ts.map