/** Execute the published hook rules through the repository's real ESLint configuration. */
import { ESLint } from 'eslint'
import { expect, it } from 'vitest'

const eslint = new ESLint()

it('rejects a conditional hook in a typed JSX component', async () => {
  const [result] = await eslint.lintText(
    `
    import { useEffect } from 'react'
    export function Panel({ enabled }: { enabled: boolean }) {
      if (!enabled) return null
      useEffect(() => {}, [])
      return <section />
    }
  `,
    { filePath: 'src/client/hooks-regression.tsx' },
  )
  expect(result!.messages).toEqual([
    expect.objectContaining({ ruleId: 'react-hooks/rules-of-hooks', severity: 2 }),
  ])
})

it('reports a missing effect dependency and accepts the complete dependency set', async () => {
  const source = (dependencies: string) => `
    import { useEffect } from 'react'
    export function useRead(id: string, load: (id: string) => void) {
      useEffect(() => { load(id) }, [${dependencies}])
    }
  `
  const [missing] = await eslint.lintText(source('id'), {
    filePath: 'src/client/hooks-regression.ts',
  })
  expect(missing!.messages).toEqual([
    expect.objectContaining({ ruleId: 'react-hooks/exhaustive-deps', severity: 1 }),
  ])
  const [complete] = await eslint.lintText(source('id, load'), {
    filePath: 'src/client/hooks-regression.ts',
  })
  expect(complete!.messages).toEqual([])
})

it('parses TypeScript generic arrows without interpreting them as JSX', async () => {
  const [result] = await eslint.lintText('export const identity = <T>(value: T): T => value', {
    filePath: 'src/client/hooks-regression.ts',
  })
  expect(result!.messages).toEqual([])
})
