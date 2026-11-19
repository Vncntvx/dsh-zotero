/** Create and verify the exact prebuilt tree shared by smoke and publication. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertBuildFresh } from './build-state.mjs'
import { tarFileDigests } from './release-tar.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const provenanceName = 'release-provenance.json'
/** @param bytes {string | Uint8Array} @returns {string} the sha256 hex digest. */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
/**
 * Refuse release paths that are not clean, relative, POSIX-safe segments.
 * @param path {unknown} the manifest-declared path.
 * @returns {string} the same path once proven safe.
 */
function safePath(path) {
  if (
    typeof path !== 'string' ||
    path === '' ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.split('/').some((part) => part === '' || part === '.' || part === '..')
  )
    throw new Error(`Unsafe release path: ${String(path)}`)
  return path
}
/**
 * Digest every regular file under `base` into a sorted path→sha256 map.
 * @param base {string} the tree root.
 * @param [prefix] {string} the accumulated relative path.
 * @returns {Record<string, string>} path → sha256 hex digest.
 */
function tree(base, prefix = '') {
  /** @type {Record<string, string>} */
  const files = {}
  for (const entry of readdirSync(join(base, prefix), { withFileTypes: true })) {
    const path = safePath(prefix ? `${prefix}/${entry.name}` : entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Release trees cannot contain links: ${path}`)
    if (entry.isDirectory()) Object.assign(files, tree(base, path))
    else if (!entry.isFile()) throw new Error(`Release trees require regular files: ${path}`)
    else if (path !== provenanceName) files[path] = sha256(readFileSync(join(base, path)))
  }
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b, 'en')))
}
/**
 * The `package.json` face the release gate reads: the fields it copies into
 * the staged manifest and the three host-only sections it strips.
 * @typedef {{
 *   name?: string,
 *   version?: string,
 *   main?: string,
 *   types?: string,
 *   icon?: string,
 *   files?: string[],
 *   exports?: unknown,
 *   dsh?: { bundle?: { patch?: string | string[] } },
 *   scripts?: unknown,
 *   devDependencies?: unknown,
 *   overrides?: unknown,
 * }} ReleasePackageManifest
 */

/**
 * The provenance a verified release artifact carries.
 * @typedef {{
 *   version: number,
 *   name: string,
 *   packageVersion: string,
 *   sourceSha: string,
 *   buildDigest: string,
 *   artifactDigest: string,
 *   files: Record<string, string>,
 * }} ReleaseProvenance
 */

/**
 * The verified release artifact: the staged tree, the packed tarball, and the
 * provenance the publication steps carry forward.
 * @typedef {{ stage: string, tarball: string, provenance: ReleaseProvenance }} VerifiedReleaseArtifact
 */

/**
 * The staged manifest: the package manifest with the host-only sections
 * stripped and the provenance file added to `files`.
 * @param manifest {ReleasePackageManifest} the parsed source `package.json`.
 * @returns {ReleasePackageManifest} the manifest the tarball carries.
 */
export function releaseManifestOf(manifest) {
  const { scripts: _scripts, devDependencies: _dev, overrides: _overrides, ...release } = manifest
  return { ...release, files: [...new Set([...(manifest.files ?? []), provenanceName])] }
}

/**
 * The concrete paths the manifest says a consumer resolves.
 * @param manifest {ReleasePackageManifest} the staged package manifest.
 * @returns {string[]} safe, relative paths; wildcard entries are excluded.
 */
function manifestEntries(manifest) {
  /** @type {Set<unknown>} */
  const paths = new Set([manifest.main, manifest.types, manifest.icon, manifest.dsh?.bundle?.patch])
  /** @param value {unknown} */
  function visit(value) {
    if (typeof value === 'string') paths.add(value)
    else if (value && typeof value === 'object') Object.values(value).forEach(visit)
  }
  visit(manifest.exports)
  return /** @type {string[]} */ (
    [...paths].filter((path) => typeof path === 'string' && !path.includes('*'))
  ).map((path) => safePath(path.replace(/^\.\//, '')))
}

/**
 * Prepare the tree consumed by smoke and publication; later steps run no
 * build/install scripts.
 * @param out {string} the empty artifact directory to stage into.
 * @param sourceSha {string} the exact source commit the build was stamped with.
 * @param [base] {string} the package root the build state and manifest are read from.
 * @returns {VerifiedReleaseArtifact} the verified stage and tarball.
 */
export function prepareReleaseArtifact(out, sourceSha, base = root) {
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(sourceSha))
    throw new Error('Expected a full source commit SHA')
  const build = assertBuildFresh(base)
  if (build.commit !== sourceSha) throw new Error('Build commit does not match release source')
  if (execFileSync('git', ['status', '--porcelain'], { cwd: base, encoding: 'utf8' }).trim() !== '')
    throw new Error('Release source tree is dirty')
  if (existsSync(out)) throw new Error('Release artifact destination already exists')
  const manifest = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8'))
  const stage = join(out, 'package')
  mkdirSync(stage, { recursive: true, mode: 0o700 })
  for (const path of [...manifest.files, 'LICENSE']) {
    safePath(path)
    const source = join(base, path)
    if (!existsSync(source)) throw new Error(`Declared release artifact is missing: ${path}`)
    // Inspect before copying: cp must never follow a symlink into another tree.
    if (lstatSync(source).isDirectory()) tree(source)
    else if (!lstatSync(source).isFile() || lstatSync(source).isSymbolicLink())
      throw new Error(`Unsafe release artifact: ${path}`)
    mkdirSync(dirname(join(stage, path)), { recursive: true })
    cpSync(source, join(stage, path), { recursive: true, dereference: false })
  }
  writeFileSync(
    join(stage, 'package.json'),
    `${JSON.stringify(releaseManifestOf(manifest), null, 2)}\n`,
  )
  const files = tree(stage)
  const provenance = {
    version: 1,
    name: manifest.name,
    packageVersion: manifest.version,
    sourceSha,
    buildDigest: build.inputs.digest,
    artifactDigest: sha256(JSON.stringify(files)),
    files,
  }
  writeFileSync(join(stage, provenanceName), `${JSON.stringify(provenance, null, 2)}\n`)
  const output = execFileSync(
    'npm',
    ['pack', '--ignore-scripts', '--json', '--pack-destination', resolve(out)],
    { cwd: stage, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  )
  const report = JSON.parse(output)
  const packed = (Array.isArray(report) ? report : Object.values(report))[0]
  const tarball = safePath(packed.filename)
  writeFileSync(
    join(out, 'artifact.json'),
    `${JSON.stringify({ sourceSha, tarball, tarballSha256: sha256(readFileSync(join(out, tarball))), artifactDigest: provenance.artifactDigest }, null, 2)}\n`,
  )
  return verifyReleaseArtifact(out, sourceSha)
}

/**
 * Validate every byte and the closed file set before any release ref changes.
 * @param out {string} the artifact directory holding `artifact.json` and `package/`.
 * @param sourceSha {string} the exact source commit the artifact was built from.
 * @returns {VerifiedReleaseArtifact} the staged tree, tarball path, and provenance.
 */
export function verifyReleaseArtifact(out, sourceSha) {
  const envelope = JSON.parse(readFileSync(join(out, 'artifact.json'), 'utf8'))
  const stage = join(out, 'package')
  const provenance = JSON.parse(readFileSync(join(stage, provenanceName), 'utf8'))
  const manifest = JSON.parse(readFileSync(join(stage, 'package.json'), 'utf8'))
  const files = tree(stage)
  if (
    provenance.version !== 1 ||
    provenance.sourceSha !== sourceSha ||
    envelope.sourceSha !== sourceSha ||
    manifest.name !== 'dsh-zotero' ||
    manifest.name !== provenance.name ||
    manifest.version !== provenance.packageVersion ||
    manifest.scripts !== undefined ||
    manifest.devDependencies !== undefined ||
    manifest.overrides !== undefined ||
    JSON.stringify(files) !== JSON.stringify(provenance.files) ||
    sha256(JSON.stringify(files)) !== provenance.artifactDigest ||
    envelope.artifactDigest !== provenance.artifactDigest
  )
    throw new Error('Release artifact identity or file digest mismatch')
  for (const path of manifestEntries(manifest))
    if (!Object.hasOwn(files, path)) throw new Error(`Release artifact lacks ${path}`)
  const tarball = join(out, safePath(envelope.tarball))
  const packed = readFileSync(tarball)
  if (sha256(packed) !== envelope.tarballSha256) throw new Error('Release tarball digest mismatch')
  const expected = Object.fromEntries(
    Object.entries({
      ...files,
      [provenanceName]: sha256(readFileSync(join(stage, provenanceName))),
    }).sort(([a], [b]) => a.localeCompare(b, 'en')),
  )
  if (JSON.stringify(tarFileDigests(packed)) !== JSON.stringify(expected))
    throw new Error('Release tarball does not match the verified tree')
  return { stage, tarball, provenance }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[process.argv.indexOf('--out') + 1]
  const source = process.argv[process.argv.indexOf('--source-sha') + 1]
  if (!process.argv.includes('--out') || !process.argv.includes('--source-sha') || !out || !source)
    throw new Error('Expected --out <directory> --source-sha <commit>')
  if (process.argv.includes('--verify')) verifyReleaseArtifact(resolve(out), source)
  else prepareReleaseArtifact(resolve(out), source)
}
