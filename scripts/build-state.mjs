/** Bind emitted artifacts to their complete source, configuration and lock inputs. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const marker = 'lib/.build-state.json'
function filesUnder(base, path) {
  const absolute = join(base, path)
  if (!existsSync(absolute)) return []
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Build tree contains a symbolic link: ${child}`)
    return entry.isDirectory() ? filesUnder(base, child) : [child.replaceAll('\\', '/')]
  })
}
function digestFiles(base, paths) {
  const files = Object.fromEntries(
    [...new Set(paths)].sort().map((path) => [
      path,
      createHash('sha256')
        .update(readFileSync(join(base, path)))
        .digest('hex'),
    ]),
  )
  return { files, digest: createHash('sha256').update(JSON.stringify(files)).digest('hex') }
}
function snapshot(base) {
  let commit = 'unknown'
  try {
    const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: base,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (realpathSync(gitRoot) === realpathSync(base)) {
      commit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: base,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    }
  } catch {}
  const inputs = digestFiles(
    base,
    [
      ...filesUnder(base, 'src'),
      ...filesUnder(base, 'scripts'),
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'tsconfig.client.json',
      'tests/fixtures/style-tokens.json',
      'tests/fixtures/harness-client-graph-pin.json',
      'tests/fixtures/harness-mirrored-deps-pin.json',
    ].filter((path) => existsSync(join(base, path))),
  )
  const outputs = digestFiles(base, [
    ...filesUnder(base, 'lib').filter((path) => path !== marker),
    ...filesUnder(base, 'assets/onnxruntime'),
  ])
  const toolchain = { node: process.version }
  for (const name of ['typescript', 'esbuild']) {
    const path = join(base, 'node_modules', name, 'package.json')
    if (existsSync(path)) toolchain[name] = JSON.parse(readFileSync(path, 'utf8')).version
  }
  return {
    version: 1,
    commit,
    mode: process.env.NODE_ENV ?? 'production',
    toolchain,
    inputs,
    outputs,
  }
}

/** Record digests after the Node, declaration, browser, and asset builds succeed. */
export function writeBuildState(base = root) {
  const state = snapshot(base)
  if (Object.keys(state.outputs.files).length === 0) throw new Error('No build artifacts to stamp')
  writeFileSync(join(base, marker), `${JSON.stringify(state, null, 2)}\n`)
  return state
}

/** Verify the recorded inputs, outputs, toolchain, and build provenance. */
export function assertBuildFresh(base = root) {
  let saved
  try {
    saved = JSON.parse(readFileSync(join(base, marker), 'utf8'))
  } catch {
    throw new Error('Build provenance is missing; run npm run build')
  }
  const current = snapshot(base)
  if (
    saved.version !== current.version ||
    saved.commit !== current.commit ||
    saved.mode !== current.mode ||
    JSON.stringify(saved.toolchain) !== JSON.stringify(current.toolchain) ||
    saved.inputs?.digest !== current.inputs.digest ||
    saved.outputs?.digest !== current.outputs.digest
  )
    throw new Error('Build artifacts are stale or modified; run npm run build')
  return current
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) writeBuildState()
  else assertBuildFresh()
}
