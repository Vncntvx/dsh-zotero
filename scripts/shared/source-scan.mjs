/** Token-aware source masking preserves code inside template expressions and ignores regex text. */
import { parse } from '@babel/parser'

/**
 * Parse one source with the TypeScript plugin, retrying with JSX when the
 * plain parse rejects the syntax.
 * @param source {string} the source text.
 * @param options {import('@babel/parser').ParserOptions} overrides for the shared parse settings.
 * @returns {import('@babel/parser').ParseResult} the parsed program.
 */
export function sourceTree(source, options = {}) {
  /** @type {import('@babel/parser').ParserOptions} */
  const settings = {
    sourceType: 'unambiguous',
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    ...options,
  }
  try {
    return parse(source, { ...settings, plugins: ['typescript'] })
  } catch {
    return parse(source, { ...settings, plugins: ['typescript', 'jsx'] })
  }
}

/**
 * Walk every AST node with its parent, in source order. The walked nodes are
 * arbitrary AST fragments the callers narrow with runtime `type` checks, so
 * the walk's face is deliberately the loose element shape those consumers
 * share.
 * @param source {string} the source text.
 * @returns {{ node: any, parent: any }[]} every visited node and its parent.
 */
export function sourceNodes(source) {
  /** @type {{ node: any, parent: any }[]} */
  const nodes = []
  visitSourceNodes(sourceTree(source).program, (node, parent) => nodes.push({ node, parent }))
  return nodes
}

/**
 * Depth-first walk over every owned child of `root`; position and comment
 * metadata is skipped. The visited fragments may be any AST node or metadata
 * object, so the visitor narrows with runtime checks instead of types.
 * @param root {import('@babel/types').Node} the subtree to walk.
 * @param consume {(node: any, parent: any) => void} called for every visited fragment.
 */
function visitSourceNodes(root, consume) {
  /** @param node {any} @param parent {any} */
  const visit = (node, parent) => {
    if (node === null || typeof node !== 'object' || typeof node.type !== 'string') return
    consume(node, parent)
    for (const [key, value] of Object.entries(node)) {
      if (
        [
          'loc',
          'comments',
          'tokens',
          'leadingComments',
          'trailingComments',
          'innerComments',
        ].includes(key)
      )
        continue
      if (Array.isArray(value)) value.forEach((child) => visit(child, node))
      else if (value !== null && typeof value === 'object') visit(value, node)
    }
  }
  visit(root, undefined)
}

/**
 * Blank comments and literal contents without changing any code-unit offset.
 * @param source {string} the source text.
 * @param [blankStrings] {boolean} also blank string and template-literal contents.
 * @returns {string} the same-length masked source.
 */
export function stripCommentsAndStrings(source, blankStrings = true) {
  const ast = sourceTree(source, { tokens: true })
  const out = source.split('')
  /** @param start {number} @param end {number} */
  const blank = (start, end) => {
    for (let index = start; index < end; index++) if (out[index] !== '\n') out[index] = ' '
  }
  for (const comment of /** @type {NonNullable<import('@babel/parser').ParseResult['comments']>} */ (
    ast.comments
  ))
    blank(/** @type {number} */ (comment.start), /** @type {number} */ (comment.end))
  for (const token of /** @type {NonNullable<import('@babel/parser').ParseResult['tokens']>} */ (
    ast.tokens
  )) {
    const label = token.type.label
    if (label === 'regexp') blank(token.start + 1, token.end)
    else if (blankStrings && label === 'string') blank(token.start + 1, token.end - 1)
  }
  if (blankStrings) {
    visitSourceNodes(ast.program, (node) => {
      if (node.type === 'TemplateElement') blank(node.start, node.end)
    })
  }
  return out.join('')
}
