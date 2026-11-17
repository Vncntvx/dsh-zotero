/** Type-only imports still require consumer dependencies, and dev dependencies do not satisfy them. */
import { expect, it } from 'vitest'
import { declarationDependencyProblems } from '../../../scripts/published-declarations.mjs'

const sources = [
  {
    path: 'lib/reader.d.ts',
    source: `
  import type { Agent } from '@deepseek-ai/dsh-agent'
  export type Result = import('result-package/contracts').Result
  export * from 'declared-package'
  import type { Buffer } from 'node:buffer'
  export { Value } from './local.js'
`,
  },
]

it('reports both static and import-type edges absent from published dependency sections', () => {
  expect(declarationDependencyProblems(sources, { name: 'fixture' })).toEqual([
    'lib/reader.d.ts references undeclared consumer dependency @deepseek-ai/dsh-agent',
    'lib/reader.d.ts references undeclared consumer dependency declared-package',
    'lib/reader.d.ts references undeclared consumer dependency result-package',
  ])
})

it('accepts installed dependency, optional and peer contracts', () => {
  expect(
    declarationDependencyProblems(sources, {
      name: 'fixture',
      dependencies: { 'declared-package': '1.0.0' },
      optionalDependencies: { 'result-package': '1.0.0' },
      peerDependencies: { '@deepseek-ai/dsh-agent': '>=0.2.2-rc.3' },
    }),
  ).toEqual([])
})
