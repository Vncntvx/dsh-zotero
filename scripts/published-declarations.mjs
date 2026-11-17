/** Every external package in published declarations must be installed for consumers. */
import { parse } from '@babel/parser'
import { builtinModules } from 'node:module'
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))

export function declarationDependencyProblems(sources, manifest) {
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    manifest.name,
  ])
  const problems = new Set()
  for (const { path, source } of sources) {
    const parsed = parse(source, { sourceType: 'module', plugins: [['typescript', { dts: true }]] })
    const check = (specifier) => {
      if (typeof specifier !== 'string' || specifier.startsWith('.') || builtins.has(specifier))
        return
      const name = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0]
      if (!declared.has(name))
        problems.add(`${path} references undeclared consumer dependency ${name}`)
    }
    const visit = (node) => {
      if (node === null || typeof node !== 'object') return
      if (
        ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type)
      )
        check(node.source?.value)
      if (node.type === 'TSImportType') check(node.argument?.value)
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(visit)
        else if (value !== null && typeof value === 'object') visit(value)
      }
    }
    visit(parsed.program)
  }
  return [...problems].sort()
}
