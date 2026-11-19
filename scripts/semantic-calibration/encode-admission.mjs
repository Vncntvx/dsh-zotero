/** Manual only: encode frozen inputs using the installed, verified production worker. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SEMANTIC_MODELS } from '../../src/enrichment-model-catalog.ts'
import { openWorkerEmbedder } from '../../lib/enrichment/semantic/worker-embedder.js'
import { admissionInputsForModel } from './admission-data.mjs'
import { cli, invariant, isMain, options, readJson } from './dataset.mjs'
import { modelIdentity } from './features.mjs'
import { assetsRoot, pinnedVersion, PROVENANCE_FILE } from '../vendor-onnxruntime.mjs'

async function main() {
  const args = options(process.argv.slice(2), ['--request', '--model', '--dir', '--out', '--help'])
  if (args['--help']) {
    process.stdout.write(
      'Manual model execution: node scripts/semantic-calibration/encode-admission.mjs --request INPUT.json --model KEY --dir VERIFIED_MODEL_ROOT --out VECTORS.json\nBuild first. The output is created exclusively; no file is overwritten.\n',
    )
    return
  }
  invariant(
    args['--request'] && args['--model'] && args['--dir'] && args['--out'],
    'Specify --request, --model, --dir and --out',
  )
  const model = SEMANTIC_MODELS.find((model) => model.key === args['--model'])
  invariant(model, 'Unknown model tier')
  const request = /** @type {import('./admission-data.mjs').AdmissionInputs} */ (
    await readJson(/** @type {string} */ (args['--request']))
  )
  const input = admissionInputsForModel(request, model)
  const controller = new AbortController()
  const abort = () => controller.abort(new Error('Manual model measurement cancelled'))
  process.on('SIGINT', abort)
  process.on('SIGTERM', abort)
  const timer = setTimeout(
    () => controller.abort(new Error('Manual model measurement exceeded 30 minutes')),
    30 * 60_000,
  )
  timer.unref()
  let embedder
  const started = performance.now()
  try {
    embedder = await openWorkerEmbedder(
      model,
      join(/** @type {string} */ (args['--dir']), model.physicalKey),
      undefined,
      controller.signal,
    )
    const vectors = new Map()
    for (const side of /** @type {readonly ['query', 'document']} */ (['query', 'document'])) {
      const entries = input.entries.filter((entry) => entry.side === side)
      for (let offset = 0; offset < entries.length; offset += 8) {
        controller.signal.throwIfAborted()
        const batch = entries.slice(offset, offset + 8)
        const result = await embedder.embed(
          batch.map((entry) => entry.text),
          side,
          controller.signal,
        )
        invariant(result.length === batch.length, 'Encoder changed the batch count')
        for (const [index, vector] of result.entries()) vectors.set(batch[index].key, [...vector])
        process.stderr.write(
          `${model.key}: encoded ${side} ${Math.min(offset + batch.length, entries.length)}/${entries.length}\n`,
        )
      }
    }
    const runtime = JSON.parse(
      await readFile(join(assetsRoot(), pinnedVersion(), PROVENANCE_FILE), 'utf8'),
    )
    const output = {
      schemaVersion: 1,
      protocol: request.protocol,
      synthetic: false,
      generatedBy: 'dsh-zotero/encode-admission production semantic Worker',
      generatedAt: new Date().toISOString(),
      model: modelIdentity(model),
      datasetDigest: request.datasetDigest,
      inputDigest: input.inputDigest,
      runtime: {
        node: process.versions.node,
        platform: process.platform,
        arch: process.arch,
        vendored: runtime,
      },
      durationMs: performance.now() - started,
      resourceUsage: process.resourceUsage(),
      entries: input.entries.map(({ key }) => ({ key, vector: vectors.get(key) })),
    }
    await writeFile(/** @type {string} */ (args['--out']), `${JSON.stringify(output)}\n`, {
      flag: 'wx',
      mode: 0o600,
    })
    process.stderr.write(`${model.key}: saved ${output.entries.length} actual model vectors\n`)
  } finally {
    clearTimeout(timer)
    process.off('SIGINT', abort)
    process.off('SIGTERM', abort)
    await embedder?.dispose()
  }
}
if (isMain(import.meta.url)) cli(main)
