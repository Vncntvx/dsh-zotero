import { ZoteroError } from '../errors.js';
import type { WriteDomainDeps } from './write-deps.js';
export interface KeyedItemUpdate {
    readonly key: string;
    readonly version: number;
    readonly fields: Readonly<Record<string, unknown>>;
}
export type KeyedItemVerdict = {
    readonly kind: 'applied';
    readonly key: string;
    readonly version: number;
    readonly unchanged: boolean;
} | {
    readonly kind: 'failed';
    readonly error: ZoteroError;
} | {
    readonly kind: 'unverified';
};
export declare function writeKeyedItems(deps: WriteDomainDeps, entries: readonly KeyedItemUpdate[], serverId: string, signal?: AbortSignal): Promise<{
    libraryVersion: number;
    verdicts: KeyedItemVerdict[];
}>;
export declare function throwKeyedVerdict(verdict: KeyedItemVerdict): asserts verdict is Extract<KeyedItemVerdict, {
    kind: 'applied';
}>;
//# sourceMappingURL=write-keyed-batch.d.ts.map