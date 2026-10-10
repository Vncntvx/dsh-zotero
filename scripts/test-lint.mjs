/**
 * The test suite's mechanical guards: the rules that decay silently, checked
 * the way a reviewer cannot check them by hand across the whole spec tree.
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
 *
 * The pure predicates below are exported and driven by `tests/unit/test-lint`
 * so the guards themselves cannot decay: a regex that stopped matching the
 * form its docstring names would otherwise fail the suite green.
 * @module scripts/test-lint
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Directories that carry the project's source, tests, tooling, prose, and locale copy. */
export const TEXT_ROOTS = ['src', 'tests', 'scripts', 'docs', 'locale']

/**
 * The extensions that contract to be text. Binary assets are not the target
 * of this check and never were: a `.png` under `docs/images/` is supposed to
 * hold arbitrary bytes, while a `.ts` file holding them is the corruption this
 * guard exists to catch. `.mts`/`.cts` are contract text like every other
 * TypeScript flavor: the build gates read them.
 */
export const TEXT_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
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
 * Extensions allowed to hold arbitrary bytes under the text roots. A new
 * extension that is neither listed here nor in {@link TEXT_EXTENSIONS} fails
 * the guard, so the next binary asset has to be declared rather than silently
 * skipped.
 */
export const BINARY_EXTENSIONS = ['.png']

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

/**
 * Every extension occurring under the text roots must be either a declared
 * text extension or a declared binary one. A file type that is neither would
 * otherwise be skipped by the control-byte guard without anyone deciding it
 * should be.
 */
export function unscannedExtensionsOf(paths) {
  const declared = new Set([...TEXT_EXTENSIONS, ...BINARY_EXTENSIONS])
  const unscanned = new Set()
  for (const path of paths) {
    const dot = path.lastIndexOf('.')
    if (dot === -1) continue
    const extension = path.slice(dot)
    if (!declared.has(extension)) unscanned.add(extension)
  }
  return [...unscanned].sort()
}

function checkExtensionCoverage() {
  const paths = TEXT_ROOTS.flatMap((dir) => filesUnder(join(root, dir)))
  const unscanned = unscannedExtensionsOf(paths)
  for (const extension of unscanned) {
    failures.push(
      [
        `files under ${TEXT_ROOTS.join('/')} carry the "${extension}" extension, which is neither a declared text nor binary extension`,
        `  fix: add it to TEXT_EXTENSIONS (text, scanned for control bytes) or BINARY_EXTENSIONS (declared, skipped)`,
      ].join('\n'),
    )
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
 * Blank out comments and string/template bodies while preserving every
 * character's offset, so match positions in the stripped text still map to
 * real line numbers.
 *
 * Regex literals are deliberately not stripped: telling a division from a
 * regex needs a full lexer, a mistake there would blank real code (hiding a
 * violation), and a regex body containing `.only(`/`.skip(` does not occur in
 * this suite.
 * @param source - the file content.
 * @returns same-length text with comments and string bodies blanked.
 */
export function stripCommentsAndStrings(source) {
  const out = source.split('')
  const n = source.length
  let i = 0
  while (i < n) {
    const ch = source[i]
    const next = i + 1 < n ? source[i + 1] : ''
    if (ch === '/' && next === '/') {
      while (i < n && source[i] !== '\n') {
        out[i] = ' '
        i += 1
      }
      continue
    }
    if (ch === '/' && next === '*') {
      out[i] = ' '
      out[i + 1] = ' '
      i += 2
      while (i < n) {
        if (source[i] === '*' && source[i + 1] === '/') {
          out[i] = ' '
          out[i + 1] = ' '
          i += 2
          break
        }
        if (source[i] !== '\n') out[i] = ' '
        i += 1
      }
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      i += 1
      while (i < n) {
        if (source[i] === '\\') {
          out[i] = ' '
          if (source[i + 1] !== undefined && source[i + 1] !== '\n') out[i + 1] = ' '
          i += 2
          continue
        }
        if (source[i] === quote) {
          out[i] = ' '
          i += 1
          break
        }
        if (source[i] !== '\n') out[i] = ' '
        i += 1
      }
      continue
    }
    i += 1
  }
  return out.join('')
}

/**
 * A focused or disabled test is a decision that outlives its author: `.only`
 * silently removes every other case from the run, and `.skip`/`.todo` turn a
 * red test into a green suite. The chain forms count too (`it.only.each`,
 * `it.concurrent.only`, and a `.only` continued on the next line all focus or
 * disable just as hard), so the scan runs over comment- and string-stripped
 * content with a chain-aware pattern rather than one line at a time.
 *
 * `runIf` stays the sanctioned gate. Its unconditional-disable spelling,
 * `runIf(false)`, is refused exactly like `skipIf(true)`: a conditional gate
 * is the author's call, an unconditional one is a hidden decision.
 * @param source - the file content.
 * @returns each violation with its 1-based line and the construct named.
 */
export function focusViolationsOf(source) {
  const stripped = stripCommentsAndStrings(source)
  const violations = []
  const chain =
    /\b(it|test|describe|suite)((?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\.\s*(only|skip|todo)\b/g
  for (const match of stripped.matchAll(chain)) {
    violations.push({
      line: stripped.slice(0, match.index).split('\n').length,
      construct: `${match[1]}${match[2].replaceAll(/\s+/g, '')}.${match[3]}`,
    })
  }
  const conditional = /\b(?:it|test|describe|suite)\s*\.\s*(skipIf|runIf)\s*\(\s*(true|false)\b/g
  for (const match of stripped.matchAll(conditional)) {
    if (
      (match[1] === 'skipIf' && match[2] === 'true') ||
      (match[1] === 'runIf' && match[2] === 'false')
    ) {
      violations.push({
        line: stripped.slice(0, match.index).split('\n').length,
        construct: `${match[1]}(${match[2]})`,
      })
    }
  }
  return violations.sort((a, b) => a.line - b.line)
}

function checkFocus() {
  for (const path of specFiles()) {
    for (const violation of focusViolationsOf(readFileSync(join(root, path), 'utf8'))) {
      failures.push(
        [
          `${path}:${violation.line} uses ${violation.construct}`,
          `  fix: delete the case or gate its suite with .runIf(...)`,
        ].join('\n'),
      )
    }
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  const largest = checkSpecSize()
  checkTextFiles()
  checkExtensionCoverage()
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
}
