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
 * The snapshot carries four facts:
 *
 * 1. `harness` — the pinned harness version the names were read from, so a
 *    version bump without a refresh fails the guard instead of silently
 *    validating against a stale palette.
 * 2. `dsw` — every `--dsw-*` the theme sheets define. Generated here.
 * 3. `dsh` — the runtime user-preference seams this plugin consumes. Host
 *    published, not statically defined, so hand-maintained: `--write` carries
 *    it over untouched. An entry is added deliberately, together with the host
 *    code that publishes it.
 * 4. `ds` — the host's base tokens (`--ds-*`, defined in `ui-theme/src/styles/
 *    base.css`). The motion and code-font families live here rather than in
 *    `--dsw-*`; generating them keeps `style-guard.mjs` from silently passing
 *    a misspelt `--ds-*` reference.
 *
 * Usage:
 *
 *   node scripts/style-tokens.mjs           # check the snapshot against upstream
 *   node scripts/style-tokens.mjs --write   # rewrite the `dsw` and `ds` halves
 *
 * The exact registry theme supplies source styles in CI. Linked development
 * reads the sibling pin tag. Runtime seams are checked against their explicit
 * pinned host definitions; arbitrary directories cannot supply authority.
 * @module dsh-zotero/scripts/style-tokens
 */

import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The sibling harness checkout the pin tag is read from. */
const siblingRoot = join(root, '..', 'deepseek-harness')

/** Where the theme sheets live inside the harness checkout, at every tag. */
const THEME_DIR = 'packages/client/ui-theme/src/styles'

/**
 * The theme sheets as of one pin tag, read through `git show` so the snapshot
 * always describes the pin.
 *
 * Reading the sibling's working tree is the failure this replaced: a checkout
 * ahead of the pin contributed tokens the pinned host never defines, and the
 * snapshot then claimed to describe a version it had never seen. `style-guard`
 * would allowlist names the running host does not publish, and the browser
 * falls back silently.
 * @param {(args: readonly string[]) => string} run - runs one git command and returns its stdout.
 * @param {string} harnessRoot - the sibling checkout.
 * @param {string} pin - the exact harness version.
 * @returns {{ files: string[], read: (name: string) => string }} the sheet file names, sorted, and a reader for each one.
 */
export function pinThemeSheets(run, harnessRoot, pin) {
  const listing = run(['-C', harnessRoot, 'ls-tree', '--name-only', `dsh-v${pin}:${THEME_DIR}`])
  const files = listing
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.css'))
    .sort()
  if (files.length === 0) throw new Error(`no theme sheets at dsh-v${pin}:${THEME_DIR}`)
  return {
    files,
    read: (name) => run(['-C', harnessRoot, 'show', `dsh-v${pin}:${THEME_DIR}/${name}`]),
  }
}

/**
 * The harness version the snapshot describes: the exact pin on the client
 * primitives, which is also the pin `scripts/harness-state.mjs` enforces for
 * every other `@deepseek-ai/dsh-*` line.
 * @param {{ dependencies?: Record<string, string>, devDependencies?: Record<string, string> }} [pkg] - parsed `package.json`.
 * @returns {string} the pinned version, or `''` when the line is absent.
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
 * Every custom property a stylesheet defines under one prefix.
 *
 * Commented-out definitions are not definitions: the sheets carry retired
 * tokens behind `/* … *\/` in a few places, and a name that only survives in a
 * comment would widen the allowlist for a token nothing publishes.
 * @param {string} css - stylesheet source.
 * @param {string} [prefix] - the namespace to collect, e.g. `--dsw-` or `--ds-`.
 * @returns {string[]} the token names, `--` prefix included.
 */
export function collectThemeTokens(css, prefix = '--dsw-') {
  const live = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  return [...live.matchAll(new RegExp(`(${prefix}[a-z0-9-]+)\\s*:`, 'g'))].map((match) => match[1])
}

/**
 * The sorted, de-duplicated token list across a directory of stylesheets.
 * @param {(file: string) => string} read - one sheet's source by file name.
 * @param {ReadonlyArray<string>} files - sheet file names.
 * @param {string} [prefix] - the namespace to collect.
 * @returns {string[]} every token the theme defines under that prefix.
 */
export function mergeThemeTokens(read, files, prefix = '--dsw-') {
  const tokens = new Set()
  for (const file of files)
    for (const token of collectThemeTokens(read(file), prefix)) tokens.add(token)
  return [...tokens].sort()
}

/**
 * Compare the snapshot with upstream.
 * @param {ReadonlyArray<string>} snapshotTokens - the committed list.
 * @param {ReadonlyArray<string>} upstreamTokens - the list read from the theme sheets.
 * @returns {{ missing: string[], removed: string[] }} missing and extra names, both empty when they agree.
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
 * The snapshot to write: the two generated token families, the pin they were
 * read under, and the hand-maintained seam list carried over from the current
 * file.
 * @param {{ harness?: string, dsw?: string[], dsh?: string[], ds?: string[] } | undefined} current - the committed snapshot, absent on first write.
 * @param {{ harness: string, dsw: string[], ds?: string[] }} facts - the pin and the freshly read token families.
 * @returns {{ harness: string, dsw: string[], dsh: string[], ds: string[] }} the snapshot object, keys in a stable order.
 */
export function snapshotOf(current, { harness, dsw, ds = [] }) {
  return { harness, dsw, dsh: [...(current?.dsh ?? [])], ds }
}

/**
 * CI reads the exact registry package installed from the lockfile.
 * @param {string} packageRoot
 * @param {string} pin
 * @returns {{ files: string[], read: (name: string) => string }}
 */
export function installedThemeSheets(packageRoot, pin) {
  if (lstatSync(packageRoot).isSymbolicLink())
    throw new Error('A linked theme must be read from its pin tag')
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh-client-ui-theme' || manifest.version !== pin)
    throw new Error('The installed theme does not match the harness pin')
  const directory = join(packageRoot, 'src/styles')
  const files = readdirSync(directory)
    .filter((name) => name.endsWith('.css'))
    .sort()
  if (files.length === 0) throw new Error('The installed theme has no source stylesheets')
  return { files, read: (name) => readFileSync(join(directory, name), 'utf8') }
}

/** These host definitions are the provenance of the runtime seam allowlist. */
export const RUNTIME_SEAMS = {
  '--dsh-chat-content-width': [
    'ui-conversation',
    'src/client/skeleton/ConversationRoot.module.css',
    'css',
  ],
  '--dsh-composer-height': [
    'ui-conversation',
    'src/client/skeleton/ConversationContent.tsx',
    'property',
  ],
  '--dsh-content-font-delta': ['ui-theme', 'src/styles/gradient-shadow-text.css', 'css'],
  '--dsh-content-font-size': ['ui-theme', 'src/theme-settings.ts', 'setting'],
  '--dsh-content-font-size-secondary': ['ui-theme', 'src/styles/gradient-shadow-text.css', 'css'],
  '--dsh-scrollbar-thumb': ['ui-theme', 'src/styles/scrollbar.css', 'css'],
  '--dsh-scrollbar-thumb-hover': ['ui-theme', 'src/styles/scrollbar.css', 'css'],
}

/**
 * @param {ReadonlyArray<string>} tokens
 * @param {(component: string, path: string) => string} read
 */
export function verifyRuntimeSeams(tokens, read) {
  if (JSON.stringify([...tokens].sort()) !== JSON.stringify(Object.keys(RUNTIME_SEAMS).sort()))
    throw new Error('Runtime token seams differ from their reviewed provenance')
  for (const [token, [component, path, kind]] of Object.entries(RUNTIME_SEAMS)) {
    const source = read(component, path).replace(/\/\*[\s\S]*?\*\//g, '')
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern =
      kind === 'css'
        ? `${escaped}\\s*:`
        : kind === 'setting'
          ? `variable:\\s*['"]${escaped}['"]`
          : `setProperty\\(\\s*['"]${escaped}['"]\\s*,`
    if (!new RegExp(pattern).test(source))
      throw new Error(`Runtime token ${token} is no longer defined at ${component}/${path}`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fixture = join(root, 'tests', 'fixtures', 'style-tokens.json')
  const manifest = join(root, 'package.json')
  const harness = pinnedHarness(JSON.parse(readFileSync(manifest, 'utf8')))
  if (harness === '') {
    console.error(
      'style-tokens: package.json declares no pinned client theme or primitives version',
    )
    process.exit(1)
  }
  if (process.env.DSH_THEME_DIR !== undefined)
    throw new Error(
      'DSH_THEME_DIR cannot supply token authority; use the pinned registry package or pin tag',
    )
  const installed = join(root, 'node_modules/@deepseek-ai/dsh-client-ui-theme')
  let files
  let read
  /** @type {(component: string, path: string) => string} */
  let readSeam
  if (existsSync(installed) && !lstatSync(installed).isSymbolicLink()) {
    const sheets = installedThemeSheets(installed, harness)
    files = sheets.files
    read = sheets.read
    readSeam = (component, path) => {
      const packageRoot = join(root, `node_modules/@deepseek-ai/dsh-client-${component}`)
      if (
        lstatSync(packageRoot).isSymbolicLink() ||
        JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version !== harness
      )
        throw new Error(`Runtime token provider ${component} does not match the registry pin`)
      return readFileSync(join(packageRoot, path), 'utf8')
    }
  } else {
    try {
      const sheets = pinThemeSheets(
        (args) => execFileSync('git', args, { encoding: 'utf8' }),
        siblingRoot,
        harness,
      )
      files = sheets.files
      read = sheets.read
      readSeam = (component, path) =>
        execFileSync(
          'git',
          ['-C', siblingRoot, 'show', `dsh-v${harness}:packages/client/${component}/${path}`],
          { encoding: 'utf8' },
        )
    } catch (error) {
      console.error(
        `style-tokens: cannot read dsh-v${harness} from ${siblingRoot}: ${
          error instanceof Error ? error.message : String(error)
        }\n` +
          '  install the pinned development dependencies or check out the sibling with that tag',
      )
      process.exit(1)
    }
  }
  const dsw = mergeThemeTokens(read, files)
  const ds = mergeThemeTokens(read, files, '--ds-')
  const current = (() => {
    try {
      return JSON.parse(readFileSync(fixture, 'utf8'))
    } catch {
      return undefined
    }
  })()
  verifyRuntimeSeams(current?.dsh ?? [], readSeam)
  if (process.argv.includes('--write')) {
    writeFileSync(
      fixture,
      `${JSON.stringify(snapshotOf(current, { harness, dsw, ds }), null, 2)}\n`,
    )
    console.log(
      `style-tokens: wrote ${dsw.length} dsw + ${ds.length} ds tokens from ${files.length} sheets`,
    )
  } else {
    const problems = []
    if (current === undefined)
      problems.push('no snapshot; run node scripts/style-tokens.mjs --write')
    else {
      if (current.harness !== harness) {
        problems.push(`snapshot describes harness ${current.harness}, the pin is ${harness}`)
      }
      for (const [label, committed, upstream] of [
        ['dsw', current.dsw ?? [], dsw],
        ['ds', current.ds ?? [], ds],
      ]) {
        const { missing, removed } = diffTokens(committed, upstream)
        if (missing.length > 0)
          problems.push(
            `${label}: ${missing.length} token(s) not in the snapshot: ${missing.join(', ')}`,
          )
        if (removed.length > 0)
          problems.push(`${label}: ${removed.length} token(s) gone upstream: ${removed.join(', ')}`)
      }
    }
    if (problems.length > 0) {
      for (const problem of problems) console.error(`style-tokens: ${problem}`)
      console.error('style-tokens: run node scripts/style-tokens.mjs --write')
      process.exit(1)
    }
    console.log(`style-tokens ok: ${dsw.length} dsw + ${ds.length} ds tokens, harness ${harness}`)
  }
}
