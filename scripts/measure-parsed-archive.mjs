/** Compare Host event-loop delay for the same valid 128 MiB figure archive. */
import { performance } from 'node:perf_hooks'
import { writeFile } from 'node:fs/promises'
import { zipSync } from 'fflate'
import { ArchiveProcessor } from '../lib/enrichment/archive-worker.js'
import { extractParsedFiles } from '../lib/enrichment/zip.js'

const figureCount = 16
const figureBytes = 8 * 1024 * 1024
const markdown =
  '# Archive measurement\n\n' +
  Array.from({ length: figureCount }, (_, i) => `![Figure ${i}](images/figure${i}.png)`).join(
    '\n\n',
  )
const entries = { 'full.md': new TextEncoder().encode(markdown) }
for (let i = 0; i < figureCount; i++) {
  const bytes = new Uint8Array(figureBytes)
  bytes.fill(i)
  entries[`images/figure${i}.png`] = bytes
}
const archive = zipSync(entries)
const processor = new ArchiveProcessor()
const signal = new AbortController().signal

async function measure(mode) {
  let previous = performance.now()
  let maxDelayMs = 0
  const heartbeat = setInterval(() => {
    const now = performance.now()
    maxDelayMs = Math.max(maxDelayMs, now - previous - 1)
    previous = now
  }, 1)
  const started = performance.now()
  try {
    const result =
      mode === 'worker'
        ? await processor.run(signal, () => processor.extract(archive, signal))
        : extractParsedFiles(archive)
    const elapsedMs = performance.now() - started
    // Let the timer delayed by extraction run before ending the observation.
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (
      result.markdown !== markdown ||
      result.images.length !== figureCount ||
      result.images.reduce((sum, image) => sum + image.data.byteLength, 0) !==
        figureCount * figureBytes
    )
      throw new Error('Archive measurement lost document data')
    return { elapsedMs, maxDelayMs }
  } finally {
    clearInterval(heartbeat)
  }
}

// Discard the first import/JIT and Worker startup observation for each arm.
await measure('synchronous')
await measure('worker')
const samples = { synchronous: [], worker: [] }
for (let i = 0; i < 3; i++) {
  samples.synchronous.push(await measure('synchronous'))
  samples.worker.push(await measure('worker'))
}
const median = (rows, field) => rows.map((row) => row[field]).sort((a, b) => a - b)[1]
const report = {
  kind: 'synthetic archive measurement; emitted production JS; no network',
  node: process.version,
  archiveBytes: archive.byteLength,
  figureBytes: figureCount * figureBytes,
  figureCount,
  samples,
  medianMaxDelayMs: {
    synchronous: median(samples.synchronous, 'maxDelayMs'),
    worker: median(samples.worker, 'maxDelayMs'),
  },
}
const output = process.argv[2] ?? '/tmp/dsh-zotero-archive-performance.json'
await writeFile(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ output, ...report }, null, 2))
