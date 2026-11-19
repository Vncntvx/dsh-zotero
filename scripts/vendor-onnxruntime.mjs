/**
 * Materialize the semantic-ranking runtime from the pinned dev dependency into
 * package assets.
 *
 * `onnxruntime-web` cannot be a dependency: it drags `protobufjs`, whose
 * `postinstall` is a no-op that pnpm 11 refuses to leave undecided, so every
 * install of this plugin would fail until the profile recorded a build
 * decision. The plugin instead ships the three files it actually loads (the
 * Node entry, the wasm glue, and the wasm binary) plus a provenance record,
 * and loads them by absolute path with `env.wasm.wasmPaths` pointed at that
 * directory. `onnxruntime-common`, the only bare import left in the entry,
 * stays a normal dependency: it declares no install script and has no
 * dependencies of its own.
 *
 * The assets are generated (like `lib/`), so the publish path must run this
 * before packing; `--check` verifies an existing copy without writing:
 * `npm run verify:pack` fails when a packaged file is missing or drifted.
 *
 * Usage: node scripts/vendor-onnxruntime.mjs [--check]
 * @module scripts/vendor-onnxruntime
 */

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** One packaged runtime file and the upstream path it comes from.
 * @type {Readonly<Record<string, string>>}
 */
const RUNTIME_FILES = Object.freeze({
  'ort.node.min.mjs': 'dist/ort.node.min.mjs',
  'ort-wasm-simd-threaded.mjs': 'dist/ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm': 'dist/ort-wasm-simd-threaded.wasm',
})

/** The record a packaged copy carries so the release gate can prove its origin. */
export const PROVENANCE_FILE = 'provenance.json'

/** Where the vendored runtime lives inside the package. */
export function assetsRoot() {
  return join(root, 'assets', 'onnxruntime')
}

/**
 * The version both the dev dependency and the packaged assets are pinned to.
 * A range here would let a dev install vendor a version the loader never names.
 */
export function pinnedVersion() {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const version = manifest.devDependencies?.['onnxruntime-web']
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(
      `package.json must pin onnxruntime-web to an exact version; found ${String(version)}`,
    )
  }
  return version
}

/** Every packaged runtime file name, in stable order. */
export function runtimeFileNames() {
  return Object.keys(RUNTIME_FILES).sort()
}

/**
 * The packaged-runtime files a tarball must carry, relative to the package
 * root: the loader names these exactly, so `verify:pack` asserts them by path
 * rather than trusting the `files` directory entry.
 * @param version - the pinned runtime version.
 */
export function packedRuntimePaths(version = pinnedVersion()) {
  return [
    ...runtimeFileNames().map((name) => `assets/onnxruntime/${version}/${name}`),
    `assets/onnxruntime/${version}/${PROVENANCE_FILE}`,
    'assets/onnxruntime/LICENSE',
  ]
}

/**
 * Independently reviewed release identity; never generated from the installation tree.
 * @param {string} version - the pinned runtime version.
 */
function releaseAnchor(version) {
  const anchor = JSON.parse(
    readFileSync(join(root, 'scripts/shared/onnxruntime-release.json'), 'utf8'),
  )
  if (anchor.version !== version || anchor.package !== 'onnxruntime-web')
    throw new Error(`No reviewed upstream runtime release identity for ${version}`)
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
  if (lock.packages?.['node_modules/onnxruntime-web']?.integrity !== anchor.integrity)
    throw new Error('onnxruntime-web lock integrity differs from the reviewed upstream release')
  return anchor
}

/**
 * @param {string} path - asset path to check.
 * @param {{ bytes: number, sha256: string } | undefined} expected - the reviewed upstream record.
 * @param {string} label - human-readable asset label for problem messages.
 * @returns {string[]} problems; empty when the asset matches.
 */
function releaseAssetProblems(path, expected, label) {
  if (!existsSync(path)) return [`${label} is missing`]
  if (
    expected === undefined ||
    statSync(path).size !== expected.bytes ||
    digestOf(path) !== expected.sha256
  )
    return [`${label} differs from the independently reviewed upstream release`]
  return []
}

/** @param {string} path @returns {string} the asset's sha256 hex digest. */
function digestOf(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * The provenance document for one copied tree, byte-stable across runs.
 * @param {string} version - the pinned runtime version.
 * @param {Record<string, { bytes: number, sha256: string }>} files - copied file records.
 */
function provenanceOf(version, files) {
  return `${JSON.stringify(
    {
      package: 'onnxruntime-web',
      version,
      source: releaseAnchor(version).tarball,
      integrity: releaseAnchor(version).integrity,
      license: 'MIT; see assets/onnxruntime/LICENSE',
      files,
    },
    undefined,
    2,
  )}\n`
}

/**
 * Copy the pinned runtime into `assets/onnxruntime/<version>/` and drop any
 * other version directory, so a bump cannot leave two runtimes in the tarball.
 */
export async function vendorRuntime() {
  const version = pinnedVersion()
  const anchor = releaseAnchor(version)
  const source = join(root, 'node_modules', 'onnxruntime-web')
  const target = join(assetsRoot(), version)
  if (!existsSync(join(source, 'package.json'))) {
    throw new Error(
      'node_modules/onnxruntime-web is missing; run npm install before vendoring the runtime',
    )
  }
  const installed = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version
  if (installed !== version) {
    throw new Error(
      `node_modules carries onnxruntime-web@${installed} but package.json pins ${version}; reinstall dependencies`,
    )
  }
  await mkdir(target, { recursive: true })
  /** @type {Record<string, { bytes: number, sha256: string }>} */
  const files = {}
  for (const [name, upstream] of Object.entries(RUNTIME_FILES).sort()) {
    const from = join(source, upstream)
    const to = join(target, name)
    if (!existsSync(from)) throw new Error(`onnxruntime-web@${version} ships no ${upstream}`)
    const invalid = releaseAssetProblems(
      from,
      anchor.files[upstream],
      `installed onnxruntime-web ${upstream}`,
    )
    if (invalid.length > 0) throw new Error(invalid.join('; '))
    const bytes = statSync(from).size
    // Preserve identical files so rebuilds keep their timestamps.
    if (!existsSync(to) || digestOf(to) !== digestOf(from)) await copyFile(from, to)
    files[name] = { bytes, sha256: digestOf(to) }
  }
  const license = join(root, 'scripts/shared/onnxruntime-LICENSE')
  const invalidLicense = releaseAssetProblems(license, anchor.license, 'reviewed upstream LICENSE')
  if (invalidLicense.length > 0) throw new Error(invalidLicense.join('; '))
  await copyFile(license, join(assetsRoot(), 'LICENSE'))
  await writeFile(join(target, PROVENANCE_FILE), provenanceOf(version, files))
  for (const entry of readdirSync(assetsRoot(), { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === version) continue
    rmSync(join(assetsRoot(), entry.name), { recursive: true, force: true })
  }
  return { version, dir: target, files }
}

/**
 * Prove a packaged copy matches its provenance and the reviewed upstream release, and
 * that the license ships beside it. Read-only; used by `npm run verify:pack`.
 * @returns the pinned version the package carries.
 */
export function checkVendoredRuntime(base = assetsRoot()) {
  const version = pinnedVersion()
  const anchor = releaseAnchor(version)
  const dir = join(base, version)
  const problems = []
  problems.push(
    ...releaseAssetProblems(join(base, 'LICENSE'), anchor.license, 'assets/onnxruntime/LICENSE'),
  )
  let provenance
  try {
    provenance = JSON.parse(readFileSync(join(dir, PROVENANCE_FILE), 'utf8'))
  } catch {
    problems.push(`assets/onnxruntime/${version}/${PROVENANCE_FILE} is missing or unreadable`)
  }
  if (provenance !== undefined) {
    if (provenance.source !== anchor.tarball || provenance.integrity !== anchor.integrity)
      problems.push('the provenance does not identify the reviewed upstream tarball and integrity')
    if (provenance.version !== version) {
      problems.push(`the provenance records ${String(provenance.version)}, not ${version}`)
    }
    for (const name of runtimeFileNames()) {
      const path = join(dir, name)
      if (!existsSync(path)) {
        problems.push(`${name} is missing from assets/onnxruntime/${version}/`)
        continue
      }
      problems.push(...releaseAssetProblems(path, anchor.files[RUNTIME_FILES[name]], name))
      const recorded = provenance.files?.[name]
      if (recorded?.sha256 !== digestOf(path)) {
        problems.push(`${name} does not match its provenance hash`)
      }
    }
  }
  if (problems.length > 0) throw new Error(problems.join('; '))
  return version
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  try {
    if (process.argv.includes('--check')) {
      const version = checkVendoredRuntime()
      console.log(`vendored runtime ok: onnxruntime-web@${version}`)
    } else {
      const { version, files } = await vendorRuntime()
      console.log(
        `vendored runtime: onnxruntime-web@${version} (${Object.keys(files).length} files)`,
      )
    }
  } catch (error) {
    console.error(`vendored runtime: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
