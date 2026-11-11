/** WP4/D5: preflight checks use the full candidate before any mkdir. */
import { describe, expect, it } from 'vitest'
import {
  resolveSafeDirectory,
  type SafeDirectoryDeps,
} from '../../src/enrichment/safe-directory.ts'
import { ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED } from '../../src/errors.ts'

function filesystem() {
  const home = '/Users/wp4-synthetic-user'
  const directories = new Set(['/', '/Users', home])
  const created: string[] = []
  const absent = (path: string) => Object.assign(new Error(`missing: ${path}`), { code: 'ENOENT' })
  const deps: SafeDirectoryDeps = {
    home: () => home,
    temp: () => '/tmp/wp4-synthetic-temp',
    realpath: async (path) => {
      if (!directories.has(path)) throw absent(path)
      return path
    },
    stat: async (path) => {
      if (!directories.has(path)) throw absent(path)
      return { isDirectory: () => true }
    },
    access: async (path) => {
      if (!directories.has(path)) throw absent(path)
    },
    mkdir: async (path) => {
      created.push(path)
      let current = ''
      for (const part of path.split('/').filter(Boolean)) {
        current += `/${part}`
        directories.add(current)
      }
    },
  }
  return { home, created, deps }
}

const directoryOptions = {
  errorCode: ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED,
  label: 'semantic model directory',
} as const

describe('semantic model directory preflight', () => {
  it('allows a new models child whose existing ancestor is the home directory', async () => {
    const fs = filesystem()
    const candidate = `${fs.home}/models`
    await expect(
      resolveSafeDirectory({
        ...directoryOptions,
        configured: candidate,
        defaultRoot: `${fs.home}/.dsh/models`,
        create: true,
        deps: fs.deps,
      }),
    ).resolves.toBe(candidate)
    expect(fs.created).toEqual([candidate])
  })

  it('rejects a sensitive default path before mkdir can touch it', async () => {
    const fs = filesystem()
    const outcome = await resolveSafeDirectory({
      ...directoryOptions,
      configured: '',
      defaultRoot: `${fs.home}/.ssh/models`,
      create: true,
      deps: fs.deps,
    }).then(
      (value) => value,
      (error: unknown) => error,
    )

    expect(outcome).toMatchObject({ code: ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED })
    expect(fs.created).toEqual([])
  })

  it('honors read-only resolution for a missing default root', async () => {
    const fs = filesystem()
    await resolveSafeDirectory({
      ...directoryOptions,
      configured: '',
      defaultRoot: `${fs.home}/.dsh/models`,
      create: false,
      deps: fs.deps,
    }).catch(() => undefined)

    expect(fs.created).toEqual([])
  })
})
