/** A documented domain code must reach an actual error constructor or its typed factory. */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '@babel/parser'
import { VISITOR_KEYS, type Node } from '@babel/types'
import { expect, it } from 'vitest'
import { ZOTERO_ERROR_CODES } from '../../src/errors.ts'

it('requires construction evidence for every documented Zotero error code', () => {
  const directory = new URL('../../src/', import.meta.url)
  const used = new Set<string>()
  let directoryFactoryConstructs = false
  const directoryFactoryCodes = new Set<string>()
  for (const file of readdirSync(directory, { recursive: true }).filter((file) =>
    /\.tsx?$/.test(String(file)),
  )) {
    const path = join(directory.pathname, String(file))
    const ast = parse(readFileSync(path, 'utf8'), {
      sourceType: 'module',
      plugins: [
        ['typescript', { dts: path.endsWith('.d.ts') }],
        ...(path.endsWith('.tsx') ? (['jsx'] as const) : []),
      ],
    })
    const visit = (node: Node, parent?: Node): void => {
      if (
        node.type === 'NewExpression' &&
        node.callee.type === 'Identifier' &&
        node.callee.name === 'ZoteroError'
      ) {
        const code = node.arguments[1]
        if (code?.type === 'Identifier' && code.name.startsWith('ZOTERO_')) used.add(code.name)
        if (code?.type === 'StringLiteral' && code.value.startsWith('ZOTERO_')) used.add(code.value)
        if (
          code?.type === 'TemplateLiteral' &&
          code.expressions.length === 1 &&
          parent?.type === 'ArrowFunctionExpression'
        ) {
          const parameter = parent.params.find(
            (parameter) =>
              parameter.type === 'Identifier' &&
              code.expressions[0]?.type === 'Identifier' &&
              parameter.name === code.expressions[0].name,
          )
          const annotation =
            parameter?.type === 'Identifier' &&
            parameter.typeAnnotation?.type === 'TSTypeAnnotation'
              ? parameter.typeAnnotation.typeAnnotation
              : undefined
          if (annotation?.type === 'TSUnionType')
            for (const member of annotation.types)
              if (member.type === 'TSLiteralType' && member.literal.type === 'StringLiteral')
                used.add(
                  `${code.quasis[0]!.value.cooked}${member.literal.value}${code.quasis[1]!.value.cooked}`,
                )
        }
        if (
          String(file) === 'enrichment/safe-directory.ts' &&
          code?.type === 'MemberExpression' &&
          code.object.type === 'Identifier' &&
          code.object.name === 'options' &&
          code.property.type === 'Identifier' &&
          code.property.name === 'errorCode'
        )
          directoryFactoryConstructs = true
      }
      if (
        node.type === 'CallExpression' &&
        node.callee.type === 'Identifier' &&
        node.callee.name === 'resolveSafeDirectory' &&
        node.arguments[0]?.type === 'ObjectExpression'
      ) {
        for (const property of node.arguments[0].properties)
          if (
            property.type === 'ObjectProperty' &&
            property.key.type === 'Identifier' &&
            property.key.name === 'errorCode' &&
            property.value.type === 'Identifier'
          )
            directoryFactoryCodes.add(property.value.name)
      }
      for (const key of VISITOR_KEYS[node.type] ?? []) {
        const value = (node as unknown as Record<string, unknown>)[key]
        if (Array.isArray(value))
          for (const child of value) {
            if (child) visit(child as Node, node)
          }
        else if (value && typeof value === 'object') visit(value as Node, node)
      }
    }
    visit(ast.program)
  }
  expect(directoryFactoryConstructs).toBe(true)
  for (const code of directoryFactoryCodes) used.add(code)
  expect(ZOTERO_ERROR_CODES.filter((code) => !used.has(code))).toEqual([])
})
