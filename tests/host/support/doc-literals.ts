/** Read documentation literals without evaluating expressions or executing code. */
import { parseExpression } from '@babel/parser'
import type { Expression } from '@babel/types'
export const UNPARSED_DEFAULT = Symbol('unparsed documentation default')
export function documentedLiteral(source: string, bareString = false): unknown {
  const read = (node: Expression, allowBare = bareString): unknown => {
    if (
      node.type === 'StringLiteral' ||
      node.type === 'NumericLiteral' ||
      node.type === 'BooleanLiteral'
    )
      return node.value
    if (allowBare && node.type === 'Identifier') return node.name
    if (node.type === 'NullLiteral') return null
    if (
      node.type === 'UnaryExpression' &&
      node.operator === '-' &&
      node.argument.type === 'NumericLiteral'
    )
      return -node.argument.value
    if (node.type === 'ArrayExpression')
      return node.elements.map((entry) => {
        if (entry === null || entry.type === 'SpreadElement')
          throw new Error('unsupported array entry')
        return read(entry, true)
      })
    if (node.type === 'ObjectExpression')
      return Object.fromEntries(
        node.properties.map((entry) => {
          if (entry.type !== 'ObjectProperty' || entry.computed)
            throw new Error('unsupported property')
          const key =
            entry.key.type === 'Identifier'
              ? entry.key.name
              : entry.key.type === 'StringLiteral'
                ? entry.key.value
                : undefined
          if (key === undefined) throw new Error('unsupported key')
          return [key, read(entry.value as Expression)]
        }),
      )
    throw new Error('not a literal')
  }
  try {
    return read(parseExpression(source))
  } catch {
    return bareString && /^[\w./~:@-]+$/.test(source) ? source : UNPARSED_DEFAULT
  }
}
