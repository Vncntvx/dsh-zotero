/**
 * Report direct dependencies that are behind the registry.
 *
 * Dependabot opens no version-update pull requests, so this report is the
 * routine upgrade signal. It hides the two families this repo upgrades by hand
 * to keep them out of the number:
 *
 * 1. `@deepseek-ai/*` moves through `npm run harness:pin -- <ver>` and stays in
 *    lockstep with the sibling harness checkout.
 * 2. The browser bundle mirrors the third-party runtime dependencies the
 *    sibling declares in `packages/client/*`; those move with the harness pin,
 *    never on their own.
 *
 * Versions are compared against `package-lock.json`, not the installed tree:
 * `npm outdated` walks `node_modules` and reports nothing in this repo once the
 * harness packages are symlinked, so the check queries the registry directly.
 *
 * Usage:
 *   node scripts/deps-check.mjs     # 0 up to date, 1 updates available, 2 check failed
 * @module scripts/deps-check
 */

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { diff, gt, maxSatisfying, minVersion, satisfies, valid } from 'semver'
import { HARNESS_MIRRORED } from './shared/harness-mirrored-deps.mjs'
import { lockedProxyUndiciVersion } from './shared/lockfile.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))

/** Registry lookups run in parallel; the packuments are small. */
const CONCURRENCY = 8
const TIMEOUT_MS = 15_000
const LEVELS = ['major', 'minor', 'patch']

/** The declared range for a direct dependency, or undefined when it is not one. */
function declaredRange(name) {
  const range = manifest.dependencies?.[name] ?? manifest.devDependencies?.[name]
  return typeof range === 'string' ? range : undefined
}

/** Respect `.npmrc` and environment overrides instead of hardcoding npmjs. */
function registryBase() {
  try {
    const url = execFileSync('npm', ['config', 'get', 'registry'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return url.replace(/\/$/, '')
  } catch {
    return 'https://registry.npmjs.org'
  }
}

async function latestVersion(registry, name, range, constraint) {
  const response = await fetch(`${registry}/${name.replace('/', '%2F')}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const packument = await response.json()
  return registryVersionsOf(packument, range, constraint)
}

/** Report the declared range and the current stable release independently. */
export function registryVersionsOf(packument, range, constraint) {
  const versions = Object.keys(packument?.versions ?? {}).filter((version) => valid(version))
  const wanted = maxSatisfying(versions, range)
  const tag = packument?.['dist-tags']?.latest
  if (wanted === null) throw new Error(`no published version satisfies ${range}`)
  if (typeof tag !== 'string' || valid(tag) === null || !versions.includes(tag))
    throw new Error('registry metadata has no valid published latest tag')
  const latest = gt(wanted, tag) ? wanted : tag
  const eligible = constraint === undefined ? latest : maxSatisfying(versions, constraint)
  if (eligible === null) throw new Error(`no published version satisfies constraint ${constraint}`)
  return {
    wanted,
    latest,
    eligible,
    outsideRange: !satisfies(latest, range),
  }
}

function upgradeConstraint(name) {
  if (name === 'undici') {
    const version = lockedProxyUndiciVersion(lock)
    return { range: version, reason: `Harness HTTP proxy requires ${version}` }
  }
  if (name === '@types/node') {
    const node = minVersion(manifest.engines?.node ?? '')
    if (!node) throw new Error('package.json must declare a Node minimum version')
    return { range: `${node.major}.x`, reason: `Node ${node.major} runtime baseline` }
  }
}

async function mapLimit(items, limit, task) {
  const results = new Array(items.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await task(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

function installedVersion(name) {
  return lock.packages?.[`node_modules/${name}`]?.version
}

async function main() {
  const targets = Object.keys(manifest.dependencies ?? {})
    .concat(Object.keys(manifest.devDependencies ?? {}))
    .filter((name) => !name.startsWith('@deepseek-ai/') && !HARNESS_MIRRORED.has(name))

  const registry = registryBase()
  const lookups = await mapLimit(targets, CONCURRENCY, async (name) => {
    const current = installedVersion(name)
    try {
      if (!valid(current)) throw new Error('no valid version in the lockfile')
      const constraint = upgradeConstraint(name)
      return {
        name,
        current,
        constraint,
        ...(await latestVersion(registry, name, declaredRange(name), constraint?.range)),
      }
    } catch (error) {
      return { name, current, error: error instanceof Error ? error.message : String(error) }
    }
  })

  const failures = lookups.filter((lookup) => lookup.error !== undefined)
  const rows = lookups
    .filter((lookup) => lookup.error === undefined && gt(lookup.eligible, lookup.current))
    .map((lookup) => ({
      ...lookup,
      range: declaredRange(lookup.name),
      level: (diff(lookup.current, lookup.eligible) ?? 'patch').replace(/^pre/, ''),
    }))
    .sort(
      (a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || a.name.localeCompare(b.name),
    )

  for (const failure of failures)
    console.error(`deps-check: ${failure.name} could not be checked (${failure.error})`)

  if (rows.length === 0 && failures.length === 0)
    console.log('deps-check: direct dependencies are current within their constraints')
  else if (rows.length > 0) {
    console.log(`deps-check: ${rows.length} direct dependencies behind the registry`)
    const width = Math.max(...rows.map((row) => row.name.length))
    for (const row of rows) {
      console.log(
        `  ${row.level.padEnd(5)} ${row.name.padEnd(width)} ${row.current} -> ${row.eligible}  (${row.range}; wanted ${row.wanted}${satisfies(row.eligible, row.range) ? '' : '; outside range'})`,
      )
    }
    console.log(
      'Review out-of-range releases before updating the manifest; use npm install for in-range updates',
    )
  }
  for (const row of lookups) {
    if (row.error === undefined && row.constraint && gt(row.latest, row.eligible))
      console.log(
        `  constrained ${row.name} ${row.current} -> ${row.latest}  (${row.constraint.reason}; eligible ${row.eligible})`,
      )
  }

  if (failures.length > 0) process.exitCode = 2
  else if (rows.length > 0) process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
