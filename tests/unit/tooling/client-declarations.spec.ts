/** The browser declaration gate observes transitive host imports hidden by skipLibCheck. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import {
  clientDeclarationProblems,
  clientProgramFiles,
} from '../../../scripts/client-declarations.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const temporary: string[] = []
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true })
})

it('checks the actual production browser program with no host execution entry', () => {
  const files = clientProgramFiles()
  expect(files).toContain(join(root, 'src/client/index.ts'))
  expect(clientDeclarationProblems(files)).toEqual([])
})

it('rejects a real transitive host import even with declaration checking skipped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-client-declarations-'))
  temporary.push(dir)
  writeFileSync(
    join(dir, 'entry.ts'),
    `import type {} from ${JSON.stringify(join(root, 'src/job-kinds.ts'))}\nexport {}`,
  )
  const project = join(dir, 'tsconfig.json')
  writeFileSync(
    project,
    JSON.stringify({
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        noEmit: true,
        skipLibCheck: true,
      },
      files: ['./entry.ts'],
    }),
  )
  expect(clientDeclarationProblems(clientProgramFiles(project))).toEqual(
    expect.arrayContaining([
      join(root, 'src/job-kinds.ts'),
      expect.stringContaining('/@deepseek-ai/dsh-jobs/lib/types/index.d.ts'),
    ]),
  )
})
