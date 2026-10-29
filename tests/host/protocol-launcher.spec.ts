/** Native launcher callbacks contain asynchronous process errors. */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeOpenProtocol } from '../../src/remote.ts'

let directory: string | undefined
afterEach(async () => {
  vi.unstubAllEnvs()
  if (directory) await rm(directory, { recursive: true, force: true })
})
it('contains a real ENOENT failure without terminating the host', async () => {
  directory = await mkdtemp(join(tmpdir(), 'zotero-launch-'))
  vi.stubEnv('PATH', directory)
  const result = await executeOpenProtocol('zotero://select/', 'linux')
  expect(result.ok).toBe(false)
  expect(result.error).toContain('ENOENT')
  expect(process.pid).toBeGreaterThan(0)
})
it.runIf(process.platform !== 'win32')('reports a real launcher nonzero exit', async () => {
  directory = await mkdtemp(join(tmpdir(), 'zotero-launch-'))
  const executable = join(directory, 'xdg-open')
  await writeFile(executable, '#!/bin/sh\nexit 7\n')
  await chmod(executable, 0o700)
  vi.stubEnv('PATH', directory)
  expect((await executeOpenProtocol('zotero://select/', 'linux')).ok).toBe(false)
})
