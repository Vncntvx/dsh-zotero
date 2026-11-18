/** Token-aware source masking preserves code inside template expressions and ignores regex text. */
import { parse } from '@babel/parser'

export function sourceTree(source, options = {}) {
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

export function sourceNodes(source) {
  const nodes = []
  visitSourceNodes(sourceTree(source).program, (node, parent) => nodes.push({ node, parent }))
  return nodes
}

function visitSourceNodes(root, consume) {
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

/** Blank comments and literal contents without changing any code-unit offset. */
export function stripCommentsAndStrings(source, blankStrings = true) {
  const ast = sourceTree(source, { tokens: true })
  const out = source.split('')
  const blank = (start, end) => {
    for (let index = start; index < end; index++) if (out[index] !== '\n') out[index] = ' '
  }
  for (const comment of ast.comments) blank(comment.start, comment.end)
  for (const token of ast.tokens) {
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
