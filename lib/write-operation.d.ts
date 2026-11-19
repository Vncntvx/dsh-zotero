import { ConcurrencyGate } from './concurrency.js';
/** Starts after plan approval; includes queueing, authorization and graph verification. */
export declare const WRITE_OPERATION_DEADLINE_MS: number;
export declare function runWriteOperation<T>(gate: ConcurrencyGate, signal: AbortSignal, operation: (signal: AbortSignal) => Promise<T>): Promise<T>;
//# sourceMappingURL=write-operation.d.ts.map