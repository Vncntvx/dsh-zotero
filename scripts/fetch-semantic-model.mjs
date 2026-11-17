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
 * The host and CLI share the gated download client, transactional installer,
 * and bundle inspector. Every redirect is checked and direct DNS answers are
 * pinned before connecting; proxy routing follows the public harness policy.
 * The source-install build emits these modules into `lib/`, so both installers
 * use the same manifest and publication rules.
 *
 * Usage:
 *   node scripts/fetch-semantic-model.mjs [--model=<key>|all] [--list]
 *                                        [--source=auto|huggingface|hf-mirror]
 *                                        [--proxy=<url>] [--no-proxy]
 *                                        [--timeout-ms=<n>] [--verify-only] [--dry-run]
 * Environment: HTTPS_PROXY / HTTP_PROXY / NO_PROXY are honored by default.
 * @module scripts/fetch-semantic-model
 */

import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  downloadPinnedFile,
  MODEL_SOURCES,
  DEFAULT_SOURCE_ORDER,
} from '../lib/enrichment/model-download-client.js'
import { dshHomePath, expandHomePath } from '@deepseek-ai/dsh-home-paths'
import {
  DEFAULT_SEMANTIC_MODEL,
  SEMANTIC_DOWNLOAD_SOURCES,
  SEMANTIC_MODEL_KEYS,
  SEMANTIC_MODELS,
  manifestOf,
  semanticModelBytes,
  semanticModelOf,
} from '../lib/enrichment-model-catalog.js'
import { installModelBundle } from '../lib/enrichment/model-installation.js'
import { createBundleInspector } from '../lib/enrichment/model-bundle-inspector.js'

export const defaultModelRoot = dshHomePath('models')
// Installers address a bundle by its physical key (the directory the runtime
// and the loader resolve), not the config-facing tier key.
/** @param {string} key @param {string} [root] */
const modelDir = (key, root = defaultModelRoot) => join(root, key)

export const SOURCES = MODEL_SOURCES
const DEFAULT_ORDER = DEFAULT_SOURCE_ORDER

/**
 * Parse and validate the command line.
 * @param {readonly string[]} argv
 * @returns {import('./fetch-semantic-model.mjs').SemanticFetchOptions}
 */
export function optionsOf(argv) {
  /** @param {string} name */
  const value = (name) => argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
  const requestedSource = value('source') ?? 'auto'
  const source =
    requestedSource === 'auto'
      ? 'auto'
      : SEMANTIC_DOWNLOAD_SOURCES.find((entry) => entry === requestedSource)
  if (source === undefined) {
    throw new Error(
      `unknown --source=${requestedSource}; expected auto or ${Object.keys(SOURCES).join(', ')}`,
    )
  }
  const requested = value('model') ?? DEFAULT_SEMANTIC_MODEL
  const keys = requested === 'all' ? [...SEMANTIC_MODEL_KEYS] : [semanticModelOf(requested).key]
  const dirValue = value('dir') ?? value('model-dir')
  const dir = dirValue ? expandHomePath(dirValue) : defaultModelRoot
  const timeoutRaw = value('timeout-ms')
  const timeoutMs = timeoutRaw === undefined ? 300_000 : Number(timeoutRaw)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMER_DELAY_MS) {
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

/** @param {import('./fetch-semantic-model.mjs').SemanticFetchOptions} options */
async function installCliProxy(options) {
  const environment = options.noProxy ? {} : { ...process.env }
  if (!options.noProxy && options.proxy !== undefined) {
    for (const name of ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY'])
      environment[name] = options.proxy
  }
  return await installProxyFromEnvironment(
    { get: (name) => (environment[name] === undefined ? undefined : { value: environment[name] }) },
    (message) => process.stderr.write(`${message}\n`),
  )
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
 * Install one model bundle through the shared transactional installer.
 * @param {import('../lib/enrichment-model-catalog.js').SemanticModelEntry} model
 * @param {import('./fetch-semantic-model.mjs').SemanticFetchOptions} options
 * @param {AbortSignal} signal
 */
async function install(model, options, signal) {
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
      await downloadPinnedFile({
        model,
        file,
        dir: stagingDir,
        sources: options.order,
        signal: transferSignal,
        timeoutMs: options.timeoutMs,
      })
    },
  })
  process.stderr.write(`  ${model.key}: ${result.status}\n`)
  if (result.cleanupError !== undefined) {
    process.stderr.write(
      `  ${model.key}: staging cleanup warning: ${String(result.cleanupError)}\n`,
    )
  }
}

/**
 * Verify every pinned file with the one shared bundle rule.
 * @param {import('../lib/enrichment-model-catalog.js').SemanticModelEntry} model
 * @param {import('./fetch-semantic-model.mjs').SemanticFetchOptions} options
 */
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

/** @param {import('./fetch-semantic-model.mjs').SemanticFetchOptions} options */
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

  const releaseProxy = await installCliProxy(options)
  const controller = new AbortController()
  const onSignal = () => controller.abort(new Error('installation cancelled by signal'))
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  try {
    for (const model of models) await install(model, options, controller.signal)
    const result = await verifyInstalled(options)
    process.stdout.write(
      `semantic models ready: ${result.models.join(', ')} (${result.files} files verified)\n`,
    )
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    // A failed or cancelled run still releases its proxy dispatcher.
    await releaseProxy()
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
