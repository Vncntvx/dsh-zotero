/**
 * Shared proof rules for write results returned by Zotero's batch endpoints.
 * @module dsh-zotero/local/write-verdicts
 */
import type { WriteDomainDeps } from './write-deps.js';
import { type ZoteroBatchWrite } from '../write-http.js';
import type { ZoteroBatchCreateItemResult, ZoteroBatchCreateUnverified, ZoteroBatchOperationUnverified, ZoteroBatchOperationFailure, ZoteroWriteCommittedUnverified } from '../types.js';
/**
 * The object vocabulary a committed-unverified receipt can name. A `tag`
 * settles a library-wide tag write, which names no object and carries no ref.
 */
export type CommittedUnverifiedKind = 'note' | 'item' | 'tag' | 'collection' | 'search';
export interface CommittedUnverifiedOptions {
    readonly kind: CommittedUnverifiedKind;
    readonly serverId: string;
    readonly batch?: ZoteroBatchWrite;
    readonly key?: string;
    readonly version?: number;
    readonly reason?: 'saved-state-unverified' | 'commit-unknown' | 'receipt-unknown';
    /** The graph write's root object, when the uncertain node is a child. */
    readonly parentRef?: string;
    /** Refs the same graph write acknowledged before this outcome. */
    readonly completedRefs?: readonly string[];
}
export declare function committedUnverified(options: CommittedUnverifiedOptions): ZoteroWriteCommittedUnverified;
/**
 * Settle a commit-unknown as a receipt-unknown verdict, or rethrow anything
 * else. Every versioned-PATCH catch block funnels through here, so the
 * reason and the non-commit-unknown rethrow stay spelled once.
 */
export declare function receiptOfCommitUnknown(error: unknown, options: CommittedUnverifiedOptions): ZoteroWriteCommittedUnverified;
/** The receipt-unknown shape for one batch operation slot. */
export declare function batchOperationUnverified(op: ZoteroBatchOperationUnverified['op'], index: number, ref: string, serverId: string): ZoteroBatchOperationUnverified;
export interface SettledEntry<P> {
    readonly key: string;
    readonly version: number;
    readonly data: Record<string, unknown>;
    readonly libraryVersion: number;
    readonly payload: P;
}
export type CreateSettlement<P> = {
    status: 'applied';
    entry: SettledEntry<P>;
} | {
    status: 'unverified';
    result: ZoteroWriteCommittedUnverified;
};
/**
 * Send one single-object create and settle what the answer proves.
 *
 * Both failure shapes are settled here so every create path reports them
 * alike: a commit whose outcome is unknown, and a batch that does not prove
 * what it was asked to write, each become a committed-unverified receipt —
 * never a retry. Only a proven entry reaches the caller, which then names
 * the object in its own vocabulary.
 */
export declare function settleCreate<P>(deps: WriteDomainDeps, request: {
    readonly path: string;
    readonly entry: Record<string, unknown>;
    readonly serverId: string;
    readonly apiKey: string;
    readonly signal: AbortSignal | undefined;
    readonly kind: CommittedUnverifiedKind;
}, proven: (data: Record<string, unknown>, key: string, version: number) => P | undefined): Promise<CreateSettlement<P>>;
export declare function batchCreateUnverified(index: number, reason: ZoteroBatchCreateUnverified['reason'], serverId: string): ZoteroBatchCreateUnverified;
export declare function settleBatchCreates(batch: ZoteroBatchWrite, creates: readonly {
    readonly itemType: string;
}[], serverId: string, created: ZoteroBatchCreateItemResult[], unverified: ZoteroBatchOperationUnverified[], failed: ZoteroBatchOperationFailure[]): void;
//# sourceMappingURL=write-verdicts.d.ts.map