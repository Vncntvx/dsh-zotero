/**
 * The download client's destination-parent race windows: a missing segment that
 * becomes a non-directory between the initial scan and the creation pass, and a
 * final parent that stops being a directory after creation. Each case plants a
 * real entry at the synchronized lstat so the production guard sees the race.
 * @module tests/host/enrichment/model-transport-races
 */
import { lstat, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'

import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hostDownloadFsDeps } from '../../../src/enrichment/model-download-client.ts'
import { createModelSandbox } from './support/model-sandbox.ts'

const control = vi.hoisted(() => ({
  lstat: undefined as undefined | ((path: string) => Promise<void> | void),
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      await control.lstat?.(String(args[0]))
      return await actual.lstat(...args)
    },
  }
})

const sandbox = createModelSandbox('dsh-transport-races-')

afterEach(async () => {
  control.lstat = undefined
  await sandbox.settle()
})

describe('destination parent race guards', () => {
  it('refuses a symlink that appears while a missing parent segment is created', async () => {
    const root = await sandbox.root()
    const outside = await sandbox.root()
    const segment = join(await realpath(root), 'a')
    let calls = 0
    control.lstat = async (path) => {
      if (path !== segment) return
      calls += 1
      if (calls === 1) await symlink(outside, segment)
    }

    await expect(hostDownloadFsDeps.mkdir(join(root, 'a', 'b'))).rejects.toThrow(
      /not a regular directory/,
    )
    expect(calls).toBe(1)
  })

  it('refuses a regular file that appears while a missing parent segment is created', async () => {
    const root = await sandbox.root()
    const segment = join(await realpath(root), 'a')
    let calls = 0
    control.lstat = async (path) => {
      if (path !== segment) return
      calls += 1
      if (calls === 1) await writeFile(segment, 'not a directory')
    }

    await expect(hostDownloadFsDeps.mkdir(join(root, 'a', 'b'))).rejects.toThrow(
      /not a regular directory/,
    )
    expect(calls).toBe(1)
  })

  it('accepts a directory another writer created while the segments were scanned', async () => {
    const root = await sandbox.root()
    const segment = join(await realpath(root), 'a')
    let calls = 0
    control.lstat = async (path) => {
      if (path !== segment) return
      calls += 1
      if (calls === 1) await mkdir(segment)
    }

    await hostDownloadFsDeps.mkdir(join(root, 'a', 'b'))
    expect(calls).toBeGreaterThanOrEqual(1)
    expect((await lstat(join(root, 'a', 'b'))).isDirectory()).toBe(true)
  })

  it('refuses a final parent that stops being a directory after creation', async () => {
    const root = await sandbox.root()
    const outside = await sandbox.root()
    const leaf = join(await realpath(root), 'leaf')
    let calls = 0
    control.lstat = async (path) => {
      if (path !== leaf) return
      calls += 1
      if (calls !== 2) return
      await rm(leaf, { recursive: true, force: true })
      await symlink(outside, leaf)
    }

    await expect(hostDownloadFsDeps.mkdir(join(root, 'leaf'))).rejects.toThrow(
      /not a regular directory/,
    )
    expect(calls).toBe(2)
  })
})
