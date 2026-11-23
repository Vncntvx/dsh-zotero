/** Validate documented model calls, parameter tables, and outputs against the composed tools. */
import { readFileSync, readdirSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import { createVolatile } from '@deepseek-ai/cosmokit'
import { mountSystemPrompt } from '../helpers/lanes/tool-context.js'
import ToolRuntime, {
  validateJsonSchemaValue,
  type ObjectJsonSchema,
  type ToolDefinition,
} from '@deepseek-ai/dsh-tools'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import ZoteroService from '../../src/index.js'
import EnrichmentService from '../../src/enrichment/service.js'
import { ScholarlyService } from '../../src/scholarly/service.js'
import { SCHOLARLY_TOOL_NAMES } from '../../src/scholarly/types.js'
import {
  PARSED_SEARCH_TOOL,
  SCHOLARLY_SAVE_TOOL_NAME,
  ZOTERO_TOOL_NAMES,
} from '../../src/constants.js'
import { isRefString } from '../../src/refs.js'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'

/** Every model tool the plugin components can register. */
const ALL_TOOL_NAMES: readonly string[] = [
  ...ZOTERO_TOOL_NAMES,
  ...SCHOLARLY_TOOL_NAMES,
  SCHOLARLY_SAVE_TOOL_NAME,
  PARSED_SEARCH_TOOL,
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
import {
  asJsonLiteral,
  docDefaultOf,
  PROSE_DEFAULT,
  UNRECOGNIZED_DEFAULT,
} from './support/doc-literals.js'

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

/**
 * Quote bare object keys so a JS-style literal parses as JSON, in both
 * spellings the docs print: `key: value` and `key=value`. The second spelling
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

describe('the doc-example literal reader', () => {
  it('reads both object-key spellings the documents print', () => {
    // `key: value` is the form the examples use after this round; `key=value`
    // is the spelling a nested JavaScript-style object may still carry. One
    // reading that only handled the first would drop those calls silently.
    expect(asJsonLiteral('{kind: "ref", ref: "x"}')).toBe('{"kind": "ref", "ref": "x"}')
    expect(asJsonLiteral('{kind="ref", ref="x"}')).toBe('{"kind": "ref", "ref": "x"}')
    expect(JSON.parse(asJsonLiteral('{kind="ref", ref="zotero://user/0/item/ABCD1234"}'))).toEqual({
      kind: 'ref',
      ref: 'zotero://user/0/item/ABCD1234',
    })
  })
})

describe('documented tool calls match the tool schemas', () => {
  let ctx: Context
  const examples: DocExample[] = []
  const files = docFiles()

  beforeAll(async () => {
    ctx = new Context()
    await mountSystemPrompt(ctx)
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
    await ctx.plugin(EnrichmentService, {})
    for (const file of files) examples.push(...examplesIn(file))
  })

  afterAll(async () => {
    await ctx.fiber.dispose()
  })

  it('finds examples in the documents that carry them', () => {
    // A parser that silently matched nothing would pass every later check;
    // this count is the guard that the scan still covers what it claims to.
    expect(examples.length).toBeGreaterThan(20)
    for (const file of ['docs/tools.md', 'docs/tools.en.md']) {
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
    // Check names separately so documentation failures name the exact misspelling;
    // the registered closed schema also refuses these at execution.
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

  it('documents every output discriminator arm in each tool section', () => {
    const armsOf = (value: unknown): string[] => {
      if (value === null || typeof value !== 'object') return []
      const schema = value as {
        oneOf?: unknown[]
        properties?: Record<string, { const?: unknown; enum?: unknown[] }>
      }
      if (schema.oneOf) return [...new Set(schema.oneOf.flatMap(armsOf))]
      const properties = schema.properties ?? {}
      if (properties.delivery?.const === 'inline') return armsOf(properties.data)
      if (properties.delivery?.const === 'file') return []
      return ['kind', 'mode'].flatMap((name) => {
        const field = properties[name]
        return field === undefined
          ? []
          : [field.const, ...(field.enum ?? [])].filter(
              (entry): entry is string => typeof entry === 'string',
            )
      })
    }
    const violations: string[] = []
    for (const file of ['docs/tools.md', 'docs/tools.en.md']) {
      const text = readFileSync(new URL(file, REPO_ROOT), 'utf8')
      for (const name of ALL_TOOL_NAMES) {
        const heading = new RegExp(`^#{2,3} ${name}\\s*$`, 'm').exec(text)
        if (heading === null) throw new Error(`Missing ${name}`)
        const section = text
          .slice(heading.index + heading[0].length)
          .split(/^#{2,3} (?:zotero_|scholarly_)/m)[0]!
        const arms = armsOf(ctx.tools.get(name)!.output.schema)
        for (const arm of arms)
          if (!section.includes(arm)) violations.push(`${file} ${name}: missing output arm ${arm}`)
        if (
          arms.includes('committed-unverified') &&
          !/(?:不可重试|不得重试|do not retry|must not retry|never retry|not retryable)/i.test(
            section,
          )
        )
          violations.push(
            `${file} ${name}: committed-unverified must explain that the committed write cannot be retried`,
          )
      }
    }
    expect(violations).toEqual([])
  })

  it('documents every canonical output field in both tool guides', () => {
    const fieldsOf = (value: unknown): string[] => {
      if (value === null || typeof value !== 'object') return []
      const schema = value as { oneOf?: unknown[]; properties?: Record<string, unknown> }
      if (Array.isArray(schema.oneOf)) return [...new Set(schema.oneOf.flatMap(fieldsOf))].sort()
      const properties = schema.properties ?? {}
      const delivery = properties.delivery as { const?: unknown } | undefined
      if (delivery?.const === 'inline') return fieldsOf(properties.data)
      if (delivery?.const === 'file') return [] // The shared delivery section documents the receipt envelope.
      return Object.keys(properties).sort()
    }
    for (const file of ['docs/tools.md', 'docs/tools.en.md']) {
      const text = readFileSync(new URL(file, REPO_ROOT), 'utf8')
      for (const name of ALL_TOOL_NAMES) {
        const heading = new RegExp(`^#{2,3} ${name}\\s*$`, 'm').exec(text)
        expect(heading, `${file}: ${name} heading`).not.toBeNull()
        const section = text
          .slice(heading!.index + heading![0].length)
          .split(/^#{2,3} (?:zotero_|scholarly_)/m)[0]!
        const inventory = section
          .split('\n')
          .find(
            (line) =>
              line.startsWith('输出字段（按结果臂）') ||
              line.startsWith('Output fields by result arm'),
          )
        expect(inventory, `${file}: ${name} output inventory`).toBeDefined()
        const documented = [...(inventory ?? '').matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)]
          .map((match) => match[1])
          .sort()
        expect(documented, `${file}: ${name}`).toEqual(fieldsOf(ctx.tools.get(name)!.output.schema))
      }
    }
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
          if (documentedDefault === UNRECOGNIZED_DEFAULT) {
            violations.push(
              `${file} ${name}.${row.name}: default cell ${JSON.stringify(row.defaultCell)} is not a supported literal`,
            )
            continue
          }
          // Recognized prose (required markers, config-derived defaults,
          // enumeration restatements) has no schema counterpart to compare.
          if (documentedDefault === PROSE_DEFAULT) continue
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

  it('parses every call the documents print, so no example is skipped silently', () => {
    // `examplesIn` skips an unparseable call on purpose (prose is not a call),
    // which also means a real example with one bad byte would vanish from
    // every check below. This walk counts the calls as printed.
    const violations: string[] = []
    for (const file of files) {
      const text = readFileSync(new URL(file, REPO_ROOT), 'utf8')
      for (const match of text.matchAll(/\b((?:zotero|scholarly)_[a-z_]+)\(/g)) {
        const line = lineAt(text, match.index)
        const parsed = examples.some(
          (example) => example.file === file && example.call === match[1] && example.line === line,
        )
        if (!parsed) violations.push(`${file}:${line} ${match[1]} does not parse`)
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
