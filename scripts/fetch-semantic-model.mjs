/**
 * On-demand acquisition of the local embedding models.
 *
 * The plugin is request-driven: no network I/O may happen at load time, and
 * models are downloaded on demand by the user rather than bundled in the package.
 * This script fetches a pinned revision of one quantized ONNX model from one
 * of two equivalent sources (hf-mirror.com, huggingface.co),
 * verifies every file by byte count and SHA-256, writes atomically, and commits each
 * bundle by writing its `manifest.json` last.
 *
 * Sources are interchangeable because they serve the identical LFS objects:
 * the pinned digests in `semantic-model-catalog.mjs` are re-checked against the
 * bytes actually received, so a mirror serving a different revision, a
 * truncated range, or an HTML error page cannot pass.
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
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
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
} from './semantic-model-catalog.mjs'

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

async function hashFile(path) {
  const hash = createHash('sha256')
  let bytes = 0
  // Streamed, never buffered: the base model alone is 266 MB.
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length
    hash.update(chunk)
  }
  return { bytes, sha256: hash.digest('hex') }
}

async function fileExists(path) {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
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

/** Download one pinned file, trying each allowed source in order. */
async function acquire(model, file, options, dispatcher) {
  const dest = join(modelDir(model.physicalKey, options.dir), file.path)
  await mkdir(dirname(dest), { recursive: true })
  if (await fileExists(dest)) {
    const local = await hashFile(dest)
    if (local.bytes === file.bytes && local.sha256 === file.sha256) {
      return { source: 'already-present', ...local }
    }
    process.stderr.write(
      `  ${model.key}/${file.path}: local copy failed verification, refetching\n`,
    )
    await rm(dest)
  }

  const failures = []
  for (const name of options.order) {
    const source = SOURCES[name]
    const url = source.url(model, file.path)
    const tmp = `${dest}.${name}.tmp`
    try {
      process.stderr.write(`  ${model.key}/${file.path} <- ${source.label}\n`)
      const response = await httpFetch(url, {
        dispatcher,
        redirect: 'follow',
        signal: AbortSignal.timeout(options.timeoutMs),
      })
      if (!response.ok || response.body === null) throw new Error(`HTTP ${response.status}`)
      const contentLength = response.headers.get('content-length')
      if (contentLength !== null && Number(contentLength) !== file.bytes) {
        throw new Error(`content-length ${contentLength} disagrees with the pinned ${file.bytes}`)
      }
      const hash = createHash('sha256')
      let bytes = 0
      let nextMark = 10 * 1024 * 1024
      // One stream stall aborts the attempt: mirrors hang silently, and the
      // per-attempt controller also stops the shared dispatcher's socket.
      const stallController = new AbortController()
      const stall = setTimeout(() => stallController.abort(), STALL_TIMEOUT_MS)
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
              if (bytes >= nextMark) {
                process.stderr.write(`    ${(bytes / 1024 / 1024).toFixed(0)} MB\n`)
                nextMark += 10 * 1024 * 1024
              }
              clearTimeout(stall)
              stall.refresh()
              callback(null, chunk)
            },
          }),
          createWriteStream(tmp),
        )
      } finally {
        clearTimeout(stall)
      }
      const sha256 = hash.digest('hex')
      if (bytes !== file.bytes || sha256 !== file.sha256) {
        throw new Error(`integrity mismatch (${bytes} bytes, ${sha256})`)
      }
      await rename(tmp, dest)
      return { source: name, bytes, sha256 }
    } catch (error) {
      await rm(tmp, { force: true })
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`${model.key}/${file.path}: every source failed\n    ${failures.join('\n    ')}`)
}

/** Install one model bundle and write its commit marker last. */
async function install(model, options, dispatcher) {
  process.stderr.write(
    `installing ${model.key} (${model.physicalKey}) into ${modelDir(model.physicalKey, options.dir)}\n`,
  )
  for (const file of model.files) {
    const result = await acquire(model, file, options, dispatcher)
    process.stderr.write(`  ${model.key}/${file.path}: ${result.source}\n`)
  }
  await writeFile(
    join(modelDir(model.physicalKey, options.dir), 'manifest.json'),
    `${JSON.stringify(manifestOf(model), null, 2)}\n`,
  )
}

async function verifyOne(model, options) {
  const dir = modelDir(model.physicalKey, options?.dir)
  const manifestPath = join(dir, 'manifest.json')
  if (!(await fileExists(manifestPath))) {
    throw new Error(
      `${model.key}: bundle incomplete (${manifestPath} missing) — run \`npm run assets:semantic -- --model=${model.key}\``,
    )
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (manifest.key !== model.key || manifest.modelId !== model.modelId) {
    throw new Error(`${model.key}: manifest names ${manifest.key}/${manifest.modelId}`)
  }
  if (manifest.revision !== model.revision || manifest.dimension !== model.dimension) {
    throw new Error(`${model.key}: manifest pins a different revision or dimension`)
  }
  for (const file of model.files) {
    const path = join(dir, file.path)
    if (!(await fileExists(path))) throw new Error(`${model.key}: missing ${file.path}`)
    const actual = await hashFile(path)
    if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) {
      throw new Error(`${model.key}: corrupt ${file.path} (${JSON.stringify(actual)})`)
    }
    const entry = manifest.files?.[file.path]
    if (entry?.sha256 !== file.sha256 || entry?.bytes !== file.bytes) {
      throw new Error(`${model.key}: manifest disagrees about ${file.path}`)
    }
  }
  return model.files.length
}

async function verifyInstalled(options) {
  const present = []
  for (const model of SEMANTIC_MODELS) {
    if (await fileExists(join(modelDir(model.physicalKey, options?.dir), 'manifest.json')))
      present.push(model)
  }
  let files = 0
  for (const model of present) files += await verifyOne(model, options)
  return { models: present.map((model) => model.key), files }
}

async function main() {
  const options = optionsOf(process.argv.slice(2))
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
  for (const model of models) await install(model, options, dispatcher)
  const result = await verifyInstalled(options)
  if (typeof dispatcher?.close === 'function') await dispatcher.close()
  process.stdout.write(
    `semantic models ready: ${result.models.join(', ')} (${result.files} files verified)\n`,
  )
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
