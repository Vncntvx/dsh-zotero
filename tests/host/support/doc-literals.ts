/** Read documentation literals without evaluating expressions or executing code. */
import { parseExpression } from '@babel/parser'
import type { Expression } from '@babel/types'
export const UNPARSED_DEFAULT = Symbol('unparsed documentation default')
/** Recognized prose with no comparable value: required markers, config-cap notes. */
export const PROSE_DEFAULT = Symbol('recognized prose default')
/** A default cell the reader cannot parse; the parameter-default gate treats it as a violation. */
export const UNRECOGNIZED_DEFAULT = Symbol('unrecognized documentation default')

/**
 * One documented default cell as a JSON value: `undefined` for the "none"
 * spellings, `false` for a spelled-out 否/no, `PROSE_DEFAULT` for recognized
 * required-marker and config-value prose (including the parenthesized
 * `（默认 "x"）` forms, whose quoted literal is read), `UNRECOGNIZED_DEFAULT`
 * for anything else — so an unreadable cell fails the default gate instead of
 * silently skipping it.
 */
export function docDefaultOf(cell: string | undefined): unknown {
  if (cell === undefined) return PROSE_DEFAULT
  // Markdown backticks mark literals or code spans; inside a default cell
  // they never carry meaning beyond the quoting itself.
  const value = cell.replaceAll('`', '').trim()
  if (value === '' || value === '—' || value === '-' || value === 'none' || value === '无') {
    return undefined
  }
  // Required markers and config-cap notes are prose, not defaults.
  if (/^(✓|required|必填|config cap|配置上限)$/.test(value)) return PROSE_DEFAULT
  if (/^(?:—|-|–)\s*\((?:required|必填)\)$/.test(value)) return PROSE_DEFAULT
  if (value === '否' || value === 'no') return false
  if (value === '配置默认值' || value === 'config value') return PROSE_DEFAULT
  // The enumeration prose restates the four `retrieve.sources` values ("all
  // four" / "all except fulltext"); the array itself is the schema default.
  if (/^(?:全部 4 种|all 4|除 fulltext 外全部|all except fulltext)$/.test(value)) {
    return PROSE_DEFAULT
  }
  // The parenthesized forms name the CONFIG default a composition derives at
  // runtime, not a schema default — recognized prose, not a comparable value.
  if (/^配置默认值（默认 "(?:[^"\\]|\\.)*"）$/.test(value)) return PROSE_DEFAULT
  if (/^config value \(default "(?:[^"\\]|\\.)*"\)$/.test(value)) return PROSE_DEFAULT
  // A bare word the schema may name as its default (`evidence`): parsed as
  // that string, and the comparison against the schema decides. Starts with
  // a letter or underscore and never names a JSON reserved literal, so
  // numbers and booleans take the JSON path below.
  if (/^(?!(?:true|false|null)$)[A-Za-z_][\w.-]*$/.test(value)) return value
  try {
    return JSON.parse(asJsonLiteral(value))
  } catch {
    return UNRECOGNIZED_DEFAULT
  }
}

/** Quote bare object keys so a documented JS-style literal parses as JSON. */
export function asJsonLiteral(source: string): string {
  return source
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3')
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*=\s*)/g, '$1"$2": ')
}

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
