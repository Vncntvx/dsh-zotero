#!/usr/bin/env node
/**
 * Audit the three client dictionaries for Chinese notice punctuation.
 *
 * A short Chinese notice (at most two sentences) omits its final 句号; a
 * three-sentence or longer body keeps normal punctuation. The script parses the
 * TypeScript sources with @babel/parser so multiline strings and template
 * literals are counted exactly once, then reports any short value ending in
 * `。`.
 *
 * Run with `node scripts/zh-copy-audit.mjs`; `--verbose` prints every entry.
 */
import { parse } from '@babel/parser'
import { readFileSync } from 'node:fs'

const FILES = [
  'src/client/locales.ts',
  'src/client/library-settings-locales.ts',
  'src/client/enrichment/parse-locales.ts',
]

const SENTENCE_END = /[。！？!?]/g

/**
 * Read the literal value of a string or template node.
 * @param {import('@babel/types').Node} node - a dictionary value node.
 * @returns {string | undefined} the cooked text, or undefined for non-literals.
 */
function stringValue(node) {
  if (node.type === 'StringLiteral') return node.value
  if (node.type === 'TemplateLiteral') {
    return node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join('${…}')
  }
  return undefined
}

/**
 * Collect the Chinese entries of one `export const zh` dictionary.
 * @param {string} source - the TypeScript source.
 * @param {string} file - its repository path, recorded on every entry.
 * @returns {{ file: string, key: string, value: string }[]} the entries.
 */
function zhProperties(source, file) {
  const ast = parse(source, {
    sourceType: 'module',
    plugins: ['typescript'],
  })
  const entries = []
  for (const statement of ast.program.body) {
    if (statement.type !== 'ExportNamedDeclaration') continue
    const declaration = statement.declaration
    if (declaration?.type !== 'VariableDeclaration') continue
    for (const declarator of declaration.declarations) {
      if (declarator.id.type !== 'Identifier' || declarator.id.name !== 'zh') continue
      if (declarator.init?.type !== 'ObjectExpression') continue
      for (const property of declarator.init.properties) {
        if (property.type !== 'ObjectProperty') continue
        const key =
          property.key.type === 'Identifier'
            ? property.key.name
            : property.key.type === 'StringLiteral'
              ? property.key.value
              : undefined
        if (key === undefined) continue
        const value = stringValue(property.value)
        if (value === undefined || !/[\u4e00-\u9fff]/.test(value)) continue
        entries.push({ file, key, value })
      }
    }
  }
  return entries
}

/**
 * Count sentence terminators in one notice.
 * @param {string} value - the notice text.
 * @returns {number} at least one.
 */
function sentenceCount(value) {
  const endings = value.match(SENTENCE_END)?.length ?? 0
  return endings === 0 ? 1 : endings
}

const verbose = process.argv.includes('--verbose')
const failures = []
let total = 0

for (const file of FILES) {
  const entries = zhProperties(readFileSync(file, 'utf8'), file)
  for (const entry of entries) {
    total += 1
    const count = sentenceCount(entry.value)
    if (verbose || (entry.value.endsWith('。') && count <= 2)) {
      console.log(`${file}\t${entry.key}\t${count}\t${entry.value}`)
    }
    if (entry.value.endsWith('。') && count <= 2) {
      failures.push(`${file}:${entry.key} (${count} sentence(s)) ends with 句号`)
    }
  }
}

if (failures.length > 0) {
  console.error(`zh-copy-audit: ${failures.length} short notice(s) keep a trailing 句号`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`zh-copy-audit ok: ${total} Chinese values across ${FILES.length} dictionaries`)
