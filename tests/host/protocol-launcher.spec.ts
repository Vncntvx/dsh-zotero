/** Native launcher callbacks contain asynchronous process errors. */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rejectionOf } from './support/open-protocol.ts'

let directory: string | undefined
afterEach(async () => {
  vi.unstubAllEnvs()
  if (directory) await rm(directory, { recursive: true, force: true })
})

it('contains a real ENOENT failure without terminating the host', async () => {
  directory = await mkdtemp(join(tmpdir(), 'zotero-launch-'))
  vi.stubEnv('PATH', directory)
  const url = 'zotero://select/'
  const failure = await rejectionOf(url)
  expect(failure).toMatchObject({
    code: 'zotero/protocol-failed',
    details: { url, reason: expect.stringContaining('ENOENT') },
  })
  expect(failure.cause).toBeInstanceOf(Error)
  expect(process.pid).toBeGreaterThan(0)
})
it.runIf(process.platform !== 'win32')('reports a real launcher nonzero exit', async () => {
  directory = await mkdtemp(join(tmpdir(), 'zotero-launch-'))
  const executable = join(directory, 'xdg-open')
  await writeFile(executable, '#!/bin/sh\nexit 7\n')
  await chmod(executable, 0o700)
  vi.stubEnv('PATH', directory)
  const url = 'zotero://select/'
  const failure = await rejectionOf(url)
  expect(failure).toMatchObject({
    code: 'zotero/protocol-failed',
    details: { url, reason: expect.any(String) },
  })
  expect(failure.cause).toBeInstanceOf(Error)
})

it('renders a non-Error launcher throw through errorMessageOf', async () => {
  const thrown = 'launcher refused without an Error object'
  const url = 'zotero://select/'
  const failure = await rejectionOf(url, {
    platform: 'linux',
    launcher: () => {
      throw thrown
    },
  })
  expect(failure).toMatchObject({
    code: 'zotero/protocol-failed',
    details: { url, reason: String(thrown) },
  })
  expect(failure.cause).toBe(thrown)
})
