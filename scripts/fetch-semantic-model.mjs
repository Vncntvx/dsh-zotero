/**
 * On-demand acquisition of the local embedding models.
 *
 * The plugin is request-driven: no network I/O at load time, and models are
 * downloaded on demand rather than bundled. This script fetches a pinned
 * revision of one quantized ONNX model from hf-mirror.com or huggingface.co,
 * verifies each file by byte count and SHA-256, and publishes the bundle through
 * a shared transactional installer: a cross-process writer lock, a private
 * random staging directory, a catalog whitelist, and a commit marker written
 * last. A failed or cancelled attempt does not replace the target or publish a
 * marker.
 *
 * The host and this CLI share `src/enrichment/model-installation.ts` and
 * `src/enrichment/model-bundle-inspector.ts`. Node's native TypeScript strip
 * loads those dependency-free modules directly, keeping the manifest and
 * publication rules identical across both installers.
 *
 * Usage:
 *   node scripts/fetch-semantic-model.mjs [--model=<key>|all] [--list]
 *                                        [--source=auto|huggingface|hf-mirror]
 *                                        [--proxy=<url>] [--no-proxy]
 *                                        [--timeout-ms=<n>] [--verify-only] [--dry-run]
 * Environment: HTTPS_PROXY / HTTP_PROXY / NO_PROXY are honored by default.
 * @module scripts/fetch-semantic-model
 */

import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { EnvHttpProxyAgent, ProxyAgent, fetch as httpFetch } from 'undici'
import { dshHomePath, expandHomePath } from '@deepseek-ai/dsh-home-paths'
import {
  DEFAULT_SEMANTIC_MODEL,
  DEFAULT_SEMANTIC_MODEL_ROOT,
  SEMANTIC_MODEL_KEYS,
  SEMANTIC_MODELS,
  manifestOf,
  semanticModelBytes,
  semanticModelOf,
} from '../src/enrichment-model-catalog.ts'
import { installModelBundle } from '../src/enrichment/model-installation.ts'
import { createBundleInspector } from '../src/enrichment/model-bundle-inspector.ts'

export const defaultModelRoot = dshHomePath('models')
// Installers address a bundle by its physical key (the directory the runtime
// and the loader resolve), not the config-facing tier key.
const modelDir = (key, root = defaultModelRoot) => join(root, key)

export const SOURCES = Object.freeze({
  'hf-mirror': {
    label: 'hf-mirror.com',
    url: (model, path) =>
      `https://hf-mirror.com/${model.modelId}/resolve/${model.revision}/${path}`,
  },
  huggingface: {
    label: 'Hugging Face',
    url: (model, path) =>
      `https://huggingface.co/${model.modelId}/resolve/${model.revision}/${path}`,
  },
})
const DEFAULT_ORDER = ['hf-mirror', 'huggingface']

/** One stream stall aborts the attempt: mirrors hang silently. */
const STALL_TIMEOUT_MS = 60_000

/** Parse and validate the command line; exported so its rules are testable. */
export function optionsOf(argv) {
  const value = (name) => argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
  const source = value('source') ?? 'auto'
  if (source !== 'auto' && !(source in SOURCES)) {
    throw new Error(
      `unknown --source=${source}; expected auto or ${Object.keys(SOURCES).join(', ')}`,
    )
  }
  const requested = value('model') ?? DEFAULT_SEMANTIC_MODEL
  const keys = requested === 'all' ? [...SEMANTIC_MODEL_KEYS] : [semanticModelOf(requested).key]
  const dirValue = value('dir') ?? value('model-dir')
  const dir = dirValue ? expandHomePath(dirValue) : defaultModelRoot
  const timeoutRaw = value('timeout-ms')
  const timeoutMs = timeoutRaw === undefined ? 300_000 : Number(timeoutRaw)
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`invalid --timeout-ms=${timeoutRaw}`)
  }
  return {
    keys,
    order: source === 'auto' ? DEFAULT_ORDER : [source],
    dir,
    proxy: value('proxy'),
    noProxy: argv.includes('--no-proxy'),
    timeoutMs,
    verifyOnly: argv.includes('--verify-only'),
    dryRun: argv.includes('--dry-run'),
    list: argv.includes('--list'),
  }
}

function dispatcherOf(options) {
  if (options.noProxy) return undefined
  if (options.proxy) return new ProxyAgent(options.proxy)
  return new EnvHttpProxyAgent()
}

function listModels() {
  for (const model of SEMANTIC_MODELS) {
    const tier = model.key === DEFAULT_SEMANTIC_MODEL ? 'default' : 'opt-in'
    process.stdout.write(
      `${model.key.padEnd(18)} ${String(model.dimension).padStart(4)}d ` +
        `${String(Math.round(semanticModelBytes(model) / 1024 / 1024)).padStart(4)} MiB ` +
        `${model.license.padEnd(11)} ${tier.padEnd(7)} ${model.modelId}\n`,
    )
  }
}

/**
 * Download one pinned file into the private staging directory. The destination
 * is created exclusively, and a cancelled caller never reaches another mirror.
 */
async function transfer(model, file, options, dispatcher, stagingDir, signal) {
  const dest = join(stagingDir, file.path)
  await mkdir(dirname(dest), { recursive: true })
  const failures = []
  for (const name of options.order) {
    signal.throwIfAborted()
    const source = SOURCES[name]
    const url = source.url(model, file.path)
    const tmp = join(
      dirname(dest),
      `.${name}-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`,
    )
    try {
      process.stderr.write(`  ${model.key}/${file.path} <- ${source.label}\n`)
      const response = await httpFetch(url, {
        dispatcher,
        redirect: 'follow',
        signal: AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)]),
      })
      signal.throwIfAborted()
      if (!response.ok || response.body === null) {
        await response.body?.cancel(signal.reason).catch(() => undefined)
        throw new Error(`HTTP ${response.status}`)
      }
      const contentLength = response.headers.get('content-length')
      if (contentLength !== null && Number(contentLength) !== file.bytes) {
        await response.body.cancel(signal.reason).catch(() => undefined)
        throw new Error(`content-length ${contentLength} disagrees with the pinned ${file.bytes}`)
      }
      const hash = createHash('sha256')
      let bytes = 0
      const stallController = new AbortController()
      const onAbort = () => stallController.abort(signal.reason)
      signal.addEventListener('abort', onAbort, { once: true })
      const stall = setTimeout(
        () => stallController.abort(new Error('stream stalled')),
        STALL_TIMEOUT_MS,
      )
      try {
        await pipeline(
          Readable.fromWeb(response.body, { signal: stallController.signal }),
          new Transform({
            transform(chunk, _encoding, callback) {
              bytes += chunk.length
              if (bytes > file.bytes) {
                callback(new Error(`body exceeded the pinned ${file.bytes} bytes`))
                return
              }
              hash.update(chunk)
              clearTimeout(stall)
              stall.refresh()
              callback(null, chunk)
            },
          }),
          createWriteStream(tmp, { flags: 'wx', mode: 0o600 }),
        )
      } finally {
        clearTimeout(stall)
        signal.removeEventListener('abort', onAbort)
      }
      signal.throwIfAborted()
      const sha256 = hash.digest('hex')
      if (bytes !== file.bytes || sha256 !== file.sha256) {
        throw new Error(`integrity mismatch (${bytes} bytes, ${sha256})`)
      }
      await rename(tmp, dest)
      return { source: name, bytes, sha256 }
    } catch (error) {
      await rm(tmp, { force: true })
      if (signal.aborted) throw signal.reason
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`${model.key}/${file.path}: every source failed\n    ${failures.join('\n    ')}`)
}

/** Install one model bundle through the shared transactional installer. */
async function install(model, options, dispatcher, signal) {
  const dir = modelDir(model.physicalKey, options.dir)
  process.stderr.write(`installing ${model.key} (${model.physicalKey}) into ${dir}\n`)
  // The parent must exist for the cross-process lock. Create only the root,
  // never the model directory or a draft, before the installer owns it.
  await mkdir(dirname(dir), { recursive: true })
  signal.throwIfAborted()
  const result = await installModelBundle({
    dir,
    expected: manifestOf(model),
    inspector: createBundleInspector(),
    force: false,
    signal,
    transfer: async (file, stagingDir, transferSignal) => {
      await transfer(model, file, options, dispatcher, stagingDir, transferSignal)
    },
  })
  process.stderr.write(`  ${model.key}: ${result.status}\n`)
  if (result.cleanupError !== undefined) {
    process.stderr.write(
      `  ${model.key}: staging cleanup warning: ${String(result.cleanupError)}\n`,
    )
  }
}

/** Verify every pinned file with the one shared bundle rule. */
async function verifyOne(model, options) {
  const dir = modelDir(model.physicalKey, options?.dir)
  const inspection = await createBundleInspector().inspect(
    { dir, expected: manifestOf(model) },
    { forceHash: true },
  )
  if (inspection.kind !== 'ready') {
    throw new Error(
      `${model.key}: bundle incomplete (${inspection.reason ?? inspection.manifest.reason ?? 'verification failed'}) ` +
        `— run \`npm run assets:semantic -- --model=${model.key}\``,
    )
  }
  return model.files.length
}

async function verifyInstalled(options) {
  const present = []
  for (const model of SEMANTIC_MODELS) {
    const inspection = await createBundleInspector().inspect(
      { dir: modelDir(model.physicalKey, options?.dir), expected: manifestOf(model) },
      { forceHash: true },
    )
    if (inspection.manifest.kind !== 'missing') present.push(model)
  }
  let files = 0
  for (const model of present) files += await verifyOne(model, options)
  return { models: present.map((model) => model.key), files }
}

async function main() {
  const argv = process.argv.slice(2)
  // `--help` must answer and exit; falling through would start a real install.
  if (argv.includes('--help')) {
    process.stdout.write(
      'Usage: node scripts/fetch-semantic-model.mjs [--model=<key>|all] [--dir=<root>] [--list] [--dry-run] [--verify-only] [--source=auto|hf-mirror|huggingface] [--proxy=<url>] [--no-proxy] [--timeout-ms=<n>]\n',
    )
    return
  }
  const options = optionsOf(argv)
  if (options.list) {
    listModels()
    return
  }
  if (options.verifyOnly) {
    const result = await verifyInstalled(options)
    process.stdout.write(
      `semantic models ok: ${result.models.join(', ')} (${result.files} files verified)\n`,
    )
    return
  }

  const models = options.keys.map((key) => semanticModelOf(key))
  if (options.dryRun) {
    process.stdout.write(
      `${JSON.stringify(
        {
          models: models.map((model) => ({
            key: model.key,
            modelId: model.modelId,
            revision: model.revision,
            files: model.files.map((file) => `${file.path} (${file.bytes} bytes)`),
          })),
          sources: options.order,
          proxy: options.noProxy ? '(direct)' : (options.proxy ?? '(from environment)'),
        },
        null,
        2,
      )}\n`,
    )
    return
  }

  const dispatcher = dispatcherOf(options)
  const controller = new AbortController()
  const onSignal = () => controller.abort(new Error('installation cancelled by signal'))
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  try {
    for (const model of models) await install(model, options, dispatcher, controller.signal)
    const result = await verifyInstalled(options)
    process.stdout.write(
      `semantic models ready: ${result.models.join(', ')} (${result.files} files verified)\n`,
    )
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    // A failed or cancelled run still releases its proxy dispatcher.
    if (typeof dispatcher?.close === 'function') await dispatcher.close()
  }
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]

if (isMain) {
  main().catch((error) => {
    process.stderr.write(
      `fetch-semantic-model: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  })
}
