/**
 * Artifact-root resolution uses a canonical complete candidate before mkdir.
 * The filesystem is synthetic: no test creates paths under a real user home.
 * @module tests/unit/enrichment-output-dir
 */

import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveOutputDir, type OutputDirDeps } from '../../src/enrichment/output-dir.ts'
import { ZOTERO_ENRICHMENT_OUTPUT_INVALID } from '../../src/errors.ts'

const home = '/Users/artifact-root-test'
const defaultRoot = `${home}/.dsh/zotero-parsed`
const readonly = { create: false, readOnly: true, allowMissing: true } as const
const invalid = { code: ZOTERO_ENRICHMENT_OUTPUT_INVALID }

beforeEach(() => {
  vi.stubEnv('DSH_HOME', `${home}/.dsh`)
})
afterEach(() => vi.unstubAllEnvs())

function filesystem() {
  const directories = new Set(['/', '/Users', home, '/tmp', '/private', '/private/etc'])
  const aliases = new Map<string, string>()
  const absent = (path: string) => Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
  const add = (path: string) => {
    for (let current = path; !directories.has(current); current = dirname(current)) {
      directories.add(current)
    }
  }
  const deps = {
    home: () => home,
    temp: () => '/tmp',
    realpath: vi.fn(async (path: string) => {
      const alias = [...aliases].find(([from]) => path === from || path.startsWith(from + '/'))
      const candidate = alias ? alias[1] + path.slice(alias[0].length) : path
      if (!directories.has(candidate)) throw absent(path)
      return candidate
    }),
    stat: vi.fn(async (path: string): Promise<{ isDirectory(): boolean }> => {
      if (!directories.has(path)) throw absent(path)
      return { isDirectory: () => true }
    }),
    access: vi.fn(async (path: string, _mode: number) => {
      if (!directories.has(path)) throw absent(path)
    }),
    mkdir: vi.fn(async (path: string) => {
      add(path)
    }),
  } satisfies OutputDirDeps
  return { deps, directories, aliases, add }
}

describe('resolveOutputDir creation and safety', () => {
  it('creates the missing harness default when no options override the policy', async () => {
    const fs = filesystem()
    await expect(resolveOutputDir('', fs.deps)).resolves.toBe(defaultRoot)
    expect(fs.deps.mkdir).toHaveBeenCalledExactlyOnceWith(defaultRoot)
  })

  it('accepts an existing configured directory without creating it', async () => {
    const fs = filesystem()
    const target = `${home}/parsed`
    fs.add(target)
    await expect(resolveOutputDir(target, fs.deps)).resolves.toBe(target)
    expect(fs.deps.mkdir).not.toHaveBeenCalled()
  })

  it('requires a configured directory to exist unless creation is explicitly enabled', async () => {
    const fs = filesystem()
    await expect(resolveOutputDir(`${home}/missing`, fs.deps)).rejects.toMatchObject({
      ...invalid,
      message: expect.stringContaining('ENOENT'),
    })
    expect(fs.deps.mkdir).not.toHaveBeenCalled()
  })

  it('allows explicit creation of a new child below the home directory', async () => {
    const fs = filesystem()
    const target = `${home}/new/parsed`
    await expect(resolveOutputDir(target, fs.deps, { create: true })).resolves.toBe(target)
    expect(fs.deps.mkdir).toHaveBeenCalledExactlyOnceWith(target)
  })

  it('expands a leading tilde before validating the configured directory', async () => {
    const fs = filesystem()
    const target = join(homedir(), 'papers-parsed')
    fs.add(target)
    await expect(resolveOutputDir('~/papers-parsed', fs.deps)).resolves.toBe(target)
  })

  it('refuses a relative path before creating directories', async () => {
    const fs = filesystem()
    await expect(resolveOutputDir('relative/dir', fs.deps, { create: true })).rejects.toMatchObject(
      {
        ...invalid,
        message: expect.stringContaining('not absolute'),
      },
    )
    expect(fs.deps.mkdir).not.toHaveBeenCalled()
  })

  it.each(['/', home, `${home}/.ssh/parsed`, `${home}/.gnupg/parsed`, '/usr/local/share'])(
    'rejects the sensitive candidate %s before mkdir',
    async (target) => {
      const fs = filesystem()
      await expect(resolveOutputDir(target, fs.deps, { create: true })).rejects.toMatchObject({
        ...invalid,
        message: expect.stringContaining('sensitive'),
      })
      expect(fs.deps.mkdir).not.toHaveBeenCalled()
    },
  )

  it('rejects a sensitive default before any mkdir', async () => {
    vi.stubEnv('DSH_HOME', `${home}/.ssh`)
    const fs = filesystem()
    await expect(resolveOutputDir('', fs.deps)).rejects.toMatchObject({
      ...invalid,
      message: expect.stringContaining('sensitive'),
    })
    expect(fs.deps.mkdir).not.toHaveBeenCalled()
  })

  it('rejects a missing suffix reached through a symlink into a sensitive root', async () => {
    const fs = filesystem()
    fs.aliases.set(`${home}/innocent-link`, '/private/etc')
    fs.aliases.set('/etc', '/private/etc')
    await expect(
      resolveOutputDir(`${home}/innocent-link/new/parsed`, fs.deps, {
        create: true,
      }),
    ).rejects.toMatchObject({ ...invalid, message: expect.stringContaining('sensitive') })
    expect(fs.deps.mkdir).not.toHaveBeenCalled()
  })

  it('creates at the complete canonical candidate below an existing symlink', async () => {
    const fs = filesystem()
    fs.add(`${home}/canonical`)
    fs.aliases.set(`${home}/alias`, `${home}/canonical`)
    await expect(
      resolveOutputDir(`${home}/alias/new/parsed`, fs.deps, {
        create: true,
      }),
    ).resolves.toBe(`${home}/canonical/new/parsed`)
    expect(fs.deps.mkdir).toHaveBeenCalledExactlyOnceWith(`${home}/canonical/new/parsed`)
  })

  it('propagates ancestor permission failure rather than walking past it', async () => {
    const fs = filesystem()
    const original = fs.deps.realpath.getMockImplementation()!
    fs.deps.realpath.mockImplementation(async (path) => {
      if (path === `${home}/blocked`)
        throw Object.assign(new Error('EACCES: blocked'), { code: 'EACCES' })
      return await original(path)
    })
    await expect(
      resolveOutputDir(`${home}/blocked/new/parsed`, fs.deps, {
        create: true,
      }),
    ).rejects.toMatchObject({ ...invalid, message: expect.stringContaining('EACCES') })
    expect(fs.deps.mkdir).not.toHaveBeenCalled()
    expect(fs.deps.realpath.mock.calls.map(([path]) => path)).not.toContain(home)
  })

  it('propagates permission failures while canonicalizing a sensitive root', async () => {
    const fs = filesystem()
    const original = fs.deps.realpath.getMockImplementation()!
    fs.deps.realpath.mockImplementation(async (path) => {
      if (path === '/etc') throw Object.assign(new Error('EACCES: etc'), { code: 'EACCES' })
      return await original(path)
    })
    await expect(resolveOutputDir(`${home}/new`, fs.deps, { create: true })).rejects.toMatchObject({
      ...invalid,
      message: expect.stringContaining('EACCES'),
    })
    expect(fs.deps.mkdir).not.toHaveBeenCalled()
  })

  it('refuses a path that is not a directory', async () => {
    const fs = filesystem()
    fs.add(`${home}/file`)
    fs.deps.stat.mockResolvedValue({ isDirectory: () => false })
    await expect(resolveOutputDir(`${home}/file`, fs.deps)).rejects.toMatchObject({
      ...invalid,
      message: expect.stringContaining('not a directory'),
    })
  })

  it('refuses an unwritable active directory', async () => {
    const fs = filesystem()
    fs.add(`${home}/parsed`)
    fs.deps.access.mockImplementation(async (_path, mode) => {
      if (mode & constants.W_OK) throw new Error('EACCES: write denied')
    })
    await expect(resolveOutputDir(`${home}/parsed`, fs.deps)).rejects.toMatchObject({
      ...invalid,
      message: expect.stringContaining('not writable'),
    })
  })

  it('reports failure to create the default directory', async () => {
    const fs = filesystem()
    fs.deps.mkdir.mockRejectedValue(new Error('EACCES: mkdir'))
    await expect(resolveOutputDir('', fs.deps)).rejects.toMatchObject({
      ...invalid,
      message: expect.stringContaining('could not create the default directory'),
    })
  })
})

describe('resolveOutputDir read-only roots', () => {
  it('uses the injected canonicalizer for a complete missing candidate', async () => {
    const fs = filesystem()
    const target = `${home}/alias/new/root`
    const canonical = `${home}/canonical/new/root`
    const canonicalize = vi.fn(async (path: string) => (path === target ? canonical : path))

    await expect(resolveOutputDir(target, { ...fs.deps, canonicalize }, readonly)).resolves.toBe(
      canonical,
    )
    expect(canonicalize).toHaveBeenCalledWith(target)
    expect(fs.deps.realpath).not.toHaveBeenCalled()
    expect(fs.deps.mkdir).not.toHaveBeenCalled()
  })

  it.each(['', `${home}/not-yet/parsed`])(
    'returns the missing canonical root for %j without creating it',
    async (configured) => {
      const fs = filesystem()
      await expect(resolveOutputDir(configured, fs.deps, readonly)).resolves.toBe(
        configured || defaultRoot,
      )
      expect(fs.deps.mkdir).not.toHaveBeenCalled()
      expect(fs.deps.access.mock.calls.every(([, mode]) => mode === constants.R_OK)).toBe(true)
    },
  )

  it('preserves the missing suffix below a canonical existing ancestor', async () => {
    const fs = filesystem()
    fs.add(`${home}/canonical`)
    fs.aliases.set(`${home}/alias`, `${home}/canonical`)
    await expect(resolveOutputDir(`${home}/alias/missing/root`, fs.deps, readonly)).resolves.toBe(
      `${home}/canonical/missing/root`,
    )
    expect(fs.deps.mkdir).not.toHaveBeenCalled()
  })

  it('checks an existing root for R_OK without asking for write access', async () => {
    const fs = filesystem()
    const target = `${home}/readable`
    fs.add(target)
    fs.deps.access.mockImplementation(async (_path, mode) => {
      if (mode & constants.W_OK) throw new Error('EACCES: read-only filesystem')
    })
    await expect(resolveOutputDir(target, fs.deps, readonly)).resolves.toBe(target)
    expect(fs.deps.access).toHaveBeenCalledWith(target, constants.R_OK)
    expect(fs.deps.access.mock.calls.every(([, mode]) => mode === constants.R_OK)).toBe(true)
    expect(fs.deps.mkdir).not.toHaveBeenCalled()
  })

  it('reports unreadable roots rather than accepting them as missing', async () => {
    const fs = filesystem()
    const target = `${home}/unreadable`
    fs.add(target)
    fs.deps.access.mockImplementation(async (path) => {
      if (path === target) throw Object.assign(new Error('EACCES: read denied'), { code: 'EACCES' })
    })
    await expect(resolveOutputDir(target, fs.deps, readonly)).rejects.toMatchObject({
      ...invalid,
      message: expect.stringContaining('not readable'),
    })
    expect(fs.deps.mkdir).not.toHaveBeenCalled()
  })

  it('honors create false for a missing default even without allowMissing', async () => {
    const fs = filesystem()
    await expect(resolveOutputDir('', fs.deps, { create: false })).rejects.toMatchObject({
      ...invalid,
      message: expect.stringContaining('ENOENT'),
    })
    expect(fs.deps.mkdir).not.toHaveBeenCalled()
  })

  it('keeps readOnly resolution non-creating even when create is true', async () => {
    const fs = filesystem()
    await expect(
      resolveOutputDir('', fs.deps, {
        readOnly: true,
        allowMissing: true,
        create: true,
      }),
    ).resolves.toBe(defaultRoot)
    expect(fs.deps.mkdir).not.toHaveBeenCalled()
  })

  it('does not hide stat permission errors as an allowed missing root', async () => {
    const fs = filesystem()
    const target = `${home}/blocked`
    fs.add(target)
    fs.deps.stat.mockImplementation(async (path) => {
      if (path === target) throw Object.assign(new Error('EACCES: stat denied'), { code: 'EACCES' })
      return { isDirectory: () => true }
    })
    await expect(resolveOutputDir(target, fs.deps, readonly)).rejects.toMatchObject({
      ...invalid,
      message: expect.stringContaining('EACCES'),
    })
    expect(fs.deps.mkdir).not.toHaveBeenCalled()
  })
})
