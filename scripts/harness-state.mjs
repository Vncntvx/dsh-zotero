/**
 * The single place that keeps this repo's harness dependency state coherent.
 *
 * Two derived facts have to agree, and both rot silently:
 *
 * 1. **The pin.** `package.json` carries one harness line:
 *    every `@deepseek-ai/dsh-*` in `dependencies` / `devDependencies` /
 *    `overrides` pins the exact tested version. `engines.dsh` is declared as
 *    `>=` the pin and is the primary runtime compatibility gate (harness
 *    `evaluatePluginCompatibility` evaluates `engines.dsh` first).
 *    `peerDependencies` is declared as `>=` the pin for package manager
 *    resolution and peer checking.
 *    No caret ranges, no dual arms. The exact `devDependencies` line is the
 *    source of truth; every other form is written from it. The tracked
 *    `package-lock.json` resolves the pinned packages.
 *
 * 2. **The artifacts.** Upstream packages resolve through
 *    `node_modules/@deepseek-ai/*`, which `scripts/link-local-harness.mjs`
 *    symlinks at the sibling `../deepseek-harness` checkout (AGENTS.md).
 *    TypeScript reads that checkout's built `lib/types/*.d.ts`, and a `git pull`
 *    does not regenerate it: a stale build would silently typecheck this repo
 *    against an older interface than the one it runs on.
 *
 *    The check verifies both declarations against source, and prebuilt
 *    browser bundles (`lib/client.js`) against their client declarations,
 *    ensuring runtime bundles stay synchronized with declared types.
 *
 * 3. **The vendored packages.** `@deepseek-ai/cordis`, `-cosmokit`,
 *    `-schemastery`, `-cordis-plugin-loader`, and `-cordis-plugin-include`
 *    are published from the sibling's `vendor/` tree and version
 *    independently of the harness release, so the pin does not cover them.
 *    Only the floor of the declared range is compared, against the version the
 *    sibling actually ships: an alpha floor resolves to a different copy than
 *    the one the running shell loads, and a duplicate Cordis instance splits
 *    state across two module tables. The floor agreement is only expressible
 *    in `dependencies` / `devDependencies` / `peerDependencies`, so an
 *    `overrides` entry naming a vendored package is refused outright — every
 *    other check skips non-`dsh-*` names, and nothing else would catch it.
 *
 * Usage:
 *   node scripts/harness-state.mjs                 # check every fact, then exit
 *   node scripts/harness-state.mjs --strict        # stale declarations fail too
 *   node scripts/harness-state.mjs --write <ver>   # move the pin, then re-check
 *   # --write leaves package-lock.json behind: npm install --package-lock-only
 * @module scripts/harness-state
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { minVersion, validRange } from 'semver'
import { collectHarnessPackages } from './shared/harness-packages.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harnessRoot = resolve(process.env.DSH_HARNESS_ROOT ?? join(root, '../deepseek-harness'))
const pkgPath = join(root, 'package.json')
const readmePaths = ['README.md', 'README.en.md'].map((name) => join(root, name))
const agentsPath = join(root, 'AGENTS.md')
/** User-facing docs that restate the pin alongside the READMEs. */
const docPaths = ['docs/getting-started.md', 'docs/getting-started.en.md'].map((name) =>
  join(root, name),
)
/** Contract-baseline notes that cite the pin in prose. */
const architecturePaths = ['docs/architecture.md', 'docs/architecture.en.md'].map((name) =>
  join(root, name),
)
/** Files whose prose restates the pin. */
const prosePaths = [...readmePaths, ...docPaths, ...architecturePaths, agentsPath]
/** Manifest sections whose every `@deepseek-ai/dsh-*` entry must equal the pin exactly. */
const EXACT_VERSION_SECTIONS = ['dependencies', 'devDependencies', 'overrides']
/** All manifest sections that carry `@deepseek-ai/dsh-*` entries. */
const VERSION_SECTIONS = [...EXACT_VERSION_SECTIONS, 'peerDependencies']
/** Manifest sections whose `@deepseek-ai/*` entries may name a sibling vendor package. */
const VENDOR_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies']
/** Source roots scanned for the upstream imports whose artifacts must be fresh. */
const SCAN_ROOTS = ['src', 'tests']
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
/**
 * Prose forms of the current pin. Badges are exact (`badge/dsh-0.1.7--rc.1-blue`);
 * prose allows an optional `>=` prefix before the version.
 */
export const PROSE_VERSION_PATTERNS = [
  // Exact badge first so `dsh-0.1.7--rc.1-blue` never yields a bare `0.1.7`.
  /badge\/dsh-(\d+\.\d+\.\d+(?:--[0-9A-Za-z.]+)?)-blue/g,
  /dsh[- ]\s*(?:[≥>=]+\s*)?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)*)(?!-)/gi,
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
  // The bare prose rewrite is boundary-bounded, not a raw `replaceAll`: the
  // old pin must not be rewritten where it is the tail of an unrelated longer
  // number (`10.2.0-rc.2` contains `0.2.0-rc.2`), so a digit or dot may not
  // precede the match, while a `v`/`dsh-` prefix still may. Nor may it stop
  // inside a longer prerelease (`0.2.0-rc.2-beta`), so a letter, digit, or
  // dash may not follow it.
  const escaped = previous.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const bounded = new RegExp(`(?<![0-9.])${escaped}(?![0-9A-Za-z-])`, 'g')
  const move = (line) =>
    line
      // Exact badge first (encoded prerelease uses `--`).
      .replaceAll(`dsh-${encodeBadgeVersion(previous)}-blue`, exactBadge)
      // Migrate a legacy `>=` badge to the exact current form in one step.
      .replaceAll(`%3E%3D${encodeBadgeVersion(previous)}-blue`, `${encodeBadgeVersion(next)}-blue`)
      .replace(bounded, next)
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
export function checkProseText(text, pin, path = 'doc.md') {
  const fileProblems = []
  const displayPath = isAbsolute(path) ? relative(root, path) : path
  const lines = text.split('\n')
  const { start, end } = versionMapBounds(lines)
  const prose = lines.filter((_, i) => i < start || i >= end).join('\n')
  for (const match of prose.matchAll(LEGACY_GTE_BADGE)) {
    fileProblems.push(
      `${displayPath} still carries a ">= ${decodeBadgeVersion(match[1])}" badge;` +
        ` the current form is the exact badge "dsh ${pin}"`,
    )
  }
  const found = new Set()
  for (const pattern of PROSE_VERSION_PATTERNS) {
    for (const match of prose.matchAll(pattern)) found.add(decodeBadgeVersion(match[1]))
  }
  if (found.size === 0) {
    fileProblems.push(`${displayPath} states no harness version; name the verified pin`)
    return fileProblems
  }
  for (const version of found) {
    if (version !== pin) {
      fileProblems.push(
        `${displayPath} still states harness version "${version}" (the pin is "${pin}")`,
      )
    }
  }
  return fileProblems
}

function checkProse(path, pin) {
  const text = readFileSync(path, 'utf8')
  problems.push(...checkProseText(text, pin, path))
}

const NODE_MODULES_MARKER = 'node_modules/'

/**
 * Extracts the package name from a package-lock.json path key.
 * Handles nested node_modules (e.g. `node_modules/a/node_modules/b` -> `b`).
 * Returns undefined for paths outside node_modules, such as the root `""` or a workspace package.
 *
 * @param {string} path
 * @returns {string | undefined}
 */
export function packageNameFromLockPath(path) {
  const index = path.lastIndexOf(NODE_MODULES_MARKER)
  if (index === -1) return undefined
  return path.slice(index + NODE_MODULES_MARKER.length)
}

/** Every problem in a lockfile relative to the pin, the manifest's overrides and the manifest's dsh declarations. */
export function collectLockProblems(lock, manifest, pin) {
  const problems = []
  const dshLockEntries = []
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    const name = packageNameFromLockPath(path)
    if (name !== undefined && isDshPackage(name)) {
      dshLockEntries.push({ name, version: entry.version })
    }
  }

  const offenders = dshLockEntries
    .filter(({ version }) => version !== pin)
    .map(({ name, version }) => `${name}@${version}`)
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
    const lockDshPackages = [...new Set(dshLockEntries.map(({ name }) => name))].sort()
    const missingOverrides = lockDshPackages.filter((name) => !overrideKeys.has(name))
    if (missingOverrides.length > 0) {
      problems.push(
        `package.json overrides is missing ${missingOverrides.length} @deepseek-ai/dsh-* package(s) from lockfile:` +
          ` ${missingOverrides.join(', ')} — add them to overrides and run: npm install --package-lock-only`,
      )
    }

    const declaredDsh = new Set(
      VERSION_SECTIONS.flatMap((section) =>
        Object.keys(manifest[section] ?? {}).filter(isDshPackage),
      ),
    )
    const missingFromLock = [...declaredDsh]
      .filter((name) => !Object.hasOwn(lock.packages ?? {}, `node_modules/${name}`))
      .sort()
    if (missingFromLock.length > 0) {
      problems.push(
        `package-lock.json is missing ${missingFromLock.length} @deepseek-ai/dsh-* package(s) the manifest declares:` +
          ` ${missingFromLock.join(', ')} — run: npm install --package-lock-only`,
      )
    }

    const rootEntry = (lock.packages ?? {})['']
    if (rootEntry !== undefined) {
      for (const section of ['devDependencies', 'peerDependencies']) {
        const manifestKeys = new Set(Object.keys(manifest[section] ?? {}).filter(isDshPackage))
        const lockKeys = new Set(Object.keys(rootEntry[section] ?? {}).filter(isDshPackage))
        const missing = [...manifestKeys].filter((name) => !lockKeys.has(name)).sort()
        const extra = [...lockKeys].filter((name) => !manifestKeys.has(name)).sort()
        if (missing.length === 0 && extra.length === 0) continue
        const sides = []
        if (missing.length > 0) sides.push(`missing ${missing.join(', ')}`)
        if (extra.length > 0) sides.push(`extra ${extra.join(', ')}`)
        problems.push(
          `package-lock.json root entry ${section} drifts from package.json (${sides.join('; ')})` +
            ' — run: npm install --package-lock-only',
        )
      }
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

/**
 * Whether a declared compatibility face is >= the exact pin.
 * @param value - the declared string.
 * @param pin - the exact pin.
 * @returns true when the value is >=pin.
 */
function isGtePinFace(value, pin) {
  return value === `>=${pin}`
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

/** Human-readable reason a compatibility face is not >= the exact pin. */
function gtePinProblem(section, name, value, pin) {
  const where = name === undefined ? section : `${section}["${name}"]`
  const expected = `>=${pin}`
  if (typeof value !== 'string' || value.length === 0) {
    return `${where} is missing; expected "${expected}"`
  }
  if (value.includes('||') || /^[~^]|^<| - /.test(value)) {
    return `${where} is "${value}"; expected "${expected}" (no caret ranges, no dual arms)`
  }
  return `${where} is "${value}", expected "${expected}"`
}

/**
 * Every harness-face problem in a manifest relative to one exact pin.
 * Pure: used by `checkPin` and unit-tested without the CLI side effects.
 * @param manifest - parsed package.json.
 * @param pin - the exact pin every face must equal.
 * @returns human-readable problems; empty when every face satisfies its rule.
 */
export function collectPinFaceProblems(manifest, pin) {
  const found = []
  const peers = Object.keys(manifest.peerDependencies ?? {}).filter(isDshPackage)
  // Harness evaluatePluginCompatibility evaluates engines.dsh first, but peerDependencies
  // remains required for npm peer checking and package manager resolution: zero dsh
  // peers would degrade dependency resolution.
  if (peers.length === 0) {
    found.push(
      'peerDependencies declares no @deepseek-ai/dsh-* entry;' +
        ' at least one dsh peer is required so package managers check peer compatibility',
    )
  }
  for (const section of EXACT_VERSION_SECTIONS) {
    for (const [name, version] of Object.entries(manifest[section] ?? {})) {
      if (!isDshPackage(name)) continue
      if (!isExactPinFace(version, pin)) {
        found.push(exactPinProblem(section, name, version, pin))
      }
    }
  }
  for (const [name, version] of Object.entries(manifest.peerDependencies ?? {})) {
    if (!isDshPackage(name)) continue
    if (!isGtePinFace(version, pin)) {
      found.push(gtePinProblem('peerDependencies', name, version, pin))
    }
  }
  const clientInjects = manifest.dsh?.client?.inject ?? []
  for (const pkg of clientInjects) {
    if (isDshPackage(pkg) && !Object.hasOwn(manifest.peerDependencies ?? {}, pkg)) {
      found.push(`peerDependencies is missing "${pkg}" declared in dsh.client.inject`)
    }
  }
  if (!isGtePinFace(manifest.engines?.dsh, pin)) {
    found.push(gtePinProblem('engines.dsh', undefined, manifest.engines?.dsh, pin))
  }
  if (manifest.dsh?.harnessRange !== undefined) {
    // Self-invented face: the runtime never read it and it was removed on
    // purpose: the same rot guard as the retired dshWorkshop block.
    found.push(
      'package.json still carries dsh.harnessRange; harness never read it and it was' +
        ' removed — delete the field',
    )
  }
  return found
}

/** Check every derived form of the pin against the source of truth. */
function checkPin(manifest, packages) {
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
  checkOverrideNames(manifest, packages)
  return pin
}

/**
 * Whether a sibling package directory lives under the monorepo's `vendor/`
 * tree. That tree is the only part of the sibling that publishes framework
 * packages outside the `@deepseek-ai/dsh-*` release line, so it is what makes
 * a `@deepseek-ai/*` dependency a *vendored* one rather than a harness package
 * this pin already covers.
 * @param harnessRoot - the sibling harness checkout root.
 * @param dir - the package's directory as `collectHarnessPackages` reports it.
 * @returns true when the directory sits under `<harnessRoot>/vendor`.
 */
function isVendoredPackage(harnessRoot, dir) {
  const prefix = join(harnessRoot, 'vendor') + sep
  return dir.startsWith(prefix)
}

/**
 * The version the sibling's package declares, or undefined when its manifest
 * cannot be read. Such a package is skipped rather than reported: an unreadable
 * manifest is a broken checkout, not a version disagreement, and the artifact
 * check already fails on the declarations it cannot resolve.
 * @param dir - the package directory.
 * @returns the declared version, or undefined.
 */
function siblingVersion(dir) {
  try {
    const version = readJson(join(dir, 'package.json')).version
    return typeof version === 'string' ? version : undefined
  } catch {
    return undefined
  }
}

/**
 * Why one declared vendor dependency cannot be compared at all: a protocol
 * specifier (`link:`, `file:`, `workspace:`) is not a range, so there is no
 * floor to read and no way to tell which copy would be installed.
 * @param section - the manifest section that declares the dependency.
 * @param name - the `@deepseek-ai/*` package name.
 * @param range - the declared specifier.
 * @param installed - the version the sibling's installed copy declares.
 * @returns the human-readable problem.
 */
function nonRangeVendorProblem(section, name, range, installed) {
  return (
    `${section}["${name}"] is "${range}", which is not a semver range` +
    ` (the sibling publishes ${installed}); declare a range whose floor is that exact version`
  )
}

/**
 * Why one vendored framework package may not appear in `overrides`.
 *
 * An override rewrites what the lockfile resolves, so it can point a vendored
 * package at a copy the running shell does not load — the duplicate-Cordis
 * failure this whole check exists to prevent. The version agreement is only
 * expressible through the three declaration sections (their floor is what the
 * lockfile resolves from), so an override is refused outright rather than
 * checked for a floor it cannot have.
 * @param name - the `@deepseek-ai/*` package name.
 * @returns the human-readable problem.
 */
function overriddenVendorProblem(name) {
  return (
    `overrides["${name}"] pins a vendored framework package; drop the override` +
    ` and declare the range in dependencies / devDependencies / peerDependencies` +
    ` instead, whose floor is the version the lockfile resolves and this check verifies`
  )
}

/**
 * Every vendored framework dependency whose declared floor is not the version
 * the sibling checkout actually carries.
 *
 * These packages version independently of the harness release, so the pin does
 * not cover them and nothing else gates them. A declared `^4.0.5-alpha.2`
 * floor resolves to `4.0.5-alpha.2` and keeps a prerelease in the lockfile even
 * after upstream ships `4.0.5`; the profile then loads two copies of Cordis
 * and their contexts stop being the same object. Comparing the floor (not the
 * range) is what makes the check exact: `^4.0.5` and `4.0.5` resolve to the
 * same copy and both pass, while any prerelease floor fails.
 *
 * A missing sibling checkout is not a failure: nothing was installed to compare
 * against, and the day-to-day build works from the registry copy. That absence
 * is already announced once per run by `checkArtifacts`, so this returns an
 * empty list rather than a second note; the function stays pure so the unit
 * tests can drive it without the module's shared diagnostics.
 * @param harnessRoot - the sibling harness checkout root.
 * @param manifest - parsed package.json.
 * @param packages - optional pre-collected harness package map.
 * @returns human-readable problems; empty when every vendored dependency agrees.
 */
export function collectVendorProblems(harnessRoot, manifest, packages) {
  const found = []
  if (!existsSync(harnessRoot)) return found
  const resolvedPackages = packages ?? collectHarnessPackages(harnessRoot)
  if (resolvedPackages.size === 0) return found
  for (const section of VENDOR_SECTIONS) {
    for (const [name, range] of Object.entries(manifest[section] ?? {})) {
      if (!name.startsWith('@deepseek-ai/') || isDshPackage(name)) continue
      const dir = resolvedPackages.get(name)
      if (dir === undefined || !isVendoredPackage(harnessRoot, dir)) continue
      const installed = siblingVersion(dir)
      if (installed === undefined) continue
      const floor = validRange(range) === null ? null : minVersion(range)
      if (floor === null) {
        found.push(nonRangeVendorProblem(section, name, range, installed))
        continue
      }
      if (floor.version === installed) continue
      found.push(
        `${section}["${name}"] is "${range}", whose floor is ${floor.version}, but the sibling` +
          ` publishes ${installed}; declare a range whose floor is that exact version` +
          ` (e.g. "^${installed}") so the lockfile resolves the copy the shell loads`,
      )
    }
  }
  // The `overrides` arm is separate from the floor comparison: an override
  // cannot express the floor agreement at all, so any vendored package there is
  // a problem regardless of what it pins. The other checks (pin face, lock,
  // override names) all skip non-`dsh-*` names, so without this arm an
  // overridden vendor package would pass every gate silently.
  for (const name of Object.keys(manifest.overrides ?? {})) {
    if (!name.startsWith('@deepseek-ai/') || isDshPackage(name)) continue
    const dir = resolvedPackages.get(name)
    if (dir === undefined || !isVendoredPackage(harnessRoot, dir)) continue
    found.push(overriddenVendorProblem(name))
  }
  return found
}

/**
 * Report override / peer / dev keys that name a package the sibling monorepo
 * no longer carries (upstream renames such as `dsh-code-runtime` →
 * `dsh-ptc-runtime`). A stale key pins a package the tree can never pull, so
 * it is silent rot until the rename's real name is missing from overrides.
 */
function checkOverrideNames(manifest, packages) {
  const known =
    packages ?? (existsSync(harnessRoot) ? collectHarnessPackages(harnessRoot) : new Map())
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
 * Resolves the browser runtime file for a package from its `./client` export.
 * @param pkgDir - installed package directory.
 * @returns absolute client runtime path, or undefined when absent.
 */
function clientRuntimeOf(pkgDir) {
  const manifest = readJson(join(pkgDir, 'package.json'))
  const entry = manifest.exports?.['./client']
  const runtime = typeof entry === 'string' ? entry : entry?.default
  if (typeof runtime !== 'string') return undefined
  const path = join(pkgDir, runtime)
  return existsSync(path) ? path : undefined
}

/**
 * Classifies imported upstream specifiers against installed artifacts in the
 * sibling checkout across two axes:
 * 1. Declarations vs src: whether generated types reflect the latest source.
 * 2. Client runtime vs declarations: whether prebuilt browser bundles are up to
 *    date with their client declarations.
 * @param harnessRoot - the sibling harness checkout root.
 * @param specifiers - upstream specifiers imported by this repository.
 * @param packages - optional pre-collected harness package map.
 * @returns categorized findings.
 */
export function collectArtifactProblems(harnessRoot, specifiers, packages) {
  const resolvedPackages = packages ?? collectHarnessPackages(harnessRoot)
  const stale = []
  const staleRuntime = []
  const missing = []
  const outside = []
  const sourceMtimeCache = new Map()
  const checkedClientPackages = new Set()
  for (const specifier of specifiers) {
    const name = specifier.split('/').slice(0, 2).join('/')
    const pkgDir = resolvedPackages.get(name)
    if (pkgDir === undefined) {
      outside.push(specifier)
      continue
    }
    // The declaration the compiler resolves for *this* specifier: it decides
    // whether the import the plugin actually writes is backed by fresh types.
    const declaration = declarationOf(pkgDir, specifier)
    if (declaration === undefined || !existsSync(declaration)) {
      missing.push(specifier)
      continue
    }
    const declarationMtime = statSync(declaration).mtimeMs
    // Cache the walk even when it finds nothing: a package whose `src/` is
    // absent stores `undefined`, and a `.get() === undefined` probe alone
    // would re-walk it for every specifier the plugin imports from it.
    if (!sourceMtimeCache.has(pkgDir)) {
      sourceMtimeCache.set(pkgDir, newestMtime(join(pkgDir, 'src')))
    }
    const sourceNewest = sourceMtimeCache.get(pkgDir)
    if (sourceNewest !== undefined && declarationMtime < sourceNewest) stale.push(specifier)
    // The browser arm answers the package, not the specifier, so report it once
    // however many of the package's faces this plugin imports. Its freshness is
    // judged against its own declarations (the client arm's), which is the pair
    // the page and the compiler respectively consume.
    if (!checkedClientPackages.has(name)) {
      checkedClientPackages.add(name)
      const runtime = clientRuntimeOf(pkgDir)
      if (runtime !== undefined) {
        const clientDeclaration = declarationOf(pkgDir, `${name}/client`)
        if (clientDeclaration !== undefined && existsSync(clientDeclaration)) {
          if (statSync(runtime).mtimeMs < statSync(clientDeclaration).mtimeMs) {
            staleRuntime.push({ name, runtime: relative(harnessRoot, runtime) })
          }
        }
      }
    }
  }
  return { stale, staleRuntime, missing, outside }
}

/**
 * Verify every imported upstream package's installed artifacts are current.
 *
 * Missing declarations are always a failure (typecheck cannot resolve them);
 * stale ones fail only under `--strict`: a stale sibling build weakens the
 * guarantee without blocking day-to-day work, and the release path is where the
 * guarantee has to hold.
 * @param strict - treat stale artifacts as a failure.
 * @param packages - optional pre-collected harness package map.
 */
function checkArtifacts(strict, packages) {
  if (!existsSync(harnessRoot)) {
    notes.push('sibling harness absent: upstream types come from the installed packages as-is')
    return
  }
  const { stale, staleRuntime, missing, outside } = collectArtifactProblems(
    harnessRoot,
    importedSpecifiers(),
    packages,
  )
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
  if (staleRuntime.length > 0) {
    const detail =
      `${staleRuntime.length} imported upstream package(s) have a browser runtime older than their` +
      ` client declarations (${staleRuntime.map((entry) => `${entry.name} -> ${entry.runtime}`).join(', ')});` +
      ' rebuild with: pnpm --dir ../deepseek-harness run build:lib:client'
    if (strict) problems.push(detail)
    else notes.push(detail)
  }
  if (outside.length > 0) {
    notes.push(`${outside.length} specifier(s) resolve outside the sibling: ${outside.join(', ')}`)
  }
}

/**
 * Rewrite every harness face of a manifest to the pin. Mutates
 * `manifest` in place. Dev and overrides take the exact pin; peers
 * and engines become >=pin. The manifest carries no other derived
 * face: `dsh.harnessRange` was a self-invented field the runtime never
 * read. Do not reintroduce it.
 * @param manifest - parsed package.json (mutated in place).
 * @param version - the exact new pin.
 * @returns the same manifest for chaining/tests.
 */
export function applyPinToManifest(manifest, version) {
  for (const section of EXACT_VERSION_SECTIONS) {
    for (const name of Object.keys(manifest[section] ?? {})) {
      if (isDshPackage(name)) manifest[section][name] = version
    }
  }
  for (const name of Object.keys(manifest.peerDependencies ?? {})) {
    if (isDshPackage(name)) manifest.peerDependencies[name] = `>=${version}`
  }
  manifest.engines = { ...manifest.engines, dsh: `>=${version}` }
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
  const manifest = readJson(pkgPath)
  const packages = existsSync(harnessRoot) ? collectHarnessPackages(harnessRoot) : new Map()
  const pin = checkPin(manifest, packages)
  // Vendored framework packages version independently of the pin, so no other
  // face covers them. A mismatch loads a second Cordis instance into the
  // profile, which is a hard failure in both modes: unlike a stale sibling
  // build, there is nothing here that only the release path has to prove.
  problems.push(...collectVendorProblems(harnessRoot, manifest, packages))
  checkArtifacts(strict, packages)
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
