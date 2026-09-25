/**
 * The single place that keeps this repo's harness dependency state coherent.
 *
 * Two derived facts have to agree, and both rot silently:
 *
 * 1. **The pin.** `package.json` carries one harness line in exact form only:
 *    every `@deepseek-ai/dsh-*` in `dependencies` / `devDependencies` /
 *    `overrides` / `peerDependencies`, plus `engines.dsh` and `dsh.harnessRange`.
 *    No caret ranges, no dual arms. The exact `devDependencies` line is the
 *    source of truth; every other form is written from it. The tracked
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
/** Manifest sections whose every `@deepseek-ai/dsh-*` entry must equal the pin exactly. */
const VERSION_SECTIONS = ['dependencies', 'devDependencies', 'overrides', 'peerDependencies']
/** Source roots scanned for the upstream imports whose artifacts must be fresh. */
const SCAN_ROOTS = ['src', 'tests']
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
/**
 * Prose forms of the current pin. Badges are exact (`badge/dsh-0.1.7--rc.1-blue`);
 * the `>=` badge form is recognized only so a stale one can be rejected.
 */
const PROSE_VERSION_PATTERNS = [
  // Exact badge first so `dsh-0.1.7--rc.1-blue` never yields a bare `0.1.7`.
  /badge\/dsh-(\d+\.\d+\.\d+(?:--[0-9A-Za-z.]+)?)-blue/g,
  /dsh[- ]v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)*)(?!-)/gi,
]
/** Legacy `>=` badge: legal only as a migration leftover; current form is exact. */
const LEGACY_GTE_BADGE = /%3E%3D(\d+\.\d+\.\d+(?:--[0-9A-Za-z.]+)?)-blue/g

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

/**
 * Start of the historical version-mapping section in getting-started docs.
 * Pin moves must never rewrite those rows: they record what each plugin
 * release required, not the current pin.
 */
const VERSION_MAP_HEADING = /^(?:版本对照|Version mapping)/

/**
 * Locate the version-mapping section inside a getting-started document.
 * The section runs from its heading through the table, until the next `##`.
 * @param lines - the document, split on newlines.
 * @returns the half-open `[start, end)` line bounds, or `[-1, -1)` when absent.
 */
export function versionMapBounds(lines) {
  const start = lines.findIndex((line) => VERSION_MAP_HEADING.test(line.trim()))
  if (start < 0) return { start: -1, end: -1 }
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      end = i
      break
    }
  }
  return { start, end }
}

/**
 * Replace every prose form of the old pin with the new one, leaving the
 * historical version-mapping section untouched. A bare `replaceAll` of the
 * version string is what previously rewrote release history inside the table.
 */
export function retargetProse(source, previous, next) {
  const lines = source.split('\n')
  const { start, end } = versionMapBounds(lines)
  const exactBadge = `dsh-${encodeBadgeVersion(next)}-blue`
  const move = (line) =>
    line
      // Exact badge first (encoded prerelease uses `--`).
      .replaceAll(`dsh-${encodeBadgeVersion(previous)}-blue`, exactBadge)
      // Migrate a legacy `>=` badge to the exact current form in one step.
      .replaceAll(`%3E%3D${encodeBadgeVersion(previous)}-blue`, `${encodeBadgeVersion(next)}-blue`)
      .replaceAll(previous, next)
  return lines.map((line, i) => (i >= start && i < end ? line : move(line))).join('\n')
}

/** Parse one `| plugin | dsh |` version-mapping row into its two cells. */
function versionMapRow(line) {
  const match = /^\|\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)\s*\|([^|]*)\|/.exec(line.trim())
  if (match === null) return undefined
  return { plugin: match[1], dsh: match[2].trim() }
}

/**
 * The version-mapping table is historical; only its last row tracks the
 * current release. That row must name `package.json`'s version and a dsh cell
 * equal to the exact pin.
 * @returns human-readable failures; empty when the tail row is current.
 */
export function checkVersionMap(path, source, packageVersion, pin) {
  const errors = []
  const lines = source.split('\n')
  const { start, end } = versionMapBounds(lines)
  if (start < 0) {
    errors.push(`${relative(root, path)} has no version-mapping section`)
    return errors
  }
  const rows = lines
    .slice(start, end)
    .map(versionMapRow)
    .filter((row) => row !== undefined)
  if (rows.length === 0) {
    errors.push(`${relative(root, path)} version-mapping table has no release rows`)
    return errors
  }
  const last = rows[rows.length - 1]
  if (last.plugin !== packageVersion) {
    errors.push(
      `${relative(root, path)} version-mapping last row is "${last.plugin}", expected package version "${packageVersion}"`,
    )
  }
  if (last.dsh !== pin) {
    errors.push(
      `${relative(root, path)} version-mapping last row dsh cell "${last.dsh}" is not the exact pin "${pin}"`,
    )
  }
  return errors
}

/** Fail on any harness version in current-pin prose that is not the pin. */
function checkProse(path, pin) {
  const text = readFileSync(path, 'utf8')
  const lines = text.split('\n')
  const { start, end } = versionMapBounds(lines)
  const prose = lines.filter((_, i) => i < start || i >= end).join('\n')
  for (const match of prose.matchAll(LEGACY_GTE_BADGE)) {
    problems.push(
      `${relative(root, path)} still carries a ">= ${decodeBadgeVersion(match[1])}" badge;` +
        ` the current form is the exact badge "dsh ${pin}"`,
    )
  }
  const found = new Set()
  for (const pattern of PROSE_VERSION_PATTERNS) {
    for (const match of prose.matchAll(pattern)) found.add(decodeBadgeVersion(match[1]))
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

/** Every problem in a lockfile relative to the pin and the manifest's overrides. */
export function collectLockProblems(lock, manifest, pin) {
  const problems = []
  const offenders = Object.entries(lock.packages ?? {})
    .filter(
      ([path, entry]) => path.includes('node_modules/@deepseek-ai/dsh-') && entry.version !== pin,
    )
    .map(
      ([path, entry]) =>
        `${path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)}@${entry.version}`,
    )
    .sort()
  if (offenders.length > 0) {
    const shown = offenders.slice(0, 6)
    const more =
      offenders.length > shown.length ? ` (+${offenders.length - shown.length} more)` : ''
    problems.push(
      `package-lock.json resolves ${offenders.length} harness package(s) off the pin "${pin}":` +
        ` ${shown.join(', ')}${more} — add a missing name to overrides, then run:` +
        ' npm install --package-lock-only' +
        ' (if the registry has not published the pin yet, typecheck may still use npm run link:local-harness,' +
        ' but the lock must not be hand-edited to fake the pin)',
    )
  }

  if (manifest !== undefined) {
    const overrideKeys = new Set(Object.keys(manifest.overrides ?? {}))
    const lockDshPackages = [
      ...new Set(
        Object.keys(lock.packages ?? {})
          .filter((p) => p.includes('node_modules/@deepseek-ai/dsh-'))
          .map((p) => p.slice(p.lastIndexOf('node_modules/') + 'node_modules/'.length)),
      ),
    ].sort()
    const missingOverrides = lockDshPackages.filter((name) => !overrideKeys.has(name))
    if (missingOverrides.length > 0) {
      problems.push(
        `package.json overrides is missing ${missingOverrides.length} @deepseek-ai/dsh-* package(s) from lockfile:` +
          ` ${missingOverrides.join(', ')} — add them to overrides and run: npm install --package-lock-only`,
      )
    }
  }
  return problems
}

/** Fail when the lockfile resolves any harness package off the pin or overrides is not a superset. */
function checkLock(pin, manifest) {
  const lockPath = join(root, 'package-lock.json')
  if (!existsSync(lockPath)) {
    problems.push('package-lock.json is missing; run: npm install --package-lock-only')
    return
  }
  const lock = readJson(lockPath)
  problems.push(...collectLockProblems(lock, manifest, pin))
}

/**
 * Whether a declared harness face is the exact pin (never a range or dual arm).
 * @param value - the declared string.
 * @param pin - the exact pin.
 * @returns true when the value is exactly the pin.
 */
function isExactPinFace(value, pin) {
  return value === pin && VERSION_PATTERN.test(value)
}

/** Human-readable reason a harness face is not the exact pin. */
function exactPinProblem(section, name, value, pin) {
  const where = name === undefined ? section : `${section}["${name}"]`
  if (typeof value !== 'string' || value.length === 0) {
    return `${where} is missing; expected the exact pin "${pin}"`
  }
  if (value.includes('||') || /^[~^]|^[<>]/.test(value) || value.includes(' - ')) {
    return `${where} is "${value}"; only the exact pin "${pin}" is allowed (no ranges, no dual arms)`
  }
  return `${where} is "${value}", expected the exact pin "${pin}"`
}

/**
 * Every harness-face problem in a manifest relative to one exact pin.
 * Pure: used by `checkPin` and unit-tested without the CLI side effects.
 * @param manifest - parsed package.json.
 * @param pin - the exact pin every face must equal.
 * @returns human-readable problems; empty when every face is the pin.
 */
export function collectPinFaceProblems(manifest, pin) {
  const found = []
  const peers = Object.keys(manifest.peerDependencies ?? {}).filter(isDshPackage)
  // The harness evaluatePluginCompatibility reads only peerDependencies — zero dsh
  // peers would load on any runtime even when engines.dsh names the pin.
  if (peers.length === 0) {
    found.push(
      'peerDependencies declares no @deepseek-ai/dsh-* entry;' +
        ' at least one exact dsh peer is required so the runtime rejects other dsh lines',
    )
  }
  for (const section of VERSION_SECTIONS) {
    for (const [name, version] of Object.entries(manifest[section] ?? {})) {
      if (!isDshPackage(name)) continue
      if (!isExactPinFace(version, pin)) {
        found.push(exactPinProblem(section, name, version, pin))
      }
    }
  }
  if (!isExactPinFace(manifest.engines?.dsh, pin)) {
    found.push(exactPinProblem('engines.dsh', undefined, manifest.engines?.dsh, pin))
  }
  if (!isExactPinFace(manifest.dsh?.harnessRange, pin)) {
    found.push(exactPinProblem('dsh.harnessRange', undefined, manifest.dsh?.harnessRange, pin))
  }
  return found
}

/** Check every derived form of the pin against the source of truth. */
function checkPin(manifest) {
  const pin = pinnedVersion(manifest)
  if (pin === undefined) return undefined
  problems.push(...collectPinFaceProblems(manifest, pin))
  if (manifest.dshWorkshop !== undefined) {
    problems.push(
      'package.json still carries dshWorkshop; Workshop support was removed — delete the block',
    )
  }
  for (const path of prosePaths) checkProse(path, pin)
  for (const path of docPaths) {
    problems.push(...checkVersionMap(path, readFileSync(path, 'utf8'), manifest.version, pin))
  }
  checkLock(pin, manifest)
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
  for (const section of VERSION_SECTIONS) {
    for (const name of Object.keys(manifest[section] ?? {})) {
      if (!isDshPackage(name) || known.has(name)) continue
      // A manifest key may name a package the sibling monorepo publishes under
      // a path this walk already found; a true miss means the npm name is gone
      // upstream.
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

/**
 * Rewrite every harness face of a manifest to one exact pin. Mutates
 * `manifest` in place. Peers, engines, and harnessRange all become the
 * pin itself — never a caret range and never a dual arm.
 * @param manifest - parsed package.json (mutated in place).
 * @param version - the exact new pin.
 * @returns the same manifest for chaining/tests.
 */
export function applyPinToManifest(manifest, version) {
  for (const section of VERSION_SECTIONS) {
    for (const name of Object.keys(manifest[section] ?? {})) {
      if (isDshPackage(name)) manifest[section][name] = version
    }
  }
  if (manifest.dsh && typeof manifest.dsh === 'object') manifest.dsh.harnessRange = version
  manifest.engines = { ...manifest.engines, dsh: version }
  return manifest
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
  const manifest = applyPinToManifest(readJson(pkgPath), version)
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

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
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
}
