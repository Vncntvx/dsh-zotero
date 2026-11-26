/** Serialized inference and cancellation on the model worker's owned port. */
import type { MessagePort } from 'node:worker_threads';
import type { SemanticModelEntry } from '../../enrichment-model-catalog.js';
import type { Embedder } from './session.js';
export declare function serveModelWorker(port: MessagePort, target: {
    spec: SemanticModelEntry;
    dir: string;
}, open?: (spec: SemanticModelEntry, dir: string) => Promise<Embedder>): Promise<() => Promise<void>>;
//# sourceMappingURL=worker-runtime.d.ts.map