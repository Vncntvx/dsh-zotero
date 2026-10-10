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
 * here first, naming the missing path and the command that produces it.
 *
 * The expected paths come from `package.json` itself (`main`, `exports`,
 * `icon`, `dsh.bundle.patch`), the same fields the market's entry and
 * display-meta checks read, so a change to the manifest cannot drift from
 * the check.
 * @module scripts/verify-pack
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Strip the `./` a manifest path carries so it compares to a packed path. */
const packed = (path) => path.replace(/^\.\//, '')

/**
 * Resolve one exports entry (string or conditions object) into concrete
 * packed paths, recording the manifest claims the disk cannot back. A `*`
 * wildcard is expanded to the concrete files this package ships under that
 * pattern (locale bundles).
 * @param paths - accumulator of packed paths.
 * @param problems - accumulator of manifest-vs-disk breaches.
 * @param key - the exports key the entry came from.
 * @param value - the exports entry (string or conditions object).
 * @param baseDir - the package root the wildcard enumerates.
 */
function addExportPaths(paths, problems, key, value, baseDir) {
  const targets = typeof value === 'string' ? [value] : Object.values(value ?? {})
  for (const target of targets) {
    if (typeof target !== 'string') continue
    if (target.includes('*')) {
      // `./locale/*.json` → the concrete locale files the package ships,
      // enumerated from disk the way the market's package-meta reader does.
      if (key.includes('locale') || target.includes('locale')) {
        const localeDir = resolve(baseDir, 'locale')
        const bundles = existsSync(localeDir)
          ? readdirSync(localeDir).filter((entry) => entry.endsWith('.json'))
          : []
        if (bundles.length === 0) {
          // The gate must not narrow itself: an absent or empty directory used
          // to mean "nothing to assert", which is exactly the state a broken
          // release ships.
          problems.push(
            `the manifest declares the locale export "${key}" but ${relative(baseDir, localeDir)}` +
              ' carries no *.json bundle — the tarball would ship no locale dictionaries',
          )
        }
        for (const entry of bundles) paths.add(`locale/${entry}`)
      } else {
        // A non-locale wildcard must still resolve against the disk: the
        // pattern's static part names a directory, and a rename or deletion
        // on disk would ship an export that resolves to nothing.
        const star = target.indexOf('*')
        const slash = target.lastIndexOf('/', star)
        const dir = slash === -1 ? '.' : target.slice(0, slash)
        if (!existsSync(resolve(baseDir, dir))) {
          problems.push(
            `the manifest declares the wildcard export "${key}" but ${dir} does not exist` +
              ' on disk — the tarball would ship an export that resolves to nothing',
          )
        }
      }
      continue
    }
    paths.add(packed(target))
  }
}

/**
 * Every path the manifest says a consumer resolves, plus the fixed extras,
 * and every declared pattern the disk cannot back.
 * @param manifest - the parsed `package.json`.
 * @param baseDir - the package root the wildcard patterns enumerate.
 * @returns the expected packed paths and the manifest-vs-disk problems.
 */
export function expectedPaths(manifest, baseDir = root) {
  const paths = new Set(['package.json', 'README.md'])
  const problems = []
  if (Array.isArray(manifest.files)) {
    for (const file of manifest.files) {
      if (typeof file !== 'string') continue
      const full = resolve(baseDir, file)
      if (!existsSync(full)) {
        // Declared-but-absent is a broken release in the making, whatever the
        // entry kind: a directory the tree dropped (or never had) must fail
        // the gate, not silently ship less than the manifest promises.
        problems.push(`the manifest "files" entry "${file}" does not exist on disk`)
        continue
      }
      if (statSync(full).isFile()) paths.add(packed(file))
      // A directory entry contributes its tree at pack time; the tarball
      // comparison below proves the concrete files arrived.
    }
  }
  if (typeof manifest.main === 'string') paths.add(packed(manifest.main))
  if (typeof manifest.icon === 'string') paths.add(packed(manifest.icon))
  const exportsMap = manifest.exports
  if (typeof exportsMap === 'string') {
    paths.add(packed(exportsMap))
  } else if (exportsMap !== null && typeof exportsMap === 'object') {
    for (const [key, value] of Object.entries(exportsMap)) {
      addExportPaths(paths, problems, key, value, baseDir)
    }
  }
  const patch = manifest.dsh?.bundle?.patch
  if (typeof patch === 'string') paths.add(packed(patch))
  else if (Array.isArray(patch))
    for (const p of patch) if (typeof p === 'string') paths.add(packed(p))
  return { paths: [...paths].sort(), problems }
}

/**
 * The JSON report carried by an `npm pack --json` stdout.
 *
 * The report is not necessarily the whole stream: a version-pinned npm runs
 * the `prepare` lifecycle script even under `--ignore-scripts` and prints its
 * output ahead of the payload, so the report starts at the first line opening
 * an object or an array. Locating it that way keeps this gate independent of
 * npm's lifecycle printing.
 * @param stdout - the captured stdout of `npm pack --dry-run --json`.
 * @returns the JSON text to parse.
 * @throws {Error} when the stream carries no JSON payload at all.
 */
export function packReportOf(stdout) {
  const lines = stdout.split('\n')
  const start = lines.findIndex((line) => line.startsWith('{') || line.startsWith('['))
  if (start === -1) {
    throw new Error(
      `npm pack printed no JSON report; the stream began: ${JSON.stringify(stdout.slice(0, 200))}`,
    )
  }
  return lines.slice(start).join('\n')
}

/** Pack the package and prove every declared entry reached the tarball. */
function verifyPack() {
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  const { paths: expected, problems } = expectedPaths(manifest)
  if (problems.length > 0) {
    for (const problem of problems) console.error(`verify-pack: ${problem}`)
    process.exitCode = 1
    return
  }

  let stdout
  try {
    stdout = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    })
  } catch (error) {
    // npm pack can fail for environmental reasons (a permission-denied cache,
    // an unavailable npm). That must exit through this gate's own channel with
    // a one-line cause, not an uncaught exception's stack trace.
    console.error(
      `verify-pack: npm pack failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exitCode = 1
    return
  }
  const report = JSON.parse(packReportOf(stdout))
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
    process.exitCode = 1
    return
  }
  console.log(`verify-pack ok: ${files.size} file(s), entries present (${expected.join(', ')})`)
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  verifyPack()
}
