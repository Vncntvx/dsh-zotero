/**
 * The build a consumer runs when installing this plugin **from source** (a git
 * URL, a checkout, or any channel that ships no prebuilt `lib/`).
 *
 * pnpm runs `prepare` inside the installed dependency's own tree. The script
 * carries the build steps it needs:
 *
 * 1. copies the pinned semantic runtime's build artifacts into `assets/`
 *    (generated like `lib/`, never committed);
 * 2. transpiles the Node half (`src/**` minus `src/client`) into `lib/` with
 *    esbuild, per file, keeping the emitted ESM specifiers exactly as written;
 * 3. emits public declarations with the installed TypeScript compiler;
 * 4. emits the browser half through the real client build
 *    (`scripts/build-client.mjs`), whose loader-handoff self-check still runs;
 * 5. proves the entries a consumer loads are on disk.
 *
 * The installed TypeScript compiler emits public declarations for both
 * installation channels, and verify:pack checks their freshness and contents.
 * When input and output digests are current, the script keeps the existing
 * declarations, Node entry, and browser bundle for `npm pack`/`npm publish`.
 * Pass `--force` to rebuild.
 * @module scripts/build-prepare
 */

import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { assertBuildFresh, writeBuildState } from './build-state.mjs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
import { buildClientBundle, parsedDocumentPackPaths, readerUiPackPaths } from './build-client.mjs'
import { readerPdfPackPaths } from './build-reader-pdf.mjs'
import { vendorRuntime } from './vendor-onnxruntime.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Source directory holding the Node half; `src/client` is the browser half. */
const SOURCE_DIR = join(root, 'src')
/** The browser half's source root, excluded from the Node transpile. */
const CLIENT_DIR = join(SOURCE_DIR, 'client')
const clientChunkPaths = [...readerPdfPackPaths, ...readerUiPackPaths, ...parsedDocumentPackPaths]

/**
 * Every Node-half TypeScript source file, in stable order.
 * @param {string} [dir=SOURCE_DIR] - directory to walk.
 * @returns {string[]} absolute source paths, sorted.
 */
function nodeSources(dir = SOURCE_DIR) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (path === CLIENT_DIR) continue
      found.push(...nodeSources(path))
      continue
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) found.push(path)
  }
  return found.sort()
}

/**
 * Every artifact a full build must leave behind. Checking only the package
 * entry can accept a tree whose internal module or declaration is missing;
 * require the complete Node emit plus the browser bundle instead.
 */
function fullBuildOutputs() {
  return [
    ...nodeSources().flatMap((source) => {
      const stem = relative(SOURCE_DIR, source).replace(/\.ts$/, '')
      return [join(root, 'lib', `${stem}.js`), join(root, 'lib', `${stem}.d.ts`)]
    }),
    join(root, 'lib', 'client.js'),
    ...clientChunkPaths.map((path) => join(root, path)),
  ]
}

// The full-build check also requires generated assets because packed installs
// depend on them alongside `lib/`.
const vendored = await vendorRuntime()
console.log(`vendored runtime: onnxruntime-web@${vendored.version}`)

const FULL_BUILD_OUTPUTS = fullBuildOutputs()
let fresh = false
try {
  assertBuildFresh()
  fresh = true
} catch {}
if (
  !process.argv.includes('--force') &&
  fresh &&
  FULL_BUILD_OUTPUTS.every((output) => existsSync(output))
) {
  console.log(
    `prepare skipped: a full build is already present (${FULL_BUILD_OUTPUTS.length} outputs)`,
  )
  process.exit(0)
}

/**
 * The plugin's declared entry files, relative to the package root: what a
 * consumer (the harness loader) resolves. Derived from `package.json` exports
 * so a new component entry cannot ship unchecked, with the browser bundle the
 * loader fetches by name appended when the map does not already list it.
 */
/**
 * @param {unknown} exportsMap - the manifest's `exports` map.
 * @returns {string[]} package-relative output paths, sorted.
 */
function requiredOutputsFrom(exportsMap) {
  /** @type {Set<string>} */
  const outputs = new Set()
  /** @param {unknown} value */
  const visit = (value) => {
    if (typeof value === 'string') {
      if (value.startsWith('./lib/') && value.endsWith('.js')) outputs.add(value.slice(2))
      return
    }
    if (value !== null && typeof value === 'object') {
      for (const nested of Object.values(value)) visit(nested)
    }
  }
  visit(exportsMap)
  outputs.add('lib/client.js')
  for (const path of clientChunkPaths) outputs.add(path)
  return [...outputs].sort()
}

const REQUIRED_OUTPUTS = requiredOutputsFrom(
  JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).exports,
)

const entryPoints = nodeSources()
if (entryPoints.length === 0) throw new Error('no Node-half sources found under src/')
rmSync(join(root, 'lib'), { recursive: true, force: true })

await esbuild.build({
  entryPoints,
  outdir: join(root, 'lib'),
  // `src/` is the TypeScript rootDir, so the emit mirrors the `build` (tsc) layout.
  outbase: SOURCE_DIR,
  bundle: false,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  sourcemap: true,
  logLevel: 'warning',
})
console.log(`transpiled ${entryPoints.length} Node-half module(s) into lib/`)

const require = createRequire(import.meta.url)
const compilerManifest = require.resolve('typescript/package.json')
const compiler = JSON.parse(readFileSync(compilerManifest, 'utf8'))
execFileSync(
  process.execPath,
  [
    join(dirname(compilerManifest), compiler.bin.tsc),
    '-p',
    join(root, 'tsconfig.json'),
    '--emitDeclarationOnly',
  ],
  { cwd: root, stdio: 'inherit' },
)

await buildClientBundle()

for (const output of REQUIRED_OUTPUTS) {
  try {
    readFileSync(join(root, output))
  } catch {
    throw new Error(`prepare did not produce ${output}; the package would not be loadable`)
  }
}
writeBuildState()
console.log(`prepare ok: ${REQUIRED_OUTPUTS.join(', ')}`)
