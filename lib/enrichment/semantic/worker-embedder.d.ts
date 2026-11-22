/** Hard model-open and inference deadlines terminate the entire owned WASM runtime. */
import { Worker } from 'node:worker_threads';
import type { SemanticModelEntry } from '../../enrichment-model-catalog.js';
import type { Embedder } from './session.js';
export declare const SEMANTIC_OPEN_DEADLINE_MS = 180000;
export declare const SEMANTIC_RUN_DEADLINE_MS = 120000;
export type SemanticWorkerFactory = (spec: SemanticModelEntry, dir: string) => Worker;
export declare function openWorkerEmbedder(spec: SemanticModelEntry, dir: string, factory?: SemanticWorkerFactory, signal?: AbortSignal): Promise<Embedder>;
//# sourceMappingURL=worker-embedder.d.ts.map