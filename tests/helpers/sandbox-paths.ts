/** A denied fixture must live outside every root the real sandbox authorizes. */
import { writableRoots } from '@deepseek-ai/dsh-sandbox'
import { mkdtemp, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative, isAbsolute } from 'node:path'
import { expect } from 'vitest'

export async function sandboxFixture(prefix: string): Promise<string> {
  const base = await realpath(await mkdtemp(join(homedir(), prefix)))
  const roots = writableRoots({ mode: 'workspace-write', workspaceRoot: join(base, 'workspace') })
  for (const root of roots) {
    const rel = relative(root, join(base, 'outside'))
    expect(
      rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../')),
      `denial fixture must be outside authorized root ${root}`,
    ).toBe(false)
  }
  return base
}
