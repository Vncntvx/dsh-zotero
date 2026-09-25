/**
 * The build a consumer runs when installing this plugin **from source** (a git
 * URL, a checkout, or any channel that ships no prebuilt `lib/`).
 *
 * Why it is not just `npm run build`: pnpm runs `prepare` inside the installed
 * dependency's own tree, where neither the sibling harness checkout nor a full
 * development toolchain is guaranteed. The harness's plugin-authoring guide
 * makes the requirement explicit — a `prepare` script must be self-contained
 * and, in its cited working example, transpiles `src/` without project
 * references or typechecking. So this script only:
 *
 * 1. transpiles the Node half (`src/**` minus `src/client`) into `lib/` with
 *    esbuild, per file, keeping the emitted ESM specifiers exactly as written;
 * 2. emits the browser half through the real client build
 *    (`scripts/build-client.mjs`), whose loader-handoff self-check still runs;
 * 3. proves the entries a consumer loads are on disk.
 *
 * Declarations are deliberately out of scope here: they come from
 * `npm run build` (`tsc`), which the publish path runs (`prepublishOnly` →
 * `release:check`), and `npm run verify:pack` proves they reached the tarball.
 * A tree that already carries every full-build output (declarations, Node
 * entry, and browser bundle) is left untouched, so `npm pack`/`npm publish`
 * keep tsc's emit instead of overwriting it; pass `--force` to rebuild anyway.
 * @module scripts/build-prepare
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
import { buildClientBundle } from './build-client.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Source directory holding the Node half; `src/client` is the browser half. */
const SOURCE_DIR = join(root, 'src')
/** The browser half's source root, excluded from the Node transpile. */
const CLIENT_DIR = join(SOURCE_DIR, 'client')

/** Every Node-half TypeScript source file, in stable order. */
function nodeSources(dir = SOURCE_DIR) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (path === CLIENT_DIR) continue
      found.push(...nodeSources(path))
      continue
    }
    if (entry.name.endsWith('.ts')) found.push(path)
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
  ]
}

const FULL_BUILD_OUTPUTS = fullBuildOutputs()
if (!process.argv.includes('--force') && FULL_BUILD_OUTPUTS.every((output) => existsSync(output))) {
  console.log(
    `prepare skipped: a full build is already present (${FULL_BUILD_OUTPUTS.length} outputs)`,
  )
  process.exit(0)
}

/**
 * The plugin's declared entry points, relative to the package root: what a
 * consumer (the harness loader) resolves. Kept beside the build so a change to
 * `package.json` exports and the check that proves them cannot drift apart.
 */
const REQUIRED_OUTPUTS = ['lib/index.js', 'lib/client.js']

const entryPoints = nodeSources()
if (entryPoints.length === 0) throw new Error('no Node-half sources found under src/')

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

await buildClientBundle()

for (const output of REQUIRED_OUTPUTS) {
  try {
    readFileSync(join(root, output))
  } catch {
    throw new Error(`prepare did not produce ${output}; the package would not be loadable`)
  }
}
console.log(`prepare ok: ${REQUIRED_OUTPUTS.join(', ')}`)
