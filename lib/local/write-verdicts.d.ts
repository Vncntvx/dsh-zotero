/**
 * Shared proof rules for write results returned by Zotero's batch endpoints.
 * @module dsh-zotero/local/write-verdicts
 */
import type { WriteDomainDeps } from './write-deps.js';
import { type ZoteroBatchWrite } from '../write-http.js';
import type { ZoteroBatchCreateItemResult, ZoteroBatchCreateUnverified, ZoteroBatchOperationFailure, ZoteroWriteCommittedUnverified } from '../types.js';
export type CommittedUnverifiedKind = 'note' | 'item' | 'collection' | 'search';
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
}[], serverId: string, created: ZoteroBatchCreateItemResult[], unverified: ZoteroBatchCreateUnverified[], failed: ZoteroBatchOperationFailure[]): void;
//# sourceMappingURL=write-verdicts.d.ts.map