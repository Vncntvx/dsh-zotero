import type { ZoteroDeleteSavedSearchResult, ZoteroWriteCommittedUnverified } from '../types.js';
import type { WriteDomainDeps } from './write-deps.js';
interface RecordTarget {
    readonly kind: 'collection' | 'search';
    readonly key: string;
    readonly serverId: string;
}
type RecordCommit = {
    readonly status: 'acknowledged';
    readonly libraryVersion: number;
} | {
    readonly status: 'unverified';
    readonly value: ZoteroWriteCommittedUnverified;
};
export declare function patchRecordForWrite(deps: WriteDomainDeps, target: RecordTarget, version: number, patch: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<RecordCommit>;
export declare function deleteRecordForWrite(deps: WriteDomainDeps, target: RecordTarget, signal?: AbortSignal): Promise<ZoteroDeleteSavedSearchResult | ZoteroWriteCommittedUnverified>;
export {};
//# sourceMappingURL=write-record.d.ts.map