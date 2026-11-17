/**
 * The packaged ONNX runtime seam for local semantic ranking.
 *
 * `onnxruntime-web` cannot be a dependency of this plugin: it drags
 * `protobufjs`, whose `postinstall` is a no-op, and pnpm 11 fails an install
 * while any dependency script has no decision — so depending on it would make
 * installing the plugin fail everywhere until the profile recorded a build
 * approval. The publish path instead vendors the three artifacts the Node entry
 * needs into `assets/onnxruntime/<version>/` (`scripts/vendor-onnxruntime.mjs`),
 * and this module loads them from the package by absolute URL with the wasm
 * loader pointed at the same directory. `onnxruntime-common`, the only bare
 * import left in the vendored entry, stays a normal dependency: it declares no
 * install script and has no dependencies of its own.
 *
 * A package missing those files is broken. The loader reports that with the
 * fail-closed semantic error rather than a bare resolution failure, and
 * `npm run verify:pack` refuses to publish such a tarball.
 * @module dsh-zotero/enrichment/semantic/runtime
 */

import { existsSync } from 'node:fs'
import { join, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE, ZoteroError } from '../../errors.js'

/** The upstream package the vendored build artifacts come from. */
export const SEMANTIC_RUNTIME_PACKAGE = 'onnxruntime-web'

/** The version the model catalog was verified against and the assets pin. */
export const SEMANTIC_RUNTIME_VERSION = '1.31.1'

/** Every file the vendored entry needs beside it. */
export const SEMANTIC_RUNTIME_FILES = Object.freeze([
  'ort.node.min.mjs',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
])

/** The module namespace the semantic session uses, defined by the installed shared ONNX contract. */
export type SemanticRuntime = typeof import('onnxruntime-common')

type RuntimeLoader = (url: string) => Promise<SemanticRuntime>

/**
 * Absolute directory of the packaged runtime. The relative walk is three levels
 * up from both `src/enrichment/semantic/` (tests) and `lib/enrichment/semantic/`
 * (the installed package), so one expression serves both trees.
 * @param version - the pinned runtime version.
 */
export function semanticRuntimeDir(version = SEMANTIC_RUNTIME_VERSION): string {
  return fileURLToPath(new URL(`../../../assets/onnxruntime/${version}/`, import.meta.url))
}

function defaultLoader(url: string): Promise<SemanticRuntime> {
  return import(url) as Promise<SemanticRuntime>
}

/**
 * Load the packaged runtime. Node caches the module after the first import, and
 * the env applied here is process-wide, so applying it again is idempotent.
 * @param dir - the packaged runtime directory; injectable for tests.
 * @param load - the module importer; injectable so a test can avoid the real one.
 */
export async function loadSemanticRuntime(
  dir: string = semanticRuntimeDir(),
  load: RuntimeLoader = defaultLoader,
): Promise<SemanticRuntime> {
  const missing = SEMANTIC_RUNTIME_FILES.filter((file) => !existsSync(join(dir, file)))
  if (missing.length > 0) {
    throw new ZoteroError(
      `The packaged ${SEMANTIC_RUNTIME_PACKAGE}@${SEMANTIC_RUNTIME_VERSION} runtime is incomplete ` +
        `(missing ${missing.join(', ')} in ${dir}); reinstall the plugin.`,
      ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE,
    )
  }
  const runtime = await load(pathToFileURL(join(dir, 'ort.node.min.mjs')).href)
  runtime.env.wasm.numThreads = 1
  runtime.env.wasm.simd = true
  runtime.env.logLevel = 'error'
  // The entry concatenates the wasm glue name onto this base, so it must end
  // with a separator; both files sit beside the entry.
  runtime.env.wasm.wasmPaths = dir.endsWith(sep) ? dir : `${dir}${sep}`
  return runtime
}
