/** CSS syntax and escape handling shared by every style policy. */
import * as tree from 'css-tree'

/**
 * Comments are tokens; comment-looking text inside strings and URLs stays intact.
 * @param {string} css - the stylesheet text.
 * @returns {string} the text with every comment token blanked out.
 */
export function stripCssComments(css) {
  const characters = css.split('')
  tree.tokenize(css, (type, start, end) => {
    if (type !== tree.tokenTypes.Comment) return
    for (let index = start; index < end; index++)
      if (characters[index] !== '\n') characters[index] = ' '
  })
  return characters.join('')
}

/**
 * The canonical spelling of one parsed node.
 * @param {import('css-tree').CssNode} node - the parsed node.
 * @returns {string} the generated, escaped-normalized CSS text.
 */
function canonical(node) {
  const copy = tree.clone(node)
  tree.walk(copy, (entry) => {
    if (entry.type === 'Dimension') entry.unit = tree.ident.decode(entry.unit).toLowerCase()
    if (!('name' in entry) || typeof entry.name !== 'string') return
    const decoded = tree.ident.decode(entry.name)
    if (['ClassSelector', 'IdSelector'].includes(entry.type))
      entry.name = tree.ident.encode(decoded)
    else entry.name = decoded.startsWith('--') ? decoded : decoded.toLowerCase()
  })
  return tree.generate(copy)
}

/**
 * Rejects unbalanced delimiters and invalid strings before parsing.
 * @param {string} css - the text to tokenize.
 * @returns {void}
 */
function validateDelimiters(css) {
  /** @type {Array<number | undefined>} */
  const stack = []
  const pairs = new Map([
    [tree.tokenTypes.Function, tree.tokenTypes.RightParenthesis],
    [tree.tokenTypes.LeftParenthesis, tree.tokenTypes.RightParenthesis],
    [tree.tokenTypes.LeftSquareBracket, tree.tokenTypes.RightSquareBracket],
    [tree.tokenTypes.LeftCurlyBracket, tree.tokenTypes.RightCurlyBracket],
  ])
  const closers = new Set(pairs.values())
  tree.tokenize(css, (type) => {
    if (pairs.has(type)) stack.push(pairs.get(type))
    else if (closers.has(type) && stack.pop() !== type)
      throw new SyntaxError('CSS has an unmatched delimiter')
    else if ([tree.tokenTypes.BadString, tree.tokenTypes.BadUrl].includes(type))
      throw new SyntaxError('CSS has an invalid string or URL token')
  })
  if (stack.length > 0) throw new SyntaxError('CSS has an unclosed delimiter')
}

/**
 * Every top-level or nested rule with its raw body and enclosing at-rule preludes.
 * @param {string} css - the stylesheet text.
 * @returns {Array<{selector: string, body: string, atRules: string[], at: number}>}
 *   one entry per rule, in source order.
 */
export function styleRules(css) {
  validateDelimiters(css)
  const ast = tree.parse(css, {
    positions: true,
    onParseError: (error) => {
      throw error
    },
  })
  /** @type {Array<{selector: string, body: string, atRules: string[], at: number}>} */
  const result = []
  /**
   * @param {import('css-tree').CssNode} node
   * @param {string[]} atRules
   */
  const visit = (node, atRules) => {
    if (node.type === 'Atrule') {
      if (node.block === null) return
      if (!node.loc || !node.block.loc) throw new SyntaxError('Missing CSS at-rule positions')
      const prelude = css.slice(node.loc.start.offset, node.block.loc.start.offset).trim()
      node.block.children.forEach((child) => visit(child, [...atRules, prelude]))
    } else if (node.type === 'Rule') {
      if (!node.loc || !node.block.loc) throw new SyntaxError('Missing CSS rule positions')
      result.push({
        selector: canonical(node.prelude),
        body: css.slice(node.block.loc.start.offset + 1, node.block.loc.end.offset - 1),
        atRules,
        at: node.loc.start.offset,
      })
      node.block.children.forEach((child) => {
        if (child.type === 'Rule' || child.type === 'Atrule') visit(child, atRules)
      })
    }
  }
  if (ast.type !== 'StyleSheet') throw new SyntaxError('Expected a CSS stylesheet')
  ast.children.forEach((node) => visit(node, []))
  return result
}

/**
 * Every declaration of one raw rule body, with the property canonicalized.
 * @param {string} body - the rule body between the braces.
 * @returns {Array<{property: string, value: string}>} declarations in source order.
 */
export function styleDeclarations(body) {
  validateDelimiters(body)
  const block = tree.parse(`{${body}}`, {
    context: 'block',
    onParseError: (error) => {
      throw error
    },
  })
  if (block.type !== 'Block') throw new SyntaxError('Expected a CSS declaration block')
  return block.children
    .toArray()
    .filter(/** @param {import('css-tree').CssNode} node */ (node) => node.type === 'Declaration')
    .map((node) => ({
      property: tree.ident.decode(node.property).toLowerCase(),
      value: canonical(node.value),
    }))
}

/**
 * Every custom property referenced through `var()` in one text.
 * @param {string} text - the text to tokenize.
 * @returns {Array<{name: string, at: number}>} referenced names with their offsets.
 */
export function tokenReferences(text) {
  /** @type {Array<{type: number, start: number, end: number}>} */
  const tokens = []
  tree.tokenize(text, (type, start, end) => tokens.push({ type, start, end }))
  const references = []
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (
      token.type !== tree.tokenTypes.Function ||
      tree.ident.decode(text.slice(token.start, token.end - 1)).toLowerCase() !== 'var'
    )
      continue
    let next = index + 1
    while (
      tokens[next] &&
      [tree.tokenTypes.WhiteSpace, tree.tokenTypes.Comment].includes(tokens[next].type)
    )
      next++
    const argument = tokens[next]
    if (argument?.type !== tree.tokenTypes.Ident) continue
    const name = tree.ident.decode(text.slice(argument.start, argument.end))
    if (/^--ds/i.test(name)) references.push({ name, at: token.start })
  }
  return references
}

/**
 * Reparse var fallbacks, which CSSTree deliberately preserves as Raw nodes.
 * @param {string} value - the declaration value.
 * @returns {import('css-tree').CssNode[]} the flattened value nodes.
 */
export function valueNodes(value) {
  /** @type {import('css-tree').CssNode[]} */
  const nodes = []
  /** @param {import('css-tree').CssNode} ast */
  const collect = (ast) =>
    tree.walk(ast, (node) => {
      if (node.type === 'Raw') collect(tree.parse(node.value, { context: 'value' }))
      else nodes.push(node)
    })
  collect(tree.parse(value, { context: 'value' }))
  return nodes
}

/**
 * The four sides of one box value, each canonicalized.
 * @param {string} value - the declaration value.
 * @returns {string[]} one canonical side per entry.
 */
export function boxValues(value) {
  const ast = tree.parse(value, { context: 'value' })
  return ast.type === 'Value' ? ast.children.toArray().map(canonical) : []
}

/**
 * Every color a value may resolve to, as literals or function prefixes.
 * @param {string} value - the declaration value.
 * @param {boolean} named - whether named colors count as literals.
 * @returns {string[]} color literals and color-function prefixes.
 */
export function colorLiterals(value, named) {
  return valueNodes(value).flatMap((node) => {
    if (node.type === 'Hash') return [`#${tree.ident.decode(node.value)}`]
    if (node.type !== 'Identifier' && node.type !== 'Function') return []
    const name = tree.ident.decode(node.name).toLowerCase()
    if (
      node.type === 'Identifier' &&
      named &&
      !['transparent', 'currentcolor'].includes(name) &&
      tree.lexer.matchType('color', name).matched !== null
    )
      return [name]
    if (
      node.type === 'Function' &&
      [
        'rgb',
        'rgba',
        'hsl',
        'hsla',
        'hwb',
        'lab',
        'lch',
        'oklab',
        'oklch',
        'color',
        'color-mix',
        'light-dark',
        'device-cmyk',
      ].includes(name)
    )
      return [`${name}(`]
    return []
  })
}

/**
 * The utility base class a selector starts with, if any.
 * @param {string} selector - the selector text.
 * @returns {string | undefined} the encoded class name, or undefined.
 */
export function selectorBaseClass(selector) {
  const ast = tree.parse(selector, { context: 'selectorList' })
  const firstSelector = ast.type === 'SelectorList' ? ast.children.first : undefined
  const first = firstSelector?.type === 'Selector' ? firstSelector.children.first : undefined
  return first?.type === 'ClassSelector'
    ? `.${tree.ident.encode(tree.ident.decode(first.name))}`
    : undefined
}

/**
 * The subject class every compound selector of one selector matches.
 * @param {string} selector - the selector text.
 * @returns {string[]} the encoded subject class names.
 */
export function selectorSubjects(selector) {
  /** @type {Set<string>} */
  const subjects = new Set()
  const ast = tree.parse(selector, { context: 'selectorList' })
  /**
   * @param {import('css-tree').CssNode[]} nodes
   * @returns {string[]}
   */
  const classes = (nodes) => {
    /** @type {string[]} */
    const names = []
    nodes.forEach((node) => {
      if (node.type === 'ClassSelector')
        names.push(`.${tree.ident.encode(tree.ident.decode(node.name))}`)
      if (
        node.type === 'PseudoClassSelector' &&
        ['is', 'where'].includes(tree.ident.decode(node.name)) &&
        node.children
      )
        tree.walk(node, (child) => {
          if (child.type === 'ClassSelector')
            names.push(`.${tree.ident.encode(tree.ident.decode(child.name))}`)
        })
    })
    return names
  }
  if (ast.type !== 'SelectorList') return []
  ast.children.forEach((one) => {
    if (one.type !== 'Selector') return
    /** @type {import('css-tree').CssNode[]} */
    let compound = []
    one.children.forEach((node) => {
      if (node.type === 'Combinator') compound = []
      else compound.push(node)
    })
    const names = classes(compound)
    for (const name of names.length > 0 ? names : [canonical(one)]) subjects.add(name)
  })
  return [...subjects]
}

/**
 * Three-valued media logic keeps disjunctions and negation from licensing exceptions.
 * @param {string} prelude - the at-rule prelude without the `@media` keyword.
 * @param {string} feature - the media feature to read.
 * @param {string} actual - the value the runtime actually has.
 * @returns {boolean | undefined} true/false when decidable, undefined otherwise.
 */
function mediaMatch(prelude, feature, actual) {
  const ast = tree.parse(`${prelude}{}`)
  const at = ast.type === 'StyleSheet' ? ast.children.first : undefined
  if (at?.type !== 'Atrule' || tree.ident.decode(at.name).toLowerCase() !== 'media')
    return undefined
  const queries = at.prelude?.type === 'AtrulePrelude' ? at.prelude.children.first : undefined
  if (queries?.type !== 'MediaQueryList') return undefined
  /**
   * @param {(boolean | undefined)[]} values
   * @returns {boolean | undefined}
   */
  const and = (values) =>
    values.includes(false) ? false : values.every((value) => value === true) ? true : undefined
  /**
   * @param {(boolean | undefined)[]} values
   * @returns {boolean | undefined}
   */
  const or = (values) =>
    values.includes(true) ? true : values.every((value) => value === false) ? false : undefined
  /**
   * @param {import('css-tree').CssNode | null | undefined} node
   * @returns {boolean | undefined}
   */
  const evaluate = (node) => {
    if (node?.type === 'Feature') {
      if (
        tree.ident.decode(node.name).toLowerCase() !== feature ||
        node.value?.type !== 'Identifier'
      )
        return undefined
      return tree.ident.decode(node.value.name).toLowerCase() === actual
    }
    if (node?.type !== 'Condition') return undefined
    const children = node.children.toArray()
    if (children[0]?.type === 'Identifier' && children[0].name === 'not') {
      const value = evaluate(children[1])
      return value === undefined ? undefined : !value
    }
    const operands = children.filter((child) => child.type !== 'Identifier').map(evaluate)
    return children.some((child) => child.type === 'Identifier' && child.name === 'or')
      ? or(operands)
      : and(operands)
  }
  return or(
    queries.children.toArray().map((query) => {
      if (query.type !== 'MediaQuery') return undefined
      const type = query.mediaType === null || query.mediaType === 'all' ? true : undefined
      const value = and([type, query.condition === null ? true : evaluate(query.condition)])
      return query.modifier === 'not' ? (value === undefined ? undefined : !value) : value
    }),
  )
}

/**
 * Whether a media prelude requires `feature` to be exactly `expected`.
 * @param {string} prelude - the at-rule prelude without the `@media` keyword.
 * @param {string} feature - the media feature to read.
 * @param {string} expected - the value the rule requires.
 * @returns {boolean} whether the prelude licenses exactly that value.
 */
export function mediaRequires(prelude, feature, expected) {
  const values = {
    hover: ['hover', 'none'],
    pointer: ['fine', 'coarse', 'none'],
    'prefers-reduced-motion': ['reduce', 'no-preference'],
  }[/** @type {'hover' | 'pointer' | 'prefers-reduced-motion'} */ (feature)]
  return (
    values !== undefined &&
    mediaMatch(prelude, feature, expected) !== false &&
    values
      .filter((value) => value !== expected)
      .every((value) => mediaMatch(prelude, feature, value) === false)
  )
}

/**
 * Whether a media prelude admits `feature` being `expected`.
 * @param {string} prelude - the at-rule prelude without the `@media` keyword.
 * @param {string} feature - the media feature to read.
 * @param {string} expected - the value the runtime has.
 * @returns {boolean} whether the prelude definitely covers that value.
 */
export function mediaCovers(prelude, feature, expected) {
  return mediaMatch(prelude, feature, expected) === true
}

/**
 * Whether any compound of the selector carries a `:hover` pseudo-class.
 * @param {string} selector - the selector text.
 * @returns {boolean} whether hover appears anywhere in the selector.
 */
export function selectorHasHover(selector) {
  let found = false
  tree.walk(tree.parse(selector, { context: 'selectorList' }), (node) => {
    if (
      node.type === 'PseudoClassSelector' &&
      tree.ident.decode(node.name).toLowerCase() === 'hover'
    )
      found = true
  })
  return found
}

/**
 * Only an unqualified subject disables motion for every state of that subject.
 * @param {string} selector - the selector text.
 * @returns {string[]} the subject class names the selector disables motion for.
 */
export function reductionSubjects(selector) {
  const ast = tree.parse(selector, { context: 'selectorList' })
  if (ast.type !== 'SelectorList') return []
  return ast.children.toArray().flatMap((one) => {
    if (one.type !== 'Selector') return []
    const nodes = one.children.toArray()
    if (nodes.length !== 1) return []
    if (nodes[0].type === 'ClassSelector')
      return [`.${tree.ident.encode(tree.ident.decode(nodes[0].name))}`]
    return nodes[0].type === 'TypeSelector' ? [canonical(one)] : []
  })
}
