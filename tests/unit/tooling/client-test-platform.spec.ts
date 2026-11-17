/** jsdom resolves real published source without changing compiled-bundle verification. */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { clientTestAliasesOf } from '../../../scripts/client-test-platform.mjs'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function installation(
  options: { source?: 'ts' | 'tsx' | 'absent'; published?: boolean; loader?: boolean } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-client-platform-'))
  roots.push(root)
  const pkg = join(root, 'node_modules/@deepseek-ai/dsh-client-fixture')
  mkdirSync(join(pkg, 'lib'), { recursive: true })
  mkdirSync(join(pkg, 'src/client'), { recursive: true })
  writeFileSync(
    join(pkg, 'package.json'),
    JSON.stringify({
      exports: {
        './client': { types: './lib/types/client/index.d.ts', default: './lib/client.js' },
        ...(options.published === false ? {} : { './src/*': './src/*' }),
      },
    }),
  )
  writeFileSync(
    join(pkg, 'lib/client.js'),
    options.loader === false
      ? 'export const service = 1'
      : 'window.__ModuleLoader__.load({ id: "fixture", factory: () => ({}) })',
  )
  if (options.source !== 'absent')
    writeFileSync(
      join(pkg, `src/client/index.${options.source ?? 'ts'}`),
      'export const service = 1',
    )
  return { root, pkg }
}

it.each(['ts', 'tsx'] as const)(
  'uses the published %s production entry for an exact loader-only client import',
  (source) => {
    const { root, pkg } = installation({ source })
    const [alias] = clientTestAliasesOf(root)
    expect(alias!.find.test('@deepseek-ai/dsh-client-fixture/client')).toBe(true)
    expect(alias!.find.test('@deepseek-ai/dsh-client-fixture/client/other')).toBe(false)
    expect(alias!.replacement).toBe(join(pkg, `src/client/index.${source}`))
  },
)

it('keeps ordinary ESM client entries on their public compiled path', () => {
  expect(clientTestAliasesOf(installation({ loader: false }).root)).toEqual([])
})

it('fails explicitly when a loader-only package lacks published source or its file', () => {
  expect(() => clientTestAliasesOf(installation({ published: false }).root)).toThrow(
    'no published production source contract',
  )
  expect(() => clientTestAliasesOf(installation({ source: 'absent' }).root)).toThrow(
    'Missing published production source',
  )
})
