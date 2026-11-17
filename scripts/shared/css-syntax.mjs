/** CSS syntax and escape handling shared by every style policy. */
import * as tree from 'css-tree'

/** Comments are tokens; comment-looking text inside strings and URLs stays intact. */
export function stripCssComments(css) {
  const characters = css.split('')
  tree.tokenize(css, (type, start, end) => {
    if (type !== tree.tokenTypes.Comment) return
    for (let index = start; index < end; index++)
      if (characters[index] !== '\n') characters[index] = ' '
  })
  return characters.join('')
}

function canonical(node) {
  const copy = tree.clone(node)
  tree.walk(copy, (entry) => {
    if (entry.type === 'Dimension') entry.unit = tree.ident.decode(entry.unit).toLowerCase()
    if (typeof entry.name !== 'string') return
    const decoded = tree.ident.decode(entry.name)
    if (['ClassSelector', 'IdSelector'].includes(entry.type))
      entry.name = tree.ident.encode(decoded)
    else entry.name = decoded.startsWith('--') ? decoded : decoded.toLowerCase()
    if (entry.type === 'Dimension') entry.unit = tree.ident.decode(entry.unit).toLowerCase()
  })
  return tree.generate(copy)
}

function validateDelimiters(css) {
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

export function styleRules(css) {
  validateDelimiters(css)
  const ast = tree.parse(css, {
    positions: true,
    onParseError: (error) => {
      throw error
    },
  })
  const result = []
  const visit = (node, atRules) => {
    if (node.type === 'Atrule') {
      if (node.block === null) return
      const prelude = css.slice(node.loc.start.offset, node.block.loc.start.offset).trim()
      node.block.children.forEach((child) => visit(child, [...atRules, prelude]))
    } else if (node.type === 'Rule') {
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
  ast.children.forEach((node) => visit(node, []))
  return result
}

export function styleDeclarations(body) {
  validateDelimiters(body)
  const block = tree.parse(`{${body}}`, {
    context: 'block',
    onParseError: (error) => {
      throw error
    },
  })
  return block.children
    .toArray()
    .filter((node) => node.type === 'Declaration')
    .map((node) => ({
      property: tree.ident.decode(node.property).toLowerCase(),
      value: canonical(node.value),
    }))
}

export function tokenReferences(text) {
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

/** Reparse var fallbacks, which CSSTree deliberately preserves as Raw nodes. */
export function valueNodes(value) {
  const nodes = []
  const collect = (ast) =>
    tree.walk(ast, (node) => {
      if (node.type === 'Raw') collect(tree.parse(node.value, { context: 'value' }))
      else nodes.push(node)
    })
  collect(tree.parse(value, { context: 'value' }))
  return nodes
}

export function boxValues(value) {
  return tree.parse(value, { context: 'value' }).children.toArray().map(canonical)
}

export function colorLiterals(value, named) {
  return valueNodes(value).flatMap((node) => {
    if (node.type === 'Hash') return [`#${tree.ident.decode(node.value)}`]
    const name = typeof node.name === 'string' ? tree.ident.decode(node.name).toLowerCase() : ''
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

export function selectorBaseClass(selector) {
  const ast = tree.parse(selector, { context: 'selectorList' })
  const first = ast.children.first?.children.first
  return first?.type === 'ClassSelector'
    ? `.${tree.ident.encode(tree.ident.decode(first.name))}`
    : undefined
}

export function selectorSubjects(selector) {
  const subjects = new Set()
  const ast = tree.parse(selector, { context: 'selectorList' })
  const classes = (nodes) => {
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
  ast.children.forEach((one) => {
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

/** Three-valued media logic keeps disjunctions and negation from licensing exceptions. */
function mediaMatch(prelude, feature, actual) {
  const ast = tree.parse(`${prelude}{}`)
  const at = ast.children.first
  if (at?.type !== 'Atrule' || tree.ident.decode(at.name).toLowerCase() !== 'media')
    return undefined
  const queries = at.prelude?.children.first
  if (queries?.type !== 'MediaQueryList') return undefined
  const and = (values) =>
    values.includes(false) ? false : values.every((value) => value === true) ? true : undefined
  const or = (values) =>
    values.includes(true) ? true : values.every((value) => value === false) ? false : undefined
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
      const type = query.mediaType === null || query.mediaType === 'all' ? true : undefined
      const value = and([type, query.condition === null ? true : evaluate(query.condition)])
      return query.modifier === 'not' ? (value === undefined ? undefined : !value) : value
    }),
  )
}

export function mediaRequires(prelude, feature, expected) {
  const values = {
    hover: ['hover', 'none'],
    pointer: ['fine', 'coarse', 'none'],
    'prefers-reduced-motion': ['reduce', 'no-preference'],
  }[feature]
  return (
    values !== undefined &&
    mediaMatch(prelude, feature, expected) !== false &&
    values
      .filter((value) => value !== expected)
      .every((value) => mediaMatch(prelude, feature, value) === false)
  )
}

export function mediaCovers(prelude, feature, expected) {
  return mediaMatch(prelude, feature, expected) === true
}

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

/** Only an unqualified subject disables motion for every state of that subject. */
export function reductionSubjects(selector) {
  const ast = tree.parse(selector, { context: 'selectorList' })
  return ast.children.toArray().flatMap((one) => {
    const nodes = one.children.toArray()
    if (nodes.length !== 1) return []
    if (nodes[0].type === 'ClassSelector')
      return [`.${tree.ident.encode(tree.ident.decode(nodes[0].name))}`]
    return nodes[0].type === 'TypeSelector' ? [canonical(one)] : []
  })
}
