/** A moved file must not be diagnosed as a missing pin tag. */
import { expect, it } from 'vitest'
import { overrideNameProblems } from '../../../scripts/harness-state.mjs'
import { pinnedFileOf } from '../../../scripts/shared/harness-tag.mjs'

it('names an absent tag before attempting any file read', () => {
  const calls: string[][] = []
  const result = pinnedFileOf(
    (args) => {
      calls.push(args)
      throw new Error('absent')
    },
    'dsh-vmissing',
    'contract.ts',
  )
  expect(result).toMatchObject({
    kind: 'missing-tag',
    message: expect.stringContaining('dsh-vmissing'),
  })
  expect(calls).toEqual([['rev-parse', '--verify', 'dsh-vmissing^{commit}']])
})
it('names a missing file inside an existing pin', () => {
  const result = pinnedFileOf(
    (args) => {
      if (args[0] === 'show') throw new Error('moved file')
      return 'commit'
    },
    'dsh-vpin',
    'moved.ts',
  )
  expect(result).toMatchObject({
    kind: 'missing-file',
    message: expect.stringContaining('exists but its contract file moved.ts'),
  })
})
it('returns the exact pinned file bytes', () => {
  expect(
    pinnedFileOf(
      (args) => (args[0] === 'show' ? 'const value = 1\n' : 'commit'),
      'dsh-vpin',
      'contract.ts',
    ),
  ).toEqual({ kind: 'file', source: 'const value = 1\n' })
})

it('fails stale harness names while preserving current names and vendor packages', () => {
  expect(
    overrideNameProblems(
      {
        devDependencies: {
          '@deepseek-ai/dsh-current': 'pin',
          '@deepseek-ai/dsh-retired': 'pin',
          '@deepseek-ai/cordis': '4.1.0',
        },
        overrides: { '@deepseek-ai/dsh-retired': 'pin' },
      },
      ['@deepseek-ai/dsh-current'],
    ),
  ).toEqual([
    expect.stringContaining('devDependencies["@deepseek-ai/dsh-retired"]'),
    expect.stringContaining('overrides["@deepseek-ai/dsh-retired"]'),
  ])
})
