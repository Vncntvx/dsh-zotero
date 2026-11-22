/** One model and its WASM runtime belong entirely to this terminable worker. */
import { parentPort, workerData } from 'node:worker_threads';
import { serveModelWorker } from './worker-runtime.js';
if (parentPort === null)
    throw new Error('Semantic worker requires an owned parent port');
await serveModelWorker(parentPort, workerData);
//# sourceMappingURL=model-worker.js.map