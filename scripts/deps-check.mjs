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
import { diff, gt, valid } from 'semver'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))

/** Registry lookups run in parallel; the packuments are small. */
const CONCURRENCY = 8
const TIMEOUT_MS = 15_000
const LEVELS = ['major', 'minor', 'patch']

/** Runtime dependencies owned by the sibling harness; never bumped here. */
const HARNESS_MIRRORED = new Set([
  '@lexical/headless',
  '@lexical/history',
  '@lexical/plain-text',
  '@lexical/text',
  '@lexical/utils',
  '@shikijs/langs',
  '@tanstack/react-virtual',
  '@types/react',
  'anser',
  'clsx',
  'diff',
  'fast-xml-parser',
  'immer',
  'katex',
  'lexical',
  'mdast-util-from-markdown',
  'mdast-util-gfm',
  'mdast-util-math',
  'micromark-core-commonmark',
  'micromark-extension-gfm',
  'micromark-extension-math',
  'micromark-factory-space',
  'micromark-util-character',
  'micromark-util-classify-character',
  'micromark-util-sanitize-uri',
  'micromark-util-symbol',
  'micromark-util-types',
  'react',
  'react-dom',
  'shiki',
  'simple-icons',
  'use-sync-external-store',
  'zod',
  'zustand',
])

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

async function latestVersion(registry, name) {
  const response = await fetch(`${registry}/${name.replace('/', '%2F')}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const packument = await response.json()
  const latest = packument['dist-tags']?.latest
  if (!valid(latest)) throw new Error('packument carries no valid dist-tags.latest')
  return latest
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

const targets = Object.keys(manifest.dependencies ?? {})
  .concat(Object.keys(manifest.devDependencies ?? {}))
  .filter(
    (name) =>
      !name.startsWith('@deepseek-ai/') && !HARNESS_MIRRORED.has(name) && installedVersion(name),
  )

const registry = registryBase()
const lookups = await mapLimit(targets, CONCURRENCY, async (name) => {
  const current = installedVersion(name)
  try {
    return { name, current, latest: await latestVersion(registry, name) }
  } catch (error) {
    return { name, current, error: error instanceof Error ? error.message : String(error) }
  }
})

const failures = lookups.filter((lookup) => lookup.error !== undefined)
const rows = lookups
  .filter((lookup) => lookup.error === undefined && gt(lookup.latest, lookup.current))
  .map((lookup) => ({
    ...lookup,
    range: declaredRange(lookup.name),
    level: (diff(lookup.current, lookup.latest) ?? 'patch').replace(/^pre/, ''),
  }))
  .sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || a.name.localeCompare(b.name))

for (const failure of failures)
  console.error(`deps-check: ${failure.name} could not be checked (${failure.error})`)

if (rows.length === 0) console.log('deps-check: direct dependencies are current')
else {
  console.log(`deps-check: ${rows.length} direct dependencies behind the registry`)
  const width = Math.max(...rows.map((row) => row.name.length))
  for (const row of rows) {
    console.log(
      `  ${row.level.padEnd(5)} ${row.name.padEnd(width)} ${row.current} -> ${row.latest}  (${row.range})`,
    )
  }
  console.log('run npm install for in-range bumps; major bumps need a review')
}

if (failures.length > 0) process.exitCode = 2
else if (rows.length > 0) process.exitCode = 1
