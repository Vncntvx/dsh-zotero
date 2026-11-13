/** Worker entry: CPU-heavy archive normalization never runs in the Host event loop. */
import { parentPort, workerData } from 'node:worker_threads'
import { extractParsedFiles } from './zip.js'

try {
  if (!(workerData instanceof Uint8Array)) throw new Error('Invalid archive worker input')
  const files = extractParsedFiles(workerData)
  parentPort!.postMessage({ ok: true, files }, [
    ...new Set(files.images.map((image) => image.data.buffer as ArrayBuffer)),
  ])
} catch (error) {
  parentPort!.postMessage({
    ok: false,
    message: error instanceof Error ? error.message : 'Archive normalization failed',
  })
}
