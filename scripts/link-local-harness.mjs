/**
 * Point `node_modules/@deepseek-ai/*` at the sibling deepseek-harness checkout
 * when that package exists there. Registry publishes lag the sibling tip, so
 * a pin-only install cannot satisfy a freshly bumped harness version.
 *
 * Symlinks reuse the harness package's own `node_modules` for `workspace:`
 * peer resolution (pnpm layout), which plain `file:` installs cannot do.
 * Packages the sibling does not carry stay as the ordinary registry install.
 * Declared peers/devDeps that the registry never installed are linked too, so
 * a missing unpublished pin can bootstrap without a successful `npm install`.
 *
 * Usage: node scripts/link-local-harness.mjs [--check]
 *   --check  report ok/relink/link without mutating node_modules
 * @module scripts/link-local-harness
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harnessRoot = resolve(root, '../deepseek-harness')
const nmScope = join(root, 'node_modules', '@deepseek-ai')
const checkOnly = process.argv.includes('--check')

/** Read a directory's package.json scoped name, or undefined when absent/unreadable. */
function packageNameOf(dir) {
  const manifest = join(dir, 'package.json')
  try {
    const parsed = JSON.parse(readFileSync(manifest, 'utf8'))
    return typeof parsed.name === 'string' && parsed.name.startsWith('@deepseek-ai/')
      ? parsed.name
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Every `@deepseek-ai/*` package the sibling monorepo publishes from
 * packages/ and vendor/ (flat vendor packages plus nested package trees).
 */
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
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const child = join(dir, entry.name)
      if (!entry.isDirectory()) continue
      const name = packageNameOf(child)
      if (name !== undefined) {
        map.set(name, child)
        continue
      }
      walk(child)
    }
  }
  walk(join(harnessRoot, 'packages'))
  walk(join(harnessRoot, 'vendor'))
  return map
}

/** Short names already present under node_modules/@deepseek-ai, plus declared pins. */
function targetShortNames() {
  const names = new Set()
  try {
    for (const short of readdirSync(nmScope)) names.add(short)
  } catch {
    // Bootstrap path: nmScope may not exist yet.
  }
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  for (const section of ['peerDependencies', 'devDependencies', 'dependencies']) {
    for (const key of Object.keys(manifest[section] ?? {})) {
      if (key.startsWith('@deepseek-ai/')) names.add(key.slice('@deepseek-ai/'.length))
    }
  }
  return [...names].sort()
}

/**
 * Whether `dest` is a leftover local symlink to a non-package (upstream rename
 * or a directory that dropped its `package.json`). A registry install is a
 * real directory and is never pruned.
 * @param dest - `node_modules/@deepseek-ai/<short>` path.
 * @returns true when the entry is a stale local link.
 */
function isStaleLocalLink(dest) {
  try {
    const stat = lstatSync(dest)
    if (!stat.isSymbolicLink()) return false
    const target = resolve(dirname(dest), readlinkSync(dest))
    return !existsSync(join(target, 'package.json'))
  } catch {
    return false
  }
}

/**
 * Relink one package. Skips when the destination already points at source.
 * @returns 'ok' | 'relink' | 'link'
 */
function linkOne(name, source) {
  const dest = join(nmScope, name)
  const rel = relative(nmScope, source)
  let kind = 'link'
  try {
    const stat = lstatSync(dest)
    if (stat.isSymbolicLink() && readlinkSync(dest) === rel) {
      if (checkOnly) console.log(`ok     @deepseek-ai/${name}`)
      return 'ok'
    }
    kind = 'relink'
  } catch {
    // Dest missing.
  }
  if (checkOnly) {
    console.log(`${kind === 'relink' ? 'relink' : 'link  '} @deepseek-ai/${name} -> ${rel}`)
    return kind
  }
  mkdirSync(nmScope, { recursive: true })
  try {
    rmSync(dest, { recursive: true, force: true })
    symlinkSync(rel, dest, 'dir')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(`failed to link @deepseek-ai/${name}: ${detail}`)
    process.exitCode = 1
    return kind
  }
  return kind
}

function main() {
  if (!existsSync(harnessRoot)) {
    console.error(`sibling harness not found at ${harnessRoot}`)
    process.exit(1)
  }
  const map = harnessPackages()
  let ok = 0
  let linked = 0
  let relinked = 0
  let kept = 0
  let pruned = 0
  for (const short of targetShortNames()) {
    const source = map.get(`@deepseek-ai/${short}`)
    if (source === undefined) {
      const dest = join(nmScope, short)
      if (isStaleLocalLink(dest)) {
        pruned += 1
        if (checkOnly) {
          console.log(`prune  @deepseek-ai/${short}`)
          continue
        }
        try {
          rmSync(dest, { recursive: true, force: true })
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error)
          console.error(`failed to prune @deepseek-ai/${short}: ${detail}`)
          process.exitCode = 1
        }
        continue
      }
      kept += 1
      if (checkOnly) console.log(`keep   @deepseek-ai/${short}`)
      continue
    }
    const kind = linkOne(short, source)
    if (kind === 'ok') ok += 1
    else if (kind === 'relink') relinked += 1
    else linked += 1
  }
  console.log(
    `local-harness link: ${ok} ok, ${linked} linked, ${relinked} relinked, ${pruned} pruned stale, ${kept} kept from registry`,
  )
}

main()
