/**
 * Every `zotero_*` call printed in the docs is checked against the tool's own
 * parameter schema, with the same validator the host runs before executing a
 * call. Documentation drift here is not cosmetic: a README example that names
 * `itemType` where the schema says `itemTypes`, or a lowercase `ref` where it
 * must be a ref string, teaches the model a call that the tool rejects.
 *
 * The check is schema-level on purpose. Whether an example's *values* would
 * succeed against a live library (a ref that exists, a style Zotero bundles)
 * is a different question the docs deliberately leave illustrative: the
 * schema is the part a reader cannot see and the part that silently rots.
 * @module tests/doc-examples
 */

import { readFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, {
  validateJsonSchemaValue,
  type ObjectJsonSchema,
  type ToolDefinition,
} from '@deepseek-ai/dsh-tools'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import ZoteroService from '../../src/index.js'
import { TestJobRegistry } from '../helpers/fake-jobs.js'

/**
 * The repo root, resolved from this spec's own location. Resolving from
 * `process.cwd()` instead would silently depend on where vitest was started,
 * and a run from another directory would pass by scanning the wrong tree.
 */
const REPO_ROOT = new URL('../../', import.meta.url)

/** Docs every example in them is held to. */
const DOC_FILES = [
  'README.md',
  'README.en.md',
  'docs/tools.md',
  'docs/tools.en.md',
  'docs/features.md',
  'docs/features.en.md',
  'docs/getting-started.md',
  'docs/getting-started.en.md',
  'docs/configuration.md',
  'docs/configuration.en.md',
  'docs/architecture.md',
  'docs/architecture.en.md',
  'docs/scenarios.md',
  'docs/scenarios.en.md',
]

/** The documents that carry call examples today. */
const EXPECTED_SOURCES = ['README.md', 'README.en.md', 'docs/tools.md', 'docs/tools.en.md']

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
 * quoted strings are respected so an object argument's own commas stay in it.
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

/** The text inside a call's parentheses, honoring nested parentheses. */
function callBody(line: string, openIndex: number): string | undefined {
  let depth = 0
  let quote: string | undefined
  for (let index = openIndex; index < line.length; index += 1) {
    const char = line[index]!
    if (quote !== undefined) {
      if (char === '\\') index += 1
      else if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return line.slice(openIndex + 1, index)
    }
  }
  return undefined
}

/**
 * Every parseable `zotero_*` example in one document. Lines that are not a
 * call (prose, result descriptions) are skipped, and so is a call whose
 * arguments are placeholder text rather than values.
 */
function examplesIn(file: string): DocExample[] {
  const found: DocExample[] = []
  const lines = readFileSync(new URL(file, REPO_ROOT), 'utf8').split('\n')
  lines.forEach((line, index) => {
    const pattern = /\b(zotero_[a-z_]+)\(/g
    for (let match = pattern.exec(line); match !== null; match = pattern.exec(line)) {
      const body = callBody(line, match.index + match[0].length - 1)
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
      found.push({
        file,
        line: index + 1,
        call: match[1]!,
        args,
      })
    }
  })
  return found
}

describe('documented tool calls match the tool schemas', () => {
  let ctx: Context
  const examples: DocExample[] = []

  beforeAll(async () => {
    ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime, {})
    await ctx.plugin(TestJobRegistry)
    await ctx.plugin(ZoteroService, {
      baseUrl: 'http://127.0.0.1:23119/api',
      // The write tools document real examples; the gate validates them
      // against the same schemas, so the flag has to be on here.
      writeEnabled: true,
    })
    for (const file of DOC_FILES) examples.push(...examplesIn(file))
  })

  afterAll(async () => {
    await ctx.fiber.dispose()
  })

  it('finds examples in the documents that carry them', () => {
    // A parser that silently matched nothing would pass every later check;
    // these counts are the guard that this test still covers what it claims
    // to. Other docs are still scanned: they simply have no calls today.
    expect(examples.length).toBeGreaterThan(20)
    for (const file of EXPECTED_SOURCES) {
      expect(examples.filter((example) => example.file === file).length).toBeGreaterThan(0)
    }
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
