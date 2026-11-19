/** Locale usage includes static keys and the finite key transforms used by settings forms. */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parse } from '@babel/parser'

/**
 * @param {string} root
 * @returns {Array<[string, string]>} the `[path, source]` pairs.
 */
export function clientLocaleSources(root) {
  /** @type {Array<[string, string]>} */
  const sources = []
  /** @param {string} dir */
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (/\.tsx?$/.test(path) && !/locales\.ts$/.test(path))
        sources.push([relative(root, path), readFileSync(path, 'utf8')])
    }
  }
  visit(join(root, 'src/client'))
  return sources
}

/**
 * @param {ReadonlyArray<string>} keys
 * @param {ReadonlyArray<readonly [string, string]>} sources
 * @returns {string[]} the keys no client source mentions.
 */
export function unusedLocaleKeys(keys, sources) {
  const literals = new Set()
  /** @param {any} [node] a Babel AST fragment; `@babel/parser` ships no usable node types. */
  function visit(node) {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (node.type === 'StringLiteral') literals.add(node.value)
    for (const [key, child] of Object.entries(node))
      if (
        ![
          'loc',
          'extra',
          'comments',
          'leadingComments',
          'trailingComments',
          'innerComments',
        ].includes(key)
      )
        visit(child)
  }
  for (const [path, source] of sources)
    visit(
      parse(source, {
        sourceType: 'module',
        plugins: path.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'],
      }),
    )
  const used = new Set(literals)
  for (const key of literals) {
    // ZoteroSettingsForm/CitationDefaultsForm: key + Hint; group key + Desc.
    used.add(key + 'Hint')
    used.add(key + 'Desc')
    // ScholarlySettingsForm's value and secret fields capitalize the actual field key.
    const scholarly = 'scholarly' + key.charAt(0).toUpperCase() + key.slice(1)
    used.add(scholarly)
    used.add(scholarly + 'Hint')
  }
  return keys.filter((key) => !used.has(key)).sort()
}
