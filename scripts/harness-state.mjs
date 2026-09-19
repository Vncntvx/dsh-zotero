/**
 * The single place that keeps this repo's harness dependency state coherent.
 *
 * Two derived facts have to agree, and both rot silently:
 *
 * 1. **The pin.** `package.json` carries one harness line in four derived forms
 *    (exact `dependencies` / `devDependencies` / `overrides`, `^`-ranged
 *    `peerDependencies`, and `engines.dsh`), plus the version the READMEs and
 *    AGENTS.md state in prose. The exact `devDependencies` line is the source
 *    of truth; every other form is written from it. The tracked
 *    `package-lock.json` is held to the same pin.
 *
 * 2. **The artifacts.** Upstream packages resolve through
 *    `node_modules/@deepseek-ai/*`, which `scripts/link-local-harness.mjs`
 *    symlinks at the sibling `../deepseek-harness` checkout (AGENTS.md).
 *    TypeScript reads that checkout's built `lib/types/*.d.ts`, and a `git pull`
 *    does not regenerate it — a stale build would silently typecheck this repo
 *    against an older interface than the one it runs on.
 *
 * Usage:
 *   node scripts/harness-state.mjs                 # check every fact, then exit
 *   node scripts/harness-state.mjs --strict        # stale declarations fail too
 *   node scripts/harness-state.mjs --write <ver>   # move the pin, then re-check
 *   # --write leaves package-lock.json behind: npm install --package-lock-only
 * @module scripts/harness-state
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harnessRoot = resolve(process.env.DSH_HARNESS_ROOT ?? join(root, '../deepseek-harness'))
const pkgPath = join(root, 'package.json')
const readmePaths = ['README.md', 'README.en.md'].map((name) => join(root, name))
const agentsPath = join(root, 'AGENTS.md')
/** User-facing docs that restate the pin alongside the READMEs. */
const docPaths = ['docs/getting-started.md', 'docs/getting-started.en.md'].map((name) =>
  join(root, name),
)
/** Files whose prose restates the pin. */
const prosePaths = [...readmePaths, ...docPaths, agentsPath]
/** Exact-version sections; `peerDependencies` is ranged and handled separately. */
const EXACT_SECTIONS = ['dependencies', 'devDependencies', 'overrides']
const RANGED_SECTIONS = ['peerDependencies']
/** Source roots scanned for the upstream imports whose artifacts must be fresh. */
const SCAN_ROOTS = ['src', 'tests']
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
/** Prose forms of a harness version: `dsh 1.2.3`, `DSH 1.2.3`, `dsh-v1.2.3`, `dsh-%3E%3D1.2.3--rc.1-blue`. */
const PROSE_VERSION_PATTERNS = [
  /dsh[- ]v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/gi,
  /%3E%3D(\d+\.\d+\.\d+(?:--[0-9A-Za-z.]+)?)-blue/g,
]

const problems = []
const notes = []

const isDshPackage = (name) => name.startsWith('@deepseek-ai/dsh-')
const decodeBadgeVersion = (encoded) => encoded.replaceAll('--', '-')
const encodeBadgeVersion = (version) => version.replaceAll('-', '--')

/** Read and parse one JSON file. */
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** The pinned harness version: the exact `devDependencies` line, validated. */
function pinnedVersion(manifest) {
  const entries = Object.entries(manifest.devDependencies ?? {}).filter(([name]) =>
    isDshPackage(name),
  )
  if (entries.length === 0) {
    problems.push('package.json declares no @deepseek-ai/dsh-* devDependency to pin from')
    return undefined
  }
  const versions = new Set(entries.map(([, version]) => version))
  if (versions.size !== 1) {
    problems.push(
      `devDependencies disagree on the harness version (${[...versions].sort().join(', ')});` +
        ' keep one exact version on every @deepseek-ai/dsh-* entry',
    )
    return undefined
  }
  const pin = entries[0][1]
  if (!VERSION_PATTERN.test(pin)) {
    problems.push(`devDependencies pin "${pin}" is not an exact version; the pin is never a range`)
  }
  return pin
}

/** Fail on any harness version in prose that is not the pin. */
function checkProse(path, pin) {
  const text = readFileSync(path, 'utf8')
  const found = new Set()
  for (const pattern of PROSE_VERSION_PATTERNS) {
    for (const match of text.matchAll(pattern)) found.add(decodeBadgeVersion(match[1]))
  }
  if (found.size === 0) {
    problems.push(`${relative(root, path)} states no harness version; name the verified pin`)
    return
  }
  for (const version of found) {
    if (version !== pin) {
      problems.push(
        `${relative(root, path)} still states harness version "${version}" (the pin is "${pin}")`,
      )
    }
  }
}

/** Fail when the lockfile resolves any harness package off the pin. */
function checkLock(pin) {
  const lockPath = join(root, 'package-lock.json')
  if (!existsSync(lockPath)) {
    problems.push('package-lock.json is missing; run: npm install --package-lock-only')
    return
  }
  const lock = readJson(lockPath)
  const offenders = Object.entries(lock.packages ?? {})
    .filter(
      ([path, entry]) => path.includes('node_modules/@deepseek-ai/dsh-') && entry.version !== pin,
    )
    .map(
      ([path, entry]) =>
        `${path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)}@${entry.version}`,
    )
    .sort()
  if (offenders.length === 0) return
  const shown = offenders.slice(0, 6)
  const more = offenders.length > shown.length ? ` (+${offenders.length - shown.length} more)` : ''
  problems.push(
    `package-lock.json resolves ${offenders.length} harness package(s) off the pin "${pin}":` +
      ` ${shown.join(', ')}${more} — add a missing name to overrides, then run:` +
      ' npm install --package-lock-only',
  )
}

/**
 * The install-facing harness range: explicit dual support when the manifest
 * declares `dsh.harnessRange`, otherwise the single-pin form `^<pin>`.
 * @param manifest - package.json contents.
 * @param pin - exact devDependency pin.
 * @returns the range engines.dsh and every dsh peer must equal.
 */
function harnessRange(manifest, pin) {
  const declared = manifest.dsh?.harnessRange
  if (typeof declared !== 'string' || declared.length === 0) return `^${pin}`
  const arms = declared.split('||').map((arm) => arm.trim())
  if (!arms.includes(`^${pin}`)) {
    problems.push(
      `dsh.harnessRange "${declared}" does not include the pin arm "^${pin}";` +
        ' dual ranges must keep the typecheck pin as one alternative',
    )
  }
  return declared
}

/** Check every derived form of the pin against the source of truth. */
function checkPin(manifest) {
  const pin = pinnedVersion(manifest)
  if (pin === undefined) return undefined
  const range = harnessRange(manifest, pin)
  for (const section of EXACT_SECTIONS) {
    for (const [name, version] of Object.entries(manifest[section] ?? {})) {
      if (isDshPackage(name) && version !== pin) {
        problems.push(`${section}["${name}"] is "${version}", expected the pin "${pin}"`)
      }
    }
  }
  for (const section of RANGED_SECTIONS) {
    for (const [name, version] of Object.entries(manifest[section] ?? {})) {
      if (isDshPackage(name) && version !== range) {
        problems.push(`${section}["${name}"] is "${version}", expected "${range}"`)
      }
    }
  }
  if (manifest.engines?.dsh !== range) {
    problems.push(`engines.dsh is "${manifest.engines?.dsh}", expected "${range}"`)
  }
  if (manifest.dshWorkshop !== undefined) {
    problems.push(
      'package.json still carries dshWorkshop; Workshop support was removed — delete the block',
    )
  }
  for (const path of prosePaths) checkProse(path, pin)
  checkLock(pin)
  checkOverrideNames(manifest)
  return pin
}

/**
 * Report override / peer / dev keys that name a package the sibling monorepo
 * no longer carries (upstream renames such as `dsh-code-runtime` →
 * `dsh-ptc-runtime`). A stale key pins a package the tree can never pull, so
 * it is silent rot until the rename's real name is missing from overrides.
 */
function checkOverrideNames(manifest) {
  const known = harnessPackages()
  if (known.size === 0) return
  for (const section of [...EXACT_SECTIONS, ...RANGED_SECTIONS]) {
    for (const name of Object.keys(manifest[section] ?? {})) {
      if (!isDshPackage(name) || known.has(name)) continue
      // Peer ranges may name packages the monorepo publishes under a path this
      // walk already found; a true miss means the npm name is gone upstream.
      notes.push(
        `${section}["${name}"] names a package the sibling harness does not carry` +
          ' — drop the key or rename it if upstream moved the package',
      )
    }
  }
}

/** Every `@deepseek-ai/*` package the sibling monorepo carries, name to directory. */
function harnessPackages() {
  const map = new Map()
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.'))
        continue
      const child = join(dir, entry.name)
      const manifestPath = join(child, 'package.json')
      if (!existsSync(manifestPath)) {
        walk(child)
        continue
      }
      const name = readJson(manifestPath).name
      if (typeof name === 'string' && name.startsWith('@deepseek-ai/')) map.set(name, child)
      else walk(child)
    }
  }
  walk(join(harnessRoot, 'packages'))
  walk(join(harnessRoot, 'vendor'))
  return map
}

/** Collect every `@deepseek-ai/*` specifier this repo imports. */
function importedSpecifiers() {
  const specifiers = new Set()
  const pattern = /(?:from|import)\s*\(?\s*'(@deepseek-ai\/[^']+)'/g
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const child = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(child)
        continue
      }
      if (!/\.(?:ts|tsx)$/.test(entry.name)) continue
      for (const match of readFileSync(child, 'utf8').matchAll(pattern)) specifiers.add(match[1])
    }
  }
  for (const scanRoot of SCAN_ROOTS) walk(join(root, scanRoot))
  return [...specifiers].sort()
}

/** Newest modification time under a directory tree, or undefined when absent. */
function newestMtime(dir) {
  let newest
  const walk = (current) => {
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const child = join(current, entry.name)
      if (entry.isDirectory()) walk(child)
      else if (!entry.name.endsWith('.map')) {
        const mtime = statSync(child).mtimeMs
        if (newest === undefined || mtime > newest) newest = mtime
      }
    }
  }
  walk(dir)
  return newest
}

/**
 * The declaration file TypeScript reads for one imported specifier. The
 * package's own `exports` map decides, so this check follows the same map the
 * compiler follows rather than guessing a path.
 * @param pkgDir - installed package directory.
 * @param specifier - the import specifier as written.
 * @returns absolute declaration path, or undefined when the export carries none.
 */
function declarationOf(pkgDir, specifier) {
  const manifest = readJson(join(pkgDir, 'package.json'))
  const sub = specifier.slice(manifest.name.length).replace(/^\//, '')
  const key = sub === '' ? '.' : `./${sub}`
  const entry = manifest.exports?.[key] ?? (sub === '' ? manifest.types : undefined)
  const types = typeof entry === 'string' ? entry : entry?.types
  return typeof types === 'string' ? join(pkgDir, types) : undefined
}

/**
 * Verify every imported upstream package's installed declarations are current:
 * missing declarations are always a failure (typecheck cannot resolve them),
 * stale ones fail only under `--strict` — a stale sibling build weakens the
 * guarantee without blocking day-to-day work, and the release path is where the
 * guarantee has to hold.
 * @param strict - treat stale declarations as a failure.
 */
function checkArtifacts(strict) {
  if (!existsSync(harnessRoot)) {
    notes.push('sibling harness absent: upstream types come from the installed packages as-is')
    return
  }
  const packages = harnessPackages()
  const stale = []
  const missing = []
  const outside = []
  for (const specifier of importedSpecifiers()) {
    const pkgDir = packages.get(specifier.split('/').slice(0, 2).join('/'))
    if (pkgDir === undefined) {
      outside.push(specifier)
      continue
    }
    const declaration = declarationOf(pkgDir, specifier)
    if (declaration === undefined || !existsSync(declaration)) {
      missing.push(specifier)
      continue
    }
    const sourceNewest = newestMtime(join(pkgDir, 'src'))
    if (sourceNewest !== undefined && statSync(declaration).mtimeMs < sourceNewest)
      stale.push(specifier)
  }
  if (missing.length > 0) {
    problems.push(
      `installed declarations missing for: ${missing.join(', ')}` +
        ' — run: npm run link:local-harness, then build the sibling harness',
    )
  }
  if (stale.length > 0) {
    const detail =
      `${stale.length} imported upstream package(s) have src newer than their built declarations` +
      ` (${stale.join(', ')}); typecheck resolves the older declarations` +
      ' — refresh with: pnpm --dir ../deepseek-harness run build'
    if (strict) problems.push(detail)
    else notes.push(detail)
  }
  if (outside.length > 0) {
    notes.push(`${outside.length} specifier(s) resolve outside the sibling: ${outside.join(', ')}`)
  }
}

/** Replace every prose form of the old pin with the new one. */
function retargetProse(source, previous, next) {
  return source
    .replaceAll(previous, next)
    .replaceAll(
      `%3E%3D${encodeBadgeVersion(previous)}-blue`,
      `%3E%3D${encodeBadgeVersion(next)}-blue`,
    )
}

/** Move the pin; the caller re-runs the check against what was written. */
function writePin(version, previous) {
  if (previous === undefined || !VERSION_PATTERN.test(version)) {
    problems.push(
      previous === undefined
        ? 'cannot move the pin: devDependencies do not agree on one exact @deepseek-ai/dsh-* version'
        : `--write needs an exact version, got "${version}"`,
    )
    return
  }
  const manifest = readJson(pkgPath)
  for (const section of EXACT_SECTIONS) {
    for (const name of Object.keys(manifest[section] ?? {})) {
      if (isDshPackage(name)) manifest[section][name] = version
    }
  }
  // Dual install ranges live in dsh.harnessRange; rewrite the pin arm in place
  // instead of collapsing peers/engines back to a single ^version.
  const priorRange = manifest.dsh?.harnessRange
  const nextRange =
    typeof priorRange === 'string' && priorRange.length > 0
      ? priorRange
          .split('||')
          .map((arm) => arm.trim())
          .map((arm) => (arm === `^${previous}` ? `^${version}` : arm))
          .join(' || ')
      : `^${version}`
  if (manifest.dsh && typeof manifest.dsh === 'object') manifest.dsh.harnessRange = nextRange
  for (const section of RANGED_SECTIONS) {
    for (const name of Object.keys(manifest[section] ?? {})) {
      if (isDshPackage(name)) manifest[section][name] = nextRange
    }
  }
  manifest.engines = { ...manifest.engines, dsh: nextRange }
  writeFileSync(pkgPath, `${JSON.stringify(manifest, null, 2)}\n`)
  for (const path of prosePaths) {
    const before = readFileSync(path, 'utf8')
    const after = retargetProse(before, previous, version)
    if (after !== before) writeFileSync(path, after)
  }
}

/** Print the accumulated diagnostics and set the exit code. */
function report() {
  for (const line of notes) console.log(`note: ${line}`)
  if (problems.length > 0) {
    for (const line of problems) console.error(`harness state: ${line}`)
    process.exitCode = 1
  }
}

/** Check every fact and report; the success banner prints only a resolved pin. */
function runCheck(strict) {
  const pin = checkPin(readJson(pkgPath))
  checkArtifacts(strict)
  report()
  if (problems.length === 0) console.log(`harness state ok: pin ${pin}`)
  return pin
}

const writeIndex = process.argv.indexOf('--write')
if (writeIndex !== -1) {
  const version = process.argv[writeIndex + 1]
  if (version === undefined) {
    console.error('usage: node scripts/harness-state.mjs --write <version>')
    process.exitCode = 1
  } else {
    const previous = pinnedVersion(readJson(pkgPath))
    writePin(version, previous)
    if (problems.length > 0) {
      report()
    } else {
      console.log(`pin moved ${previous} -> ${version}`)
      // Re-check what was written; a stale package-lock.json surfaces here.
      runCheck(false)
    }
  }
} else {
  runCheck(process.argv.includes('--strict'))
}
