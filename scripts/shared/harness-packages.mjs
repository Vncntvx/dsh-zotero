/**
 * The sibling monorepo's package enumerator, shared by the pin keeper and the
 * local link bootstrap so the two can never disagree about which
 * `@deepseek-ai/*` packages the harness tree carries.
 * @module scripts/shared/harness-packages
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

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
 * Every `@deepseek-ai/*` package the sibling monorepo publishes from its
 * `packages/` and `vendor/` trees (flat vendor packages plus nested package
 * trees). A missing, malformed, or foreign manifest counts as "no name" and
 * the walk descends into the directory rather than failing.
 * @param harnessRoot - the sibling checkout root.
 * @returns the name → directory map.
 */
export function collectHarnessPackages(harnessRoot) {
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
