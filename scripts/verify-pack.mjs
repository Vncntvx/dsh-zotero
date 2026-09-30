/**
 * Prove the artifact a user installs actually carries what the plugin
 * declares.
 *
 * `npm pack --dry-run --json --ignore-scripts` lists exactly what the tarball
 * would contain, so this gate runs offline and writes nothing. It exists
 * because the failure it catches is silent until a consumer hits it: pnpm can
 * install a source-only or half-built package with exit 0, then the harness
 * market's post-install validation finds no loadable entry, removes the
 * package, and reports "nothing installable … or ship no prebuilt artifacts".
 * A published tarball must never be in that state, so the release path fails
 * here first — naming the missing path and the command that produces it.
 *
 * The expected paths come from `package.json` itself (`main`, `exports`,
 * `icon`, `dsh.bundle.patch`), the same fields the market's entry and
 * display-meta checks read, so a change to the manifest cannot drift from
 * the check.
 * @module scripts/verify-pack
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Strip the `./` a manifest path carries so it compares to a packed path. */
const packed = (path) => path.replace(/^\.\//, '')

/**
 * Resolve one exports entry (string or conditions object) into concrete
 * packed paths. A `*` wildcard is expanded to the concrete files this
 * package ships under that pattern (locale bundles).
 */
function addExportPaths(paths, key, value) {
  const targets = typeof value === 'string' ? [value] : Object.values(value ?? {})
  for (const target of targets) {
    if (typeof target !== 'string') continue
    if (target.includes('*')) {
      // `./locale/*.json` → the concrete locale files the package ships.
      if (key.includes('locale') || target.includes('locale')) {
        paths.add('locale/en.json')
        paths.add('locale/zh.json')
      }
      continue
    }
    paths.add(packed(target))
  }
}

/** Every path the manifest says a consumer resolves, plus the fixed extras. */
function expectedPaths(manifest) {
  const paths = new Set(['package.json', 'README.md'])
  if (typeof manifest.main === 'string') paths.add(packed(manifest.main))
  if (typeof manifest.icon === 'string') paths.add(packed(manifest.icon))
  const exportsMap = manifest.exports
  if (typeof exportsMap === 'string') {
    paths.add(packed(exportsMap))
  } else if (exportsMap !== null && typeof exportsMap === 'object') {
    for (const [key, value] of Object.entries(exportsMap)) {
      addExportPaths(paths, key, value)
    }
  }
  const patch = manifest.dsh?.bundle?.patch
  if (typeof patch === 'string') paths.add(packed(patch))
  else if (Array.isArray(patch))
    for (const p of patch) if (typeof p === 'string') paths.add(packed(p))
  return [...paths].sort()
}

const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const expected = expectedPaths(manifest)

const stdout = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
})
const report = JSON.parse(stdout)
// `npm pack --json` answers a name-keyed object (and an array on older npm),
// so normalize both shapes to the one entry this package produced.
const entry = (Array.isArray(report) ? report : Object.values(report))[0]
const files = new Set((entry?.files ?? []).map((file) => packed(file.path)))

const missing = expected.filter((path) => !files.has(path))
if (missing.length > 0) {
  console.error(
    `verify-pack: the tarball would not carry ${missing.join(', ')} —` +
      ' run `npm run build` first (the release path does), then retry',
  )
  process.exit(1)
}
console.log(`verify-pack ok: ${files.size} file(s), entries present (${expected.join(', ')})`)
