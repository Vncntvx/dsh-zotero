/**
 * The test suite's mechanical guards: the rules that decay silently, checked
 * the way a reviewer cannot check them by hand across 55 files.
 *
 * Every check here exists because this repository actually hit the failure it
 * catches. The SourcesTab spec (since split into `SourcesTab.*.spec.tsx`) once
 * carried two raw NUL bytes inside a string literal, which made the file
 * binary to every text tool: the Read tool refused it, `grep` skipped it
 * without `-a`, and `file(1)` reported `data`. `tests/tools.spec.ts` grew to
 * 2534 lines one review round at a time before becoming `tests/tools/*`, and
 * two spec files existed purely to raise a coverage number. None of those were
 * visible in a diff, and none of them failed a test.
 *
 * The size and lane limits are **ratchets**: they are set from the values the
 * suite carries at the time and only ever move down. A ratchet that never
 * tightens is a comment; one that tightens by itself would fail on the next
 * unrelated commit, so the numbers are reviewed here.
 * @module scripts/test-lint
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Directories that carry the project's source, tests, tooling, and prose. */
const TEXT_ROOTS = ['src', 'tests', 'scripts', 'docs']

/**
 * The extensions that contract to be text. Binary assets are not the target
 * of this check and never were: a `.png` under `docs/images/` is supposed to
 * hold arbitrary bytes, while a `.ts` file holding them is the corruption this
 * guard exists to catch.
 */
const TEXT_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.css',
  '.yml',
  '.yaml',
  '.html',
  '.svg',
  '.txt',
]

/**
 * The control bytes a text file may contain: tab, newline, carriage return.
 * Anything else is either corruption or an escape someone forgot to write.
 */
const ALLOWED_CONTROL = new Set([0x09, 0x0a, 0x0d])

/**
 * Ratchet: the most lines one spec file may occupy. Lower it in the same
 * commit that splits a file, never preemptively.
 */
const MAX_SPEC_LINES = 733

/**
 * Ratchet: the directories a spec may live in, relative to `tests/`. Each lane
 * mirrors the `src/` layer it covers, so where a spec lives is decided by what
 * it tests rather than by when it was written. Nested lanes such as
 * `client/sources` are covered by their first segment.
 */
const SPEC_LANES = ['unit', 'local', 'tools', 'host', 'client', 'integration']

const failures = []

/**
 * Every file under one directory, recursively, as absolute paths. Dot-entries
 * are skipped: `.DS_Store` and its kin are OS state that a checkout carries
 * but the repository does not, and a guard that fires on them trains its
 * reader to ignore it.
 */
function filesUnder(dir) {
  const found = []
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...filesUnder(path))
    else found.push(path)
  }
  return found
}

/** The line count of one file, without counting the newline that ends the last line. */
function lineCountOf(path) {
  const text = readFileSync(path, 'utf8')
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
}

/** File paths of every spec, as paths relative to the repo root. */
function specFiles() {
  return filesUnder(join(root, 'tests'))
    .filter((path) => /\.spec\.tsx?$/.test(path))
    .map((path) => relative(root, path))
    .sort()
}

/**
 * A file must read as text end to end. The byte offset and a short context
 * are named because the offending byte is invisible in every editor view.
 */
function checkTextFiles() {
  for (const dir of TEXT_ROOTS) {
    for (const path of filesUnder(join(root, dir))) {
      if (!TEXT_EXTENSIONS.some((extension) => path.endsWith(extension))) continue
      const bytes = readFileSync(path)
      const found = new Map()
      for (const [index, byte] of bytes.entries()) {
        if (byte < 0x20 && !ALLOWED_CONTROL.has(byte)) {
          found.set(byte, [...(found.get(byte) ?? []), index])
        }
      }
      for (const [byte, offsets] of found) {
        const context = bytes
          .subarray(Math.max(0, offsets[0] - 40), offsets[0] + 40)
          .toString('utf8')
          .replaceAll(
            /[\u0000-\u001f]/g,
            (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`,
          )
        failures.push(
          [
            `${relative(root, path)} contains ${offsets.length} raw 0x${byte.toString(16).padStart(2, '0')} byte(s)`,
            `  first at offset ${offsets[0]}: …${context}…`,
            `  fix: write the escape (\\u0000) instead of the byte, so the file stays text`,
          ].join('\n'),
        )
      }
    }
  }
}

/** No spec may outgrow the ratchet; the offenders are listed largest first. */
function checkSpecSize() {
  const sized = specFiles().map((path) => ({ path, lines: lineCountOf(join(root, path)) }))
  for (const { path, lines } of sized.filter((entry) => entry.lines > MAX_SPEC_LINES)) {
    failures.push(
      [
        `${path} is ${lines} lines; the ratchet allows ${MAX_SPEC_LINES}`,
        `  fix: split it along its own seams and lower the ratchet in the same commit`,
      ].join('\n'),
    )
  }
  const largest = sized.slice().sort((a, b) => b.lines - a.lines)[0]
  return largest === undefined ? '(none)' : `${largest.path} (${largest.lines} lines)`
}

/** A spec's location is decided by the module it tests, so only lanes are allowed. */
function checkLanes() {
  for (const path of specFiles()) {
    const lane = relative(join(root, 'tests'), join(root, path)).split('/')[0]
    const segment = lane.endsWith('.spec.ts') || lane.endsWith('.spec.tsx') ? '' : lane
    if (!SPEC_LANES.includes(segment)) {
      failures.push(
        [
          `${path} sits in a directory no lane declares ("tests/${segment || '.'}")`,
          `  lanes: ${SPEC_LANES.map((name) => name || '.').join(', ')}`,
          `  fix: move it under the lane that mirrors the src module it tests`,
        ].join('\n'),
      )
    }
  }
}

/**
 * A focused or disabled test is a decision that outlives its author: `.only`
 * silently removes every other case from the run, and `.skip`/`.todo` turn a
 * red test into a green suite. `runIf` is the supported way to gate a suite
 * (the live-Zotero specs use it), so only the call forms are rejected.
 */
function checkFocus() {
  for (const path of specFiles()) {
    const lines = readFileSync(join(root, path), 'utf8').split('\n')
    lines.forEach((line, index) => {
      const match = /\b(it|test|describe)\.(only|skip|todo)\s*\(/.exec(line)
      if (match === null) return
      failures.push(
        [
          `${path}:${index + 1} uses ${match[1]}.${match[2]}`,
          `  fix: delete the case or gate its suite with .runIf(...)`,
        ].join('\n'),
      )
    })
  }
}

const largest = checkSpecSize()
checkTextFiles()
checkLanes()
checkFocus()

if (failures.length > 0) {
  process.stderr.write(`test-lint: ${failures.length} problem(s)\n\n`)
  for (const failure of failures) process.stderr.write(`${failure}\n\n`)
  process.exit(1)
}

process.stdout.write(
  `test-lint: ok — ${specFiles().length} specs, largest ${largest}, lane ratchet ${SPEC_LANES.map((name) => name || '.').join('/')}\n`,
)
