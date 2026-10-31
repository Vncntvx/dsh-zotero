/**
 * Regenerate the style-token snapshot the client style guard checks against.
 *
 * The browser half of this plugin owns no tokens: `ui-theme` publishes
 * `--dsw-*` (static palette, semantic aliases, typography, elevation, radius),
 * and feature CSS only consumes them. That contract is only enforceable
 * against a list of names, and the list lives upstream, so it is snapshotted
 * into `tests/fixtures/style-tokens.json` instead of being read at test time:
 * CI has no sibling checkout, and a missing list would turn the guard into a
 * no-op.
 *
 * The snapshot carries three facts:
 *
 * 1. `harness` — the pinned harness version the names were read from, so a
 *    version bump without a refresh fails the guard instead of silently
 *    validating against a stale palette.
 * 2. `dsw` — every `--dsw-*` the theme sheets define. Generated here.
 * 3. `dsh` — the runtime user-preference seams this plugin consumes. Host
 *    published, not statically defined, so hand-maintained: `--write` carries
 *    it over untouched. An entry is added deliberately, together with the host
 *    code that publishes it.
 *
 * Usage:
 *
 *   node scripts/style-tokens.mjs           # check the snapshot against upstream
 *   node scripts/style-tokens.mjs --write   # rewrite the `dsw` half
 *
 * `DSH_THEME_DIR` overrides the theme sheet directory for a non-sibling
 * checkout. A missing directory fails the check rather than writing an empty
 * snapshot: an empty allowlist would reject every token at once.
 * @module dsh-zotero/scripts/style-tokens
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = join(root, 'tests', 'fixtures', 'style-tokens.json')
const manifest = join(root, 'package.json')
const defaultThemeDir = join(
  root,
  '..',
  'deepseek-harness',
  'packages',
  'client',
  'ui-theme',
  'src',
  'styles',
)

/**
 * The harness version the snapshot describes: the exact pin on the client
 * primitives, which is also the pin `scripts/harness-state.mjs` enforces for
 * every other `@deepseek-ai/dsh-*` line.
 * @param pkg - parsed `package.json`.
 * @returns the pinned version, or `''` when the line is absent.
 */
export function pinnedHarness(pkg) {
  return (
    pkg?.dependencies?.['@deepseek-ai/dsh-client-ui-theme'] ??
    pkg?.devDependencies?.['@deepseek-ai/dsh-client-ui-theme'] ??
    pkg?.dependencies?.['@deepseek-ai/dsh-client-ui-primitives'] ??
    pkg?.devDependencies?.['@deepseek-ai/dsh-client-ui-primitives'] ??
    ''
  )
}

/**
 * Every `--dsw-*` custom property a stylesheet defines.
 *
 * Commented-out definitions are not definitions: the sheets carry retired
 * tokens behind `/* … *\/` in a few places, and a name that only survives in a
 * comment would widen the allowlist for a token nothing publishes.
 * @param css - stylesheet source.
 * @returns the token names, `--` prefix included.
 */
export function collectThemeTokens(css) {
  const live = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  return [...live.matchAll(/(--dsw-[a-z0-9-]+)\s*:/g)].map((match) => match[1])
}

/**
 * The sorted, de-duplicated token list across a directory of stylesheets.
 * @param read - one sheet's source by file name.
 * @param files - sheet file names.
 * @returns every token the theme defines.
 */
export function mergeThemeTokens(read, files) {
  const tokens = new Set()
  for (const file of files) for (const token of collectThemeTokens(read(file))) tokens.add(token)
  return [...tokens].sort()
}

/**
 * Compare the snapshot with upstream.
 * @param snapshotTokens - the committed list.
 * @param upstreamTokens - the list read from the theme sheets.
 * @returns missing and extra names, both empty when they agree.
 */
export function diffTokens(snapshotTokens, upstreamTokens) {
  const committed = new Set(snapshotTokens)
  const upstream = new Set(upstreamTokens)
  return {
    missing: [...upstream].filter((token) => !committed.has(token)).sort(),
    removed: [...committed].filter((token) => !upstream.has(token)).sort(),
  }
}

/**
 * The snapshot to write: the freshly read palette, the pin it was read under,
 * and the hand-maintained seam list carried over from the current file.
 * @param current - the committed snapshot, absent on first write.
 * @param facts - the pin and the freshly read palette.
 * @returns the snapshot object, keys in a stable order.
 */
export function snapshotOf(current, { harness, dsw }) {
  return { harness, dsw, dsh: [...(current?.dsh ?? [])] }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const themeDir = process.env.DSH_THEME_DIR ?? defaultThemeDir
  let files
  try {
    files = readdirSync(themeDir)
      .filter((name) => name.endsWith('.css'))
      .sort()
  } catch {
    console.error(`style-tokens: no theme sheets at ${themeDir}`)
    process.exit(1)
  }
  const harness = pinnedHarness(JSON.parse(readFileSync(manifest, 'utf8')))
  const dsw = mergeThemeTokens((name) => readFileSync(join(themeDir, name), 'utf8'), files)
  const current = (() => {
    try {
      return JSON.parse(readFileSync(fixture, 'utf8'))
    } catch {
      return undefined
    }
  })()
  if (process.argv.includes('--write')) {
    writeFileSync(fixture, `${JSON.stringify(snapshotOf(current, { harness, dsw }), null, 2)}\n`)
    console.log(`style-tokens: wrote ${dsw.length} tokens from ${files.length} sheets`)
  } else {
    const problems = []
    if (current === undefined)
      problems.push('no snapshot; run node scripts/style-tokens.mjs --write')
    else {
      if (current.harness !== harness) {
        problems.push(`snapshot describes harness ${current.harness}, the pin is ${harness}`)
      }
      const { missing, removed } = diffTokens(current.dsw ?? [], dsw)
      if (missing.length > 0)
        problems.push(`${missing.length} token(s) not in the snapshot: ${missing.join(', ')}`)
      if (removed.length > 0)
        problems.push(`${removed.length} token(s) gone upstream: ${removed.join(', ')}`)
    }
    if (problems.length > 0) {
      for (const problem of problems) console.error(`style-tokens: ${problem}`)
      console.error('style-tokens: run node scripts/style-tokens.mjs --write')
      process.exit(1)
    }
    console.log(`style-tokens ok: ${dsw.length} tokens, harness ${harness}`)
  }
}
