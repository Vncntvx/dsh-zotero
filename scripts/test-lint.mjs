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
 * The pure predicates below are exported and driven by `tests/unit/tooling/test-lint`
 * so the guards themselves cannot decay: a regex that stopped matching the
 * form its docstring names would otherwise fail the suite green.
 * @module scripts/test-lint
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { stripCommentsAndStrings, sourceNodes } from './shared/source-scan.mjs'
import { fakeIpPolicyIssues } from './fake-ip-guard.mjs'

// Re-exported so `tests/unit/tooling/test-lint` keeps driving the one shared stripper.
export { stripCommentsAndStrings }

/**
 * One focused or disabled test construct found in a spec, mirroring
 * `FocusViolation` in `test-lint.d.mts`.
 * @typedef {{ line: number, construct: string }} FocusViolation
 */

/**
 * One helper whose size exceeds its limit or frozen baseline, mirroring
 * `HelperSizeViolation` in `test-lint.d.mts`.
 * @typedef {{ kind: 'grown' | 'shrunk' | 'new' | 'stale', path: string, lines: number, limit: number }} HelperSizeViolation
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Directories that carry the project's source, tests, tooling, prose, and locale copy. */
export const TEXT_ROOTS = ['src', 'tests', 'scripts', 'docs', 'locale', '.github']
export const ROOT_TEXT_FILES = [
  'AGENTS.md',
  'README.md',
  'README.en.md',
  'LICENSE',
  'SECURITY.md',
  'package.json',
  'package-lock.json',
  'vitest.config.ts',
  'eslint.config.mjs',
]

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
  '.py',
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
export const BINARY_EXTENSIONS = ['.pdf', '.png', '.webp']

/**
 * The control bytes a text file may contain: tab, newline, carriage return.
 * Anything else is either corruption or an escape someone forgot to write.
 */
const ALLOWED_CONTROL = new Set([0x09, 0x0a, 0x0d])

/**
 * Ratchet: the most lines one spec file may occupy. Lower it in the same
 * commit that splits a file, never preemptively. The current ceiling is
 * `tests/tools/write/write-presentation.spec.ts`; lowering it requires
 * splitting that spec first.
 */
export const MAX_SPEC_LINES = 726
export const STANDARD_SPEC_LINES = 400

export const SPEC_SIZE_BASELINE = Object.freeze({
  'tests/client/apply.spec.ts': 679,
  'tests/client/enrichment/enrichment-model-controller.spec.ts': 451,
  'tests/client/enrichment/enrichment-model-form.spec.tsx': 486,
  'tests/client/enrichment/parse-dialog.spec.tsx': 403,
  'tests/client/library/library-data-plane.spec.ts': 410,
  'tests/client/library/library-inspector.spec.tsx': 712,
  'tests/client/library/library-panel.interaction.spec.tsx': 508,
  'tests/client/library/library-panel.states.spec.tsx': 486,
  'tests/client/library/library-tree.spec.tsx': 461,
  'tests/client/library/library-write.spec.tsx': 591,
  'tests/client/library/remote-contract-library.spec.ts': 503,
  'tests/client/open/PdfReadButton.spec.tsx': 463,
  'tests/client/settings/scholarly-form.spec.tsx': 435,
  'tests/client/settings/ZoteroSettingsSection.spec.tsx': 516,
  'tests/client/slot-crash-intake.spec.ts': 444,
  'tests/client/sources/decoders.spec.ts': 490,
  'tests/client/sources/reducer-evidence.spec.ts': 483,
  'tests/client/sources/reducer-outputs.spec.ts': 653,
  'tests/client/sources/reducer.spec.ts': 673,
  'tests/client/sources/selectors.spec.ts': 473,
  'tests/client/toolviews/BrowseToolView.spec.tsx': 653,
  'tests/client/toolviews/ExportToolView.spec.tsx': 470,
  'tests/client/toolviews/RetrieveToolView.spec.tsx': 558,
  'tests/client/toolviews/WriteToolView.spec.tsx': 609,
  'tests/client/workspace/ExportsLens.spec.tsx': 506,
  'tests/client/workspace/SourceAuditPanel.spec.tsx': 408,
  'tests/client/workspace/SourceEvidence.spec.tsx': 590,
  'tests/host/doc-coverage.spec.ts': 438,
  'tests/host/doc-examples.spec.ts': 515,
  'tests/host/enrichment-api-contract.spec.ts': 465,
  'tests/host/enrichment-artifact-store.spec.ts': 410,
  'tests/host/enrichment-parse-endpoints.spec.ts': 404,
  'tests/host/enrichment-parse-once.spec.ts': 494,
  'tests/host/http-client.spec.ts': 681,
  'tests/host/library-service.spec.ts': 411,
  'tests/host/lifecycle.spec.ts': 589,
  'tests/host/remote.spec.ts': 408,
  'tests/host/source-ledger.spec.ts': 546,
  'tests/host/write/write-http.spec.ts': 614,
  'tests/integration/zotero.integration.spec.ts': 706,
  'tests/local/browse.spec.ts': 415,
  'tests/local/export.spec.ts': 565,
  'tests/local/get.spec.ts': 418,
  'tests/local/path-resolution.spec.ts': 468,
  'tests/local/retrieve/retrieve-sources.spec.ts': 508,
  'tests/local/scope-directory.spec.ts': 418,
  'tests/local/search/search-filters.spec.ts': 589,
  'tests/local/search/search-scan.spec.ts': 698,
  'tests/local/search/search.spec.ts': 690,
  'tests/local/write/domain.spec.ts': 684,
  'tests/local/write/lifecycle.spec.ts': 524,
  'tests/local/write/trash.spec.ts': 630,
  'tests/local/write/verdicts.spec.ts': 484,
  'tests/scholarly/cite-verify.spec.ts': 407,
  'tests/scholarly/fusion.spec.ts': 551,
  'tests/scholarly/network.spec.ts': 612,
  'tests/scholarly/read/read-tools.spec.ts': 692,
  'tests/scholarly/resolution.spec.ts': 722,
  'tests/scholarly/search-tools.spec.ts': 613,
  'tests/scholarly/service.spec.ts': 416,
  'tests/scholarly/sources/sources-requests.spec.ts': 499,
  'tests/scholarly/sources/transport.spec.ts': 569,
  'tests/tools/batch-items.spec.ts': 641,
  'tests/tools/retrieve-fulltext.spec.ts': 545,
  'tests/tools/retrieve-render.spec.ts': 464,
  'tests/tools/retrieve.spec.ts': 411,
  'tests/tools/search.spec.ts': 449,
  'tests/tools/write/create-item.spec.ts': 415,
  'tests/tools/write/restore-items.spec.ts': 475,
  'tests/tools/write/saved-search.spec.ts': 589,
  'tests/tools/write/write-item-presentation.spec.ts': 587,
  'tests/tools/write/write-presentation.spec.ts': 726,
  'tests/unit/enrichment-model-downloader.spec.ts': 427,
  'tests/unit/enrichment-parse-wire.spec.ts': 464,
  'tests/unit/export-mapping.spec.ts': 666,
  'tests/unit/library-views.spec.ts': 706,
  'tests/unit/normalize/normalize-item-detail.spec.ts': 711,
  'tests/unit/presentation-meta.spec.ts': 559,
  'tests/unit/tooling/harness-state.spec.ts': 605,
  'tests/unit/tooling/style-guard.spec.ts': 427,
})

/**
 * Ratchet: the most lines one helper may occupy. Existing helpers above the
 * limit are frozen in {@link HELPER_SIZE_BASELINE}; a baselined file may only
 * shrink, and a new helper may never enter the baseline.
 */
export const MAX_HELPER_LINES = 300

/**
 * Grandfathered helpers at their pre-change size. Removing a file or splitting
 * it means deleting or lowering its entry in the same commit; adding an entry
 * is never allowed.
 */
export const HELPER_SIZE_BASELINE = Object.freeze({
  'tests/client/helpers/source-fixtures.ts': 128,
  'tests/client/helpers/apply-world.ts': 350,
  'tests/client/helpers/library-panel-harness.tsx': 150,
  'tests/host/support/enrichment-parse-endpoints.ts': 332,
  'tests/host/support/enrichment-parse-jobs.ts': 323,
})

/**
 * Ratchet: the directories a spec may live in, relative to `tests/`. Each lane
 * mirrors the `src/` layer it covers, so where a spec lives is decided by what
 * it tests rather than by when it was written. Nested lanes such as
 * `client/sources` are covered by their first segment.
 */
const SPEC_LANES = ['unit', 'local', 'tools', 'host', 'client', 'integration', 'scholarly']

const failures = []

/**
 * Every file under one directory, recursively, as absolute paths. Dot-entries
 * are skipped: `.DS_Store` and its kin are OS state that a checkout carries
 * but the repository does not, and a guard that fires on them trains its
 * reader to ignore it.
 */
/**
 * @param {string} dir
 * @returns {string[]} every file, as absolute paths.
 */
function filesUnder(dir) {
  const found = []
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'node_modules') continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...filesUnder(path))
    else found.push(path)
  }
  return found
}

/**
 * The line count of one file, without counting the newline that ends the last line.
 * @param {string} path
 * @returns {number}
 */
function lineCountOf(path) {
  const text = readFileSync(path, 'utf8')
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
}

/**
 * File paths of every spec, as paths relative to the repo root.
 * @param {string} [base]
 * @returns {string[]}
 */
export function specFiles(base = root) {
  return filesUnder(join(base, 'tests'))
    .filter((path) => /\.spec\.(?:[cm]?ts|tsx)$/.test(path))
    .map((path) => relative(base, path))
    .sort()
}

/**
 * Whether one path is a helper subject to the size budget: a TypeScript module
 * under a `helpers/` or `support/` directory.
 *
 * `support/` belongs here because it is where a module's shared fixtures live
 * (`tests/README.md`: specs → module support → shared helpers), so a budget
 * that only read `helpers/` let two support modules grow past it unnoticed.
 * @param {string} path - a path relative to the repository root.
 * @returns {boolean} true for a helper or support module.
 */
export function isHelperFile(path) {
  return /[\\/](?:helpers|support)[\\/]/.test(path) && /\.(?:[cm]?ts|tsx)$/.test(path)
}

/** File paths of every helper and support module, relative to the repo root. */
function helperFiles() {
  return filesUnder(join(root, 'tests'))
    .filter((path) => isHelperFile(path))
    .map((path) => relative(root, path))
    .sort()
}

/**
 * A file must read as text end to end. The byte offset and a short context
 * are named because the offending byte is invisible in every editor view.
 * @param {string} [base]
 * @returns {string[]} the file paths, as absolute paths.
 */
export function textFiles(base = root) {
  const tree = TEXT_ROOTS.flatMap((dir) =>
    existsSync(join(base, dir)) ? filesUnder(join(base, dir)) : [],
  )
  return [...tree, ...ROOT_TEXT_FILES.map((name) => join(base, name)).filter(existsSync)].filter(
    (path) => extname(path) === '' || TEXT_EXTENSIONS.includes(extname(path)),
  )
}

function checkTextFiles() {
  for (const path of textFiles()) {
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

/**
 * Every extension occurring under the text roots must be either a declared
 * text extension or a declared binary one. A file type that is neither would
 * otherwise be skipped by the control-byte guard without anyone deciding it
 * should be.
 * @param {ReadonlyArray<string>} paths - file paths to inventory.
 * @returns {string[]} the sorted undeclared extensions.
 */
export function unscannedExtensionsOf(paths) {
  const declared = new Set([...TEXT_EXTENSIONS, ...BINARY_EXTENSIONS])
  const unscanned = new Set()
  for (const path of paths) {
    const extension = extname(path)
    if (!extension) continue
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
  const sized = fileSizes(specFiles())
  checkFileSizes('spec', specSizeViolations(sized))
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

/**
 * Compare helper sizes against the limit and the frozen baseline.
 *
 * A baselined helper must match its lowered baseline; a helper outside the baseline
 * may not exceed the limit; a baseline entry whose file disappeared is stale
 * and must be removed with the split.
 * @param {ReadonlyArray<{ path: string, lines: number }>} entries - `{ path, lines }` for every helper.
 * @param {Readonly<Record<string, number>>} [baseline] - frozen path → line count.
 * @param {number} [limit] - the new-helper limit.
 * @returns {HelperSizeViolation[]} violations with the kind, path, actual lines, and applicable limit.
 */
export function helperSizeViolations(
  entries,
  baseline = HELPER_SIZE_BASELINE,
  limit = MAX_HELPER_LINES,
) {
  /** @type {HelperSizeViolation[]} */
  const found = []
  const seen = new Set()
  for (const { path, lines } of entries) {
    const frozen = baseline[path]
    if (frozen !== undefined) {
      seen.add(path)
      if (lines > frozen) found.push({ kind: 'grown', path, lines, limit: frozen })
      if (lines < frozen) found.push({ kind: 'shrunk', path, lines, limit: frozen })
      continue
    }
    if (lines > limit) found.push({ kind: 'new', path, lines, limit })
  }
  for (const path of Object.keys(baseline)) {
    if (!seen.has(path)) found.push({ kind: 'stale', path, lines: 0, limit: baseline[path] })
  }
  return found
}

/**
 * @param {ReadonlyArray<{ path: string, lines: number }>} entries
 * @param {Readonly<Record<string, number>>} [baseline]
 * @returns {HelperSizeViolation[]}
 */
export function specSizeViolations(entries, baseline = SPEC_SIZE_BASELINE) {
  return helperSizeViolations(entries, baseline, STANDARD_SPEC_LINES)
}

/**
 * @param {ReadonlyArray<string>} paths
 * @returns {Array<{ path: string, lines: number }>}
 */
function fileSizes(paths) {
  return paths.map((path) => ({
    path: path.replaceAll('\\', '/'),
    lines: lineCountOf(join(root, path)),
  }))
}

/** No helper may outgrow its baseline or the new-helper limit. */
function checkHelperSize() {
  const entries = fileSizes(helperFiles())
  checkFileSizes('helper', helperSizeViolations(entries))
  return `${entries.length} helpers`
}

/**
 * @param {string} kind
 * @param {ReadonlyArray<HelperSizeViolation>} violations
 */
function checkFileSizes(kind, violations) {
  for (const violation of violations) {
    if (violation.kind === 'grown') {
      failures.push(
        [
          `${violation.path} is ${violation.lines} lines; its frozen baseline is ${violation.limit}`,
          `  fix: split it and lower the baseline in the same commit`,
        ].join('\n'),
      )
    } else if (violation.kind === 'shrunk') {
      failures.push(
        `${violation.path} shrank to ${violation.lines} lines; lower or remove its ${kind}-size baseline of ${violation.limit}`,
      )
    } else if (violation.kind === 'stale') {
      failures.push(
        [
          `${violation.path} is in the ${kind}-size baseline but no longer exists`,
          `  fix: remove its baseline entry in the same commit that removed or renamed it`,
        ].join('\n'),
      )
    } else {
      failures.push(
        [
          `${violation.path} is ${violation.lines} lines; new ${kind} files are limited to ${violation.limit}`,
          `  fix: split the file along its own seams`,
        ].join('\n'),
      )
    }
  }
}

/** A spec's location is decided by the module it tests, so only lanes are allowed. */
function checkLanes() {
  for (const path of specFiles()) {
    const lane = relative(join(root, 'tests'), join(root, path)).split(/[\\/]/)[0]
    const segment = /\.spec\.(?:[cm]?ts|tsx)$/.test(lane) ? '' : lane
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
 * The first non-whitespace index at or after `index`, clamped to the end.
 * @param {string} text
 * @param {number} index
 * @returns {number}
 */
function skipSpace(text, index) {
  let i = index
  while (i < text.length && /\s/.test(text[i])) i += 1
  return i
}

/**
 * The index just past the balanced call whose `(` sits at `open`.
 *
 * Strings, comments and regex bodies are already blanked by the token-aware
 * scanner, so their parentheses cannot affect this balance. Template
 * expressions remain code and participate normally.
 */
/**
 * @param {string} text
 * @param {number} open
 * @returns {number}
 */
function afterCall(text, open) {
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1
    else if (text[i] === ')') {
      depth -= 1
      if (depth === 0) return i + 1
    }
  }
  return text.length
}

/** The focus and disable modifiers, plus every member vitest lets precede one. */
const CHAIN_KEYWORD = /\b(it|test|describe|suite)\b/g
const FOCUS_MODIFIERS = new Set(['only', 'skip', 'todo'])
const MEMBER_NAME = /^[A-Za-z_$][\w$]*/

/**
 * A focused or disabled test is a decision that outlives its author: `.only`
 * silently removes every other case from the run, and `.skip`/`.todo` turn a
 * red test into a green suite.
 *
 * The modifier is not always the first member. Vitest hangs `.only`/`.skip`
 * off the object `each`/`for`/`concurrent` returns, so
 * `it.each([1]).only('x', …)` focuses the same way `it.only.each([1])` does;
 * a pattern that only reads dotted identifiers before the modifier misses the
 * first form, and a line-based scan misses a chain continued on the next line.
 * The scan therefore walks the member chain, stepping over each call's
 * argument list, and reports the first focus modifier it meets.
 *
 * `runIf` stays the sanctioned gate. Its unconditional-disable spelling,
 * `runIf(false)`, is refused exactly like `skipIf(true)`: a conditional gate
 * is the author's call, an unconditional one is a hidden decision.
 * @param {string} source - the file content.
 * @returns {FocusViolation[]} each violation with its 1-based line and the construct named.
 */
export function focusViolationsOf(source) {
  const stripped = stripCommentsAndStrings(source)
  const violations = []
  for (const match of stripped.matchAll(CHAIN_KEYWORD)) {
    const written = [match[1]]
    let index = match.index + match[1].length
    for (;;) {
      const dot = skipSpace(stripped, index)
      if (stripped[dot] !== '.') break
      const nameAt = skipSpace(stripped, dot + 1)
      const name = MEMBER_NAME.exec(stripped.slice(nameAt))
      if (name === null) break
      written.push(`.${name[0]}`)
      index = nameAt + name[0].length
      if (FOCUS_MODIFIERS.has(name[0])) {
        violations.push({
          line: stripped.slice(0, match.index).split('\n').length,
          construct: written.join(''),
        })
        break
      }
      // `it.each([1])` returns the object that carries `.only`: step over the
      // call so the next member is read from the chain, not from its arguments.
      const call = skipSpace(stripped, index)
      if (stripped[call] === '(') {
        index = afterCall(stripped, call)
        written.push('(...)')
      }
    }
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

/**
 * The published `@deepseek-ai/*` packages advertise `"./src/*": "./src/*"` in
 * `exports` while `files` ships only `lib/**` and `locale/*.json`. An import
 * into that subtree resolves in a sibling checkout (where this workspace
 * links `node_modules` to source) and fails both typecheck and Vite
 * resolution in the registry-only client lane CI runs. `src/**` and
 * `tests/**` must depend on public entries only.
 *
 * Only import syntax counts: `tests/unit/tooling/harness-state.spec.ts` legitimately
 * carries `/src/` specifiers inside string fixtures for its own artifact
 * audit. A commented-out example is not a dependency either. Comparing a
 * comment-only stripping with the full comment-and-string blanking at the
 * match position is what keeps those two cases out of the result.
 *
 * Regex literals are not stripped (see {@link stripCommentsAndStrings}); a
 * regex containing a fake import specifier would be reported, and no such
 * literal exists in this suite.
 * @param source - the file content.
 * @returns each offending import with its 1-based line and module specifier.
 */
const UPSTREAM_SOURCE_IMPORT =
  /\b(?:from|import|require)\s*\(?\s*['"](@deepseek-ai\/[a-z0-9-]+\/src\/[^'"\n]+)['"]/g

// This test-support package explicitly exports and publishes src. Its root also
// loads browser-loader bundles, so its independent pure fixture uses this entry.
const PUBLISHED_TEST_SUPPORT_ENTRIES = new Set([
  '@deepseek-ai/dsh-client-test-runtime/src/translate.ts',
  '@deepseek-ai/dsh-client-test-runtime/src/assembly/roster.ts',
  '@deepseek-ai/dsh-client-test-runtime/src/assembly/test-client.ts',
  '@deepseek-ai/dsh-client-test-runtime/src/assembly/remote-default-responses.ts',
])

/**
 * @param {string} source
 * @returns {Array<{ line: number, specifier: string }>} each offending import with its 1-based line and module specifier.
 */
export function upstreamSourceImportsOf(source) {
  const noComments = stripCommentsAndStrings(source, false)
  const codeOnly = stripCommentsAndStrings(source)
  const found = []
  for (const match of noComments.matchAll(UPSTREAM_SOURCE_IMPORT)) {
    if (codeOnly[match.index] === ' ') continue
    if (PUBLISHED_TEST_SUPPORT_ENTRIES.has(match[1])) continue
    found.push({
      line: noComments.slice(0, match.index).split('\n').length,
      specifier: match[1],
    })
  }
  return found
}

/**
 * The primitives a client spec may not replace wholesale.
 *
 * The harness UI bundle is what the plugin ships against, and a local visual
 * stub once grew to 711 lines standing in for it: its `Button`/`Tag`/`Menu`
 * answered props the real components do not, so a spec could pass on a DOM the
 * product never renders. A spec may replace one export through
 * `importOriginal` (a clipboard spy, a counting wrapper), but the module itself
 * stays real.
 */
const PRIMITIVE_MODULES = ['@deepseek-ai/dsh-client-ui-primitives']
const WHOLESALE_PRIMITIVE_MOCK = new RegExp(
  String.raw`vi\.mock\(\s*['"](${PRIMITIVE_MODULES.join('|')})['"]\s*,\s*(?:async\s+)?(?:function\s*)?\((?!\s*(?:importOriginal|importAct))`,
  'g',
)
// A factory that takes no argument at all (`async () => ...`) is wholesale too.
const NO_ARG_PRIMITIVE_MOCK = new RegExp(
  String.raw`vi\.mock\(\s*['"](${PRIMITIVE_MODULES.join('|')})['"]\s*,\s*(?:async\s+)?(?:function\s*)?\(\s*\)`,
  'g',
)
// The AST walk below enforces these two patterns; the compiled regexes are kept
// as their readable spellings, and the references keep them read.
void WHOLESALE_PRIMITIVE_MOCK
void NO_ARG_PRIMITIVE_MOCK

/**
 * Each offending primitive mock with its 1-based line.
 * @param {string} source - the spec's content.
 * @returns {Array<{ line: number, module: string }>} the violations.
 */
export function wholesalePrimitiveMocksOf(source) {
  const nodes = /** @type {ReadonlyArray<{ node: any, parent: any }>} */ (sourceNodes(source))
  const bindings = new Map()
  const aliases = new Set(['vi', 'vitest'])
  for (const { node } of nodes) {
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier')
      bindings.set(node.id.name, node.init)
    if (node.type === 'ImportDeclaration' && node.source.value === 'vitest')
      for (const entry of node.specifiers)
        if (['vi', 'vitest'].includes(entry.imported?.name)) aliases.add(entry.local.name)
  }
  /** @param {any} [node] a Babel AST fragment; `@babel/parser` ships no usable node types. @param {Set<string>} [visited] @returns {string | undefined} */
  const stringOf = (node, visited = new Set()) => {
    if (node?.type === 'StringLiteral') return node.value
    if (node?.type === 'Identifier' && !visited.has(node.name))
      return stringOf(bindings.get(node.name), new Set([...visited, node.name]))
    if (node?.type === 'BinaryExpression' && node.operator === '+') {
      const left = stringOf(node.left, visited),
        right = stringOf(node.right, visited)
      if (left !== undefined && right !== undefined) return left + right
    }
  }
  /** @param {any} factory @returns {boolean} */
  const partialFactory = (factory) => {
    if (factory?.type === 'Identifier') factory = bindings.get(factory.name)
    if (!['ArrowFunctionExpression', 'FunctionExpression'].includes(factory?.type)) return false
    const importer = factory.params[0]?.name
    if (!importer) return false
    /** @param {any} [node] @returns {boolean} */
    const originalCall = (node) => {
      if (node?.type === 'AwaitExpression') return originalCall(node.argument)
      return node?.type === 'CallExpression' && node.callee.name === importer
    }
    const originals = new Set()
    /** @type {any[]} */
    const own = []
    /** @param {any} [node] */
    const walk = (node) => {
      if (!node || typeof node !== 'object') return
      if (
        node !== factory &&
        ['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(node.type)
      )
        return
      own.push(node)
      for (const [key, value] of Object.entries(node)) {
        if (['loc', 'comments', 'tokens'].includes(key)) continue
        if (Array.isArray(value)) value.forEach(walk)
        else if (value && typeof value === 'object') walk(value)
      }
    }
    walk(factory)
    for (const node of own)
      if (
        node.type === 'VariableDeclarator' &&
        originalCall(node.init) &&
        node.id.type === 'Identifier'
      )
        originals.add(node.id.name)
    /** @param {any} [node] @returns {boolean} */
    const preservesOriginal = (node) => {
      if (node?.type === 'ConditionalExpression')
        return preservesOriginal(node.consequent) && preservesOriginal(node.alternate)
      return (
        node?.type === 'ObjectExpression' &&
        node.properties.some(
          /** @param {any} property */ (property) =>
            property.type === 'SpreadElement' &&
            (originalCall(property.argument) ||
              (property.argument.type === 'Identifier' && originals.has(property.argument.name))),
        )
      )
    }
    const results =
      factory.body.type === 'BlockStatement'
        ? own.filter((node) => node.type === 'ReturnStatement').map((node) => node.argument)
        : [factory.body]
    return results.length > 0 && results.every(preservesOriginal)
  }
  return nodes.flatMap(({ node }) => {
    if (
      node.type !== 'CallExpression' ||
      node.callee.type !== 'MemberExpression' ||
      !aliases.has(node.callee.object?.name)
    )
      return []
    const method = node.callee.computed ? node.callee.property.value : node.callee.property.name
    if (!['mock', 'doMock'].includes(method)) return []
    const name = stringOf(node.arguments[0])
    if (name !== '@deepseek-ai/dsh-client-ui-primitives') return []
    return partialFactory(node.arguments[1]) ? [] : [{ line: node.loc.start.line, module: name }]
  })
}

/** No client spec may replace the host primitives bundle wholesale. */
function checkPrimitiveMocks() {
  for (const path of filesUnder(join(root, 'tests', 'client'))) {
    if (!/\.spec\.(?:[cm]?ts|tsx)$/.test(path)) continue
    const source = readFileSync(path, 'utf8')
    for (const violation of wholesalePrimitiveMocksOf(source)) {
      failures.push(
        [
          `${relative(root, path)}:${violation.line} replaces ${violation.module} wholesale`,
          `  fix: use the real bundle; replace a single export through importOriginal when a platform seam must be observed`,
        ].join('\n'),
      )
    }
  }
}

/** No source or spec may import an upstream package's unpublished source tree. */
function checkUpstreamSourceImports() {
  const sourceFile = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/
  for (const dir of ['src', 'tests']) {
    for (const path of filesUnder(join(root, dir))) {
      if (!sourceFile.test(path)) continue
      const source = readFileSync(path, 'utf8')
      for (const violation of upstreamSourceImportsOf(source)) {
        failures.push(
          [
            `${relative(root, path)}:${violation.line} imports ${violation.specifier}`,
            `  fix: use the package's public entry, or declare the contract locally; the published tarball ships no src tree`,
          ].join('\n'),
        )
      }
    }
  }
}

/**
 * The package's undici copy has exactly one owner.
 *
 * A dispatcher built from one undici major is rejected by the fetch from
 * another at the handler interface (`UND_ERR_INVALID_ARG: invalid
 * onRequestStart method`) before a socket opens. `connections.ts` therefore
 * owns both the `Agent` factories and `publicFetch`; every external transport
 * injects that fetch. The runtime's global `fetch` stays reserved for loopback
 * and browser calls. The scholarly specs must stub the seam, never the global,
 * or they assert the mechanism of the bug they exist to catch.
 */
/**
 * The fetch-ownership violations in one source file, as formatted findings.
 * Exported so the guard's own spec exercises the rule instead of trusting it.
 * @param {string} rel - the repo-relative path.
 * @param {string} source - the file's content.
 * @returns {string[]} one formatted violation per offending line.
 */
export function fetchOwnershipIssuesOf(rel, source) {
  const owner = 'src/transport/connections.ts'
  const allowed = new Set([owner, 'src/http-client.ts', 'src/write-http.ts'])
  /** @type {string[]} */
  const issues = []
  const seen = new Set()
  /** @param {any} node a Babel AST fragment; `@babel/parser` ships no usable node types. @param {string} message */
  const add = (node, message) => {
    const line = node.loc.start.line
    const key = `${line}:${message}`
    if (seen.has(key)) return
    seen.add(key)
    issues.push(`${rel}:${line} ${message} — use the publicFetch seam from ${owner}`)
  }
  for (const { node, parent } of /** @type {ReadonlyArray<{ node: any, parent: any }>} */ (
    sourceNodes(source)
  )) {
    if (rel.startsWith('src/')) {
      if (node.type === 'ImportDeclaration' && node.source.value === 'undici' && rel !== owner)
        add(node, 'imports undici')
      if (node.type === 'ImportExpression' && node.source.value === 'undici' && rel !== owner)
        add(node, 'imports undici')
      if (rel.startsWith('src/client/') || allowed.has(rel)) continue
      if (
        node.type === 'VariableDeclarator' &&
        node.id.type === 'ObjectPattern' &&
        ['window', 'globalThis', 'self'].includes(node.init?.name) &&
        node.id.properties.some(
          /** @param {any} property */ (property) =>
            (property.key?.name ?? property.key?.value) === 'fetch',
        )
      )
        add(node, 'uses the runtime fetch')
      if (node.type === 'Identifier' && node.name === 'fetch') {
        if (
          parent?.type?.startsWith('TS') ||
          (['MemberExpression', 'OptionalMemberExpression'].includes(parent?.type) &&
            parent.property === node &&
            !parent.computed) ||
          (parent?.type === 'ObjectProperty' && parent.key === node && !parent.shorthand) ||
          ['ImportSpecifier', 'ImportDefaultSpecifier'].includes(parent?.type)
        )
          continue
        add(node, 'uses the runtime fetch')
      }
      if (
        ['MemberExpression', 'OptionalMemberExpression'].includes(node.type) &&
        ['window', 'globalThis', 'self'].includes(node.object?.name) &&
        (node.computed ? node.property.value : node.property.name) === 'fetch'
      )
        add(node, 'uses the runtime fetch')
    } else if (rel.startsWith('tests/scholarly/')) {
      if (
        node.type === 'CallExpression' &&
        node.callee.type === 'MemberExpression' &&
        ['vi', 'vitest'].includes(node.callee.object?.name) &&
        ['stubGlobal', 'spyOn'].includes(node.callee.property?.name) &&
        node.arguments.some(/** @param {any} arg */ (arg) => arg.value === 'fetch')
      )
        add(node, 'stubs the runtime fetch')
      if (
        node.type === 'AssignmentExpression' &&
        node.left.type === 'MemberExpression' &&
        ['window', 'globalThis', 'self'].includes(node.left.object?.name) &&
        (node.left.computed ? node.left.property.value : node.left.property.name) === 'fetch'
      )
        add(node, 'stubs the runtime fetch')
    }
  }
  return issues
}

function checkFetchOwnership() {
  const sourceFile = /\.(?:ts|tsx|mts|cts)$/
  const roots = [join(root, 'src'), join(root, 'tests', 'scholarly')]
  for (const path of roots.flatMap((dir) => filesUnder(dir))) {
    if (!sourceFile.test(path)) continue
    failures.push(...fetchOwnershipIssuesOf(relative(root, path), readFileSync(path, 'utf8')))
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  const largest = checkSpecSize()
  const helpers = checkHelperSize()
  checkTextFiles()
  checkExtensionCoverage()
  checkLanes()
  checkFocus()
  checkUpstreamSourceImports()
  checkFetchOwnership()
  checkPrimitiveMocks()
  failures.push(
    ...fakeIpPolicyIssues(
      filesUnder(join(root, 'src'))
        .filter((path) => /\.(?:ts|tsx)$/.test(path))
        .map((path) => [relative(root, path).replaceAll('\\', '/'), readFileSync(path, 'utf8')]),
    ),
  )

  if (failures.length > 0) {
    process.stderr.write(`test-lint: ${failures.length} problem(s)\n\n`)
    for (const failure of failures) process.stderr.write(`${failure}\n\n`)
    process.exit(1)
  }

  process.stdout.write(
    `test-lint: ok — ${specFiles().length} specs, largest ${largest}, ${helpers}, lane ratchet ${SPEC_LANES.map((name) => name || '.').join('/')}\n`,
  )
}
