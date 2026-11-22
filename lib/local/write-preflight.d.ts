/** Deterministic, read-only refusals precede approval; execution rechecks current state. */
import type { ZoteroWritePreflight } from '../types.js';
import type { WriteDomainDeps } from './write-deps.js';
export declare function preflightWrite(deps: WriteDomainDeps, input: ZoteroWritePreflight, signal?: AbortSignal): Promise<void>;
//# sourceMappingURL=write-preflight.d.ts.map