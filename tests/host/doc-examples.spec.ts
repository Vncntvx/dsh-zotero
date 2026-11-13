/**
 * Every `zotero_*` call printed in the docs is checked against the tool's own
 * parameter schema, with the same validator the host runs before executing a
 * call. Documentation drift here is not cosmetic: a README example that names
 * `itemType` where the schema says `itemTypes`, or a lowercase `ref` where it
 * must be a ref string, teaches the model a call that the tool rejects.
 *
 * The scan is whole-document, not line-by-line: a printed call may wrap its
 * arguments over several lines (`zotero_batch_items` does), and a line-based
 * scan silently skipped exactly those. It also covers every document that
 * prints calls, discovered from the tree rather than listed by hand, so a new
 * doc cannot escape the check.
 *
 * Two more invariants ride here because they are the same class of drift: every
 * registered `zotero_*` tool prints at least one parseable example, and every
 * tool's parameter table names exactly the schema's parameters. A tool that
 * gains a parameter without a table row teaches a reader nothing about it; a
 * table row for a parameter the tool does not declare teaches a call that is
 * rejected.
 *
 * The check is schema-level on purpose. Whether an example's *values* would
 * succeed against a live library (a ref that exists, a style Zotero bundles)
 * is a different question the docs deliberately leave illustrative: the
 * schema is the part a reader cannot see and the part that silently rots.
 * @module tests/doc-examples
 */

import { readFileSync, readdirSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import { createVolatile } from '@deepseek-ai/cosmokit'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, {
  validateJsonSchemaValue,
  type ObjectJsonSchema,
  type ToolDefinition,
} from '@deepseek-ai/dsh-tools'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import ZoteroService from '../../src/index.js'
import { ScholarlyService } from '../../src/scholarly/service.js'
import { SCHOLARLY_TOOL_NAMES } from '../../src/scholarly/types.js'
import { SCHOLARLY_SAVE_TOOL_NAME, ZOTERO_TOOL_NAMES } from '../../src/constants.js'
import { isRefString } from '../../src/refs.js'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'

/** Every model tool both components can register. */
const ALL_TOOL_NAMES: readonly string[] = [
  ...ZOTERO_TOOL_NAMES,
  ...SCHOLARLY_TOOL_NAMES,
  SCHOLARLY_SAVE_TOOL_NAME,
]

/**
 * The repo root, resolved from this spec's own location. Resolving from
 * `process.cwd()` instead would silently depend on where vitest was started,
 * and a run from another directory would pass by scanning the wrong tree.
 */
import {
  COMPOSITION_DEPENDENT_MARKERS,
  COMPOSITION_DEPENDENT_PARAMETERS,
  isCompositionDependent,
} from './support/composition-dependent-parameters.js'

const REPO_ROOT = new URL('../../', import.meta.url)

/**
 * Every document that may print a call: both READMEs and every `docs/*.md`,
 * discovered so a new page cannot be added outside the check.
 */
function docFiles(): string[] {
  const docs = readdirSync(new URL('docs/', REPO_ROOT))
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => `docs/${name}`)
  return ['README.md', 'README.en.md', ...docs]
}

/**
 * Tools that print no call example on purpose, with the reason. A registered
 * tool belongs here only when an example would mislead: everything else owes
 * one.
 */
const EXAMPLE_EXEMPT: Readonly<Record<string, string>> = {}

/** One `zotero_*(...)` call found in a doc, with where it was printed. */
interface DocExample {
  readonly file: string
  readonly line: number
  readonly call: string
  readonly args: Record<string, unknown>
}

/** Quote bare object keys so a JS-style literal parses as JSON. */
function asJsonLiteral(source: string): string {
  return source.replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3')
}

/**
 * The argument list of a call, split at its top-level commas. Nesting and
 * quoted strings are respected so an object argument's own commas stay in it,
 * and newlines are ordinary characters here: an example may wrap.
 */
function splitArguments(source: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | undefined
  let start = 0
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!
    if (quote !== undefined) {
      if (char === '\\') index += 1
      else if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '{' || char === '[' || char === '(') depth += 1
    else if (char === '}' || char === ']' || char === ')') depth -= 1
    else if (char === ',' && depth === 0) {
      parts.push(source.slice(start, index))
      start = index + 1
    }
  }
  const tail = source.slice(start)
  if (tail.trim() !== '') parts.push(tail)
  return parts.map((part) => part.trim())
}

/** The text inside a call's parentheses, honoring nesting; `undefined` when unbalanced. */
function callBody(text: string, openIndex: number): string | undefined {
  let depth = 0
  let quote: string | undefined
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index]!
    if (quote !== undefined) {
      if (char === '\\') index += 1
      else if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return text.slice(openIndex + 1, index)
    }
  }
  return undefined
}

/** The one-based line a character offset sits on. */
function lineAt(text: string, offset: number): number {
  let line = 1
  for (let index = 0; index < offset; index += 1) {
    if (text[index] === '\n') line += 1
  }
  return line
}

/**
 * Every parseable `zotero_*` example in one document. Text that is not a call
 * is skipped, and so is a call whose arguments are placeholder text rather than
 * values.
 */
function examplesIn(file: string): DocExample[] {
  const found: DocExample[] = []
  const text = readFileSync(new URL(file, REPO_ROOT), 'utf8')
  const pattern = /\b((?:zotero|scholarly)_[a-z_]+)\(/g
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const body = callBody(text, match.index + match[0].length - 1)
    if (body === undefined) continue
    const args: Record<string, unknown> = {}
    let parseable = true
    for (const part of splitArguments(body)) {
      if (part === '') continue
      const assignment = /^([A-Za-z_][\w]*)\s*[:=]\s*([\s\S]+)$/.exec(part)
      if (assignment === null) {
        parseable = false
        break
      }
      try {
        args[assignment[1]!] = JSON.parse(asJsonLiteral(assignment[2]!))
      } catch {
        parseable = false
        break
      }
    }
    if (!parseable) continue
    found.push({ file, line: lineAt(text, match.index), call: match[1]!, args })
  }
  return found
}

/** The parameters one tool's documentation table names, in table order. */
function documentedRows(
  file: string,
  call: string,
): Array<{ readonly name: string; readonly defaultCell?: string }> {
  const text = readFileSync(new URL(file, REPO_ROOT), 'utf8')
  // Core tools use `##`, the scholarly chapter nests its tools under it.
  const heading = new RegExp(`^#{2,3} ${call}$`, 'm').exec(text)
  if (heading === null) return []
  const level = /^#+/.exec(heading[0])![0].length
  const rest = text.slice(heading.index + heading[0].length)
  // Cut at the next heading of the tool's own level or higher; its parameter
  // table is a deeper heading.
  const nextSection = new RegExp(`^#{1,${level}} `, 'm').exec(rest)
  const section = nextSection === null ? rest : rest.slice(0, nextSection.index)
  const tableHeading = /^#{3,4} (?:Parameters|参数)[^\n]*$/m.exec(section)
  if (tableHeading === null) return []
  const table = section.slice(tableHeading.index + tableHeading[0].length)
  const end = /^#{2,4} /m.exec(table)
  const rows = (end === null ? table : table.slice(0, end.index)).split('\n')
  let nameIndex = 0
  let defaultIndex: number | undefined
  let header = false
  const found: Array<{ name: string; defaultCell?: string }> = []
  for (const row of rows) {
    if (!row.trimStart().startsWith('|')) {
      if (header) break
      continue
    }
    const cells = row
      .replace(/\\\|/g, '\u0000')
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.replace(/\u0000/g, '|').trim())
    if (!header) {
      const parameterIndex = cells.findIndex((cell) => /^(Parameter|参数)$/.test(cell))
      if (parameterIndex === -1) continue
      nameIndex = parameterIndex
      const foundDefault = cells.findIndex((cell) => /^(Default|默认值)$/.test(cell))
      defaultIndex = foundDefault === -1 ? undefined : foundDefault
      header = true
      continue
    }
    if (cells.every((cell) => /^-+$/.test(cell))) continue
    const name = /^`([A-Za-z_][\w]*)`$/.exec(cells[nameIndex] ?? '')
    if (name === null) continue
    found.push({
      name: name[1]!,
      ...(defaultIndex === undefined ? {} : { defaultCell: cells[defaultIndex] ?? '' }),
    })
  }
  return found
}

/** A default cell that is prose rather than a value; not comparable. */
const UNPARSED = Symbol('unparsed')

/** One documented default cell as a JSON value, undefined for "none", or prose. */
function docDefaultOf(cell: string | undefined): unknown {
  if (cell === undefined) return UNPARSED
  const value = cell.replace(/^`|`$/g, '').trim()
  if (value === '' || value === '—' || value === '-' || value === 'none' || value === '无') {
    return undefined
  }
  // Required markers and prose ("config cap") are not defaults.
  if (/^(✓|required|必填|config cap|配置上限)$/.test(value)) return UNPARSED
  try {
    return JSON.parse(value)
  } catch {
    return UNPARSED
  }
}

describe('documented tool calls match the tool schemas', () => {
  let ctx: Context
  const examples: DocExample[] = []
  const files = docFiles()

  beforeAll(async () => {
    ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime, {})
    // The real registry, with one controller so an owned job is admissible.
    await ctx.plugin(LocalJobRegistry, {})
    ctx.jobs.attachController('doc examples')
    await ctx.plugin(ZoteroService, {
      baseUrl: 'http://127.0.0.1:23119/api',
      // The write tools document real examples; the gate validates them
      // against the same schemas, so the flag has to be on here.
      writeEnabled: true,
    })
    // The scholarly component documents seven more tools in the same chapter;
    // mounting it keeps their examples and tables under the same gate.
    new ScholarlyService(ctx, { email: createVolatile('doc-examples@example.edu') })
    for (const file of files) examples.push(...examplesIn(file))
  })

  afterAll(async () => {
    await ctx.fiber.dispose()
  })

  it('finds examples in the documents that carry them', () => {
    // A parser that silently matched nothing would pass every later check;
    // this count is the guard that the scan still covers what it claims to.
    expect(examples.length).toBeGreaterThan(20)
    for (const file of ['README.md', 'README.en.md', 'docs/tools.md', 'docs/tools.en.md']) {
      expect(examples.filter((example) => example.file === file).length).toBeGreaterThan(0)
    }
  })

  it('prints a parseable example for every registered tool', () => {
    // A tool with no example leaves the model to guess at argument names; the
    // docs are the only surface that shows a whole call.
    const missing = ALL_TOOL_NAMES.filter((name) => EXAMPLE_EXEMPT[name] === undefined)
      .filter((name) => !examples.some((example) => example.call === name))
      .sort()
    expect(missing).toEqual([])
  })

  it('names only registered tools', () => {
    const unknown = examples
      .filter((example) => ctx.tools.get(example.call) === undefined)
      .map((example) => `${example.file}:${example.line} ${example.call}`)
    expect(unknown).toEqual([])
  })

  it('names only declared parameters', () => {
    // The compiled parameter schema is an open object, so an unknown argument
    // passes the host's validator and is then ignored at execution time: a
    // docs example with `itemType` where the tool wants `itemTypes` reads as
    // a working filter and silently is none.
    const violations: string[] = []
    for (const example of examples) {
      const tool = ctx.tools.get(example.call)
      if (tool === undefined) continue
      const declared = Object.keys(
        (tool.parameters as unknown as { properties?: Record<string, unknown> }).properties ?? {},
      )
      for (const name of Object.keys(example.args)) {
        if (declared.includes(name)) continue
        violations.push(
          `${example.file}:${example.line} ${example.call}: unknown parameter "${name}" (declared: ${declared.join(', ')})`,
        )
      }
    }
    expect(violations).toEqual([])
  })

  it('documents exactly the declared parameters in the tool reference', () => {
    const violations: string[] = []
    for (const file of ['docs/tools.md', 'docs/tools.en.md']) {
      for (const name of ALL_TOOL_NAMES) {
        const tool = ctx.tools.get(name)
        if (tool === undefined) continue
        const properties =
          (
            tool.parameters as unknown as {
              properties?: Record<string, { type?: unknown; default?: unknown }>
            }
          ).properties ?? {}
        const declared = Object.keys(properties).sort()
        const rows = documentedRows(file, name)
        const documented = rows.map((row) => row.name).sort()
        if (documented.length === 0) {
          violations.push(`${file} ${name}: no parameter table`)
          continue
        }
        const missing = declared.filter(
          (parameter) =>
            !documented.includes(parameter) && !isCompositionDependent(name, parameter),
        )
        const extra = documented.filter((parameter) => !declared.includes(parameter))
        if (missing.length > 0) {
          violations.push(`${file} ${name}: table omits ${missing.join(', ')}`)
        }
        if (extra.length > 0) {
          violations.push(`${file} ${name}: table names undeclared ${extra.join(', ')}`)
        }
        // A default is part of the call the docs teach: a schema default that
        // moves while the table keeps the old value is a silent behavior change.
        for (const row of rows) {
          const property = properties[row.name]
          if (property === undefined) continue
          const documentedDefault = docDefaultOf(row.defaultCell)
          if (documentedDefault === UNPARSED) continue
          if (JSON.stringify(documentedDefault) !== JSON.stringify(property.default)) {
            violations.push(
              `${file} ${name}.${row.name}: default is ${JSON.stringify(documentedDefault)}, schema says ${JSON.stringify(property.default)}`,
            )
          }
        }
        const prose = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
        if (
          Object.keys(COMPOSITION_DEPENDENT_PARAMETERS).includes(name) &&
          !COMPOSITION_DEPENDENT_MARKERS.some((marker) => prose.includes(marker))
        ) {
          violations.push(`${file} ${name}: composition-dependent parameters need the prose marker`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('prints only refs the ref grammar accepts', () => {
    // An example ref is copied verbatim. A six-character key or a
    // `saved-search` kind reads as a working ref and fails as
    // `ZERO_INVALID_REF`; the schema check cannot see either, because a string
    // is a string to it.
    const violations: string[] = []
    for (const file of files) {
      const text = readFileSync(new URL(file, REPO_ROOT), 'utf8')
      for (const match of text.matchAll(/zotero:\/\/[^\s"'\)\]`,]*/g)) {
        const value = match[0]!
        // Placeholder spellings teach the shape, not a usable ref.
        if (/[<>{}]/.test(value)) continue
        if (value === 'zotero://' || value.endsWith('/')) continue
        if (isRefString(value)) continue
        violations.push(`${file}:${lineAt(text, match.index)} ${value}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('passes every example through the tool parameter validator', () => {
    const violations: string[] = []
    for (const example of examples) {
      const tool: ToolDefinition | undefined = ctx.tools.get(example.call)
      if (tool === undefined) continue
      const errors = validateJsonSchemaValue(
        tool.parameters as unknown as ObjectJsonSchema,
        example.args,
        '',
      )
      for (const error of errors) {
        violations.push(`${example.file}:${example.line} ${example.call}: ${error}`)
      }
    }
    expect(violations).toEqual([])
  })
})
