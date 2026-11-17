/** Closed inventory of the three reviewed fake-IP egress arms. */
import { parse } from '@babel/parser'

const HTTPS_ARMS = new Set(['src/scholarly/transport/http.ts', 'src/enrichment/transport.ts'])
const NETWORK = 'src/transport/network.ts'
const CONNECTIONS = 'src/transport/connections.ts'

function propertyName(node) {
  return node.type === 'Identifier'
    ? node.name
    : node.type === 'StringLiteral'
      ? node.value
      : undefined
}

function visitTree(node, visit, parent) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) visitTree(child, visit, parent)
    return
  }
  if (typeof node.type !== 'string') return
  visit(node, parent)
  for (const [key, child] of Object.entries(node))
    if (
      ![
        'loc',
        'start',
        'end',
        'extra',
        'comments',
        'leadingComments',
        'trailingComments',
        'innerComments',
      ].includes(key)
    )
      visitTree(child, visit, node)
}

function httpsNameGuard(node) {
  const left = node?.left,
    right = node?.right
  return (
    node?.type === 'LogicalExpression' &&
    node.operator === '&&' &&
    left?.type === 'BinaryExpression' &&
    left.operator === '===' &&
    left.left.type === 'MemberExpression' &&
    propertyName(left.left.property) === 'protocol' &&
    left.right.type === 'StringLiteral' &&
    left.right.value === 'https:' &&
    right?.type === 'UnaryExpression' &&
    right.operator === '!' &&
    right.argument.type === 'CallExpression' &&
    right.argument.callee.type === 'Identifier' &&
    right.argument.callee.name === 'isIpv4Literal' &&
    right.argument.arguments.length === 1 &&
    right.argument.arguments[0].type === 'Identifier'
  )
}

/** Inspect executable syntax; comments and inert documentation never grant an exception. */
export function fakeIpPolicyIssues(sources) {
  const issues = [],
    propertyCounts = new Map()
  let allowlistDispatchers = 0
  for (const [path, source] of sources) {
    const file = parse(source, {
      sourceType: 'module',
      plugins: path.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'],
    })
    const declarations = new Map()
    visitTree(file, (node, parent) => {
      if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init)
        declarations.set(node.id.name, node.init)
    })
    visitTree(file, (node, parent) => {
      if (
        node.type === 'ObjectProperty' &&
        parent?.type === 'ObjectExpression' &&
        propertyName(node.key) === 'acceptFakeIp'
      ) {
        propertyCounts.set(path, (propertyCounts.get(path) ?? 0) + 1)
        if (HTTPS_ARMS.has(path)) {
          const initializer = node.shorthand ? declarations.get(node.key.name) : node.value
          if (!httpsNameGuard(initializer))
            issues.push(`${path}: fake-IP acceptance requires HTTPS and a DNS hostname`)
        } else if (path !== NETWORK) issues.push(`${path}: unreviewed fake-IP egress arm`)
      }
      if (node.type === 'CallExpression') {
        const name =
          node.callee.type === 'MemberExpression'
            ? propertyName(node.callee.property)
            : propertyName(node.callee)
        if (name === 'createValidatingDispatcher' && node.arguments.length > 0) {
          if (
            path === 'src/scholarly/transport/http.ts' &&
            node.arguments.length === 1 &&
            node.arguments[0].type === 'Identifier' &&
            node.arguments[0].name === 'isAllowedScholarlyHost'
          )
            allowlistDispatchers++
          else if (path !== CONNECTIONS)
            issues.push(`${path}: unreviewed hostname-based fake-IP dispatcher`)
        }
      }
    })
  }
  for (const path of [...HTTPS_ARMS, NETWORK])
    if (propertyCounts.get(path) !== 1)
      issues.push(`${path}: expected exactly one reviewed fake-IP property`)
  if (allowlistDispatchers !== 1)
    issues.push('Expected exactly one reviewed scholarly allowlist dispatcher')
  return issues
}
