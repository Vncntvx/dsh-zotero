/**
 * The parsed-artifact output directory: default resolution, and refusal of
 * relative, missing, non-directory, unwritable, sensitive, or symlink-escaped
 * paths. All filesystem seams are injected so no test touches the real disk.
 * @module tests/unit/parsing-output-dir
 */

import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { resolveOutputDir, type OutputDirDeps } from '../../src/parsing/output-dir.ts'
import { ZOTERO_PARSING_OUTPUT_INVALID } from '../../src/errors.ts'

function deps(overrides: Partial<OutputDirDeps> = {}): OutputDirDeps {
  return {
    realpath: async (path) => path,
    stat: async () => ({ isDirectory: () => true }),
    access: async () => {},
    mkdir: async () => {},
    ...overrides,
  }
}

describe('resolveOutputDir', () => {
  it('creates and returns the harness default for an empty value', async () => {
    const mkdir = vi.fn(async () => {})
    const result = await resolveOutputDir('', deps({ mkdir }))
    expect(result.endsWith(join('zotero-parsed'))).toBe(true)
    expect(mkdir).toHaveBeenCalledWith(result)
  })

  it('accepts an existing absolute writable directory', async () => {
    const target = resolve('/tmp/dsh-zotero-parsed-test')
    await expect(resolveOutputDir(target, deps())).resolves.toBe(target)
  })

  it('expands a leading tilde before validating', async () => {
    const target = join(homedir(), 'papers-parsed')
    await expect(resolveOutputDir('~/papers-parsed', deps())).resolves.toBe(target)
  })

  it('refuses a relative path', async () => {
    await expect(resolveOutputDir('relative/dir', deps())).rejects.toMatchObject({
      code: ZOTERO_PARSING_OUTPUT_INVALID,
      message: expect.stringContaining('not absolute'),
    })
  })

  it('refuses an unresolvable path with the resolver reason', async () => {
    const depsWithFailure = deps({
      realpath: async () => {
        throw new Error('ENOENT: no such file')
      },
    })
    await expect(resolveOutputDir('/nonexistent/dir', depsWithFailure)).rejects.toMatchObject({
      code: ZOTERO_PARSING_OUTPUT_INVALID,
      message: expect.stringContaining('ENOENT'),
    })
  })

  it('refuses a path that is not a directory', async () => {
    const depsNotDir = deps({ stat: async () => ({ isDirectory: () => false }) })
    await expect(resolveOutputDir('/tmp/file.txt', depsNotDir)).rejects.toMatchObject({
      code: ZOTERO_PARSING_OUTPUT_INVALID,
      message: expect.stringContaining('not a directory'),
    })
  })

  it('refuses an unwritable directory', async () => {
    const depsReadOnly = deps({
      access: async () => {
        throw new Error('EACCES')
      },
    })
    await expect(resolveOutputDir('/tmp/read-only', depsReadOnly)).rejects.toMatchObject({
      code: ZOTERO_PARSING_OUTPUT_INVALID,
      message: expect.stringContaining('not writable'),
    })
  })

  it('refuses the home directory and the filesystem root', async () => {
    await expect(resolveOutputDir(homedir(), deps())).rejects.toMatchObject({
      code: ZOTERO_PARSING_OUTPUT_INVALID,
      message: expect.stringContaining('sensitive'),
    })
    await expect(resolveOutputDir(sep, deps())).rejects.toMatchObject({
      code: ZOTERO_PARSING_OUTPUT_INVALID,
    })
  })

  it('refuses a symlink whose realpath lands in a sensitive system directory', async () => {
    // The configured path looks harmless; realpath reveals /etc. Map only the
    // candidate, not every path, or the temp-root exception would mask it.
    const escaped = deps({
      realpath: async (path) => (path === '/tmp/innocent-link' ? resolve('/etc') : path),
    })
    await expect(resolveOutputDir('/tmp/innocent-link', escaped)).rejects.toMatchObject({
      code: ZOTERO_PARSING_OUTPUT_INVALID,
      message: expect.stringContaining('sensitive'),
    })
  })

  it('refuses a macOS canonical sensitive directory reached through /private', async () => {
    const mac = deps({
      realpath: async (path) => (path === '/etc' ? '/private/etc' : path),
    })
    await expect(resolveOutputDir('/private/etc/parsed', mac)).rejects.toMatchObject({
      code: ZOTERO_PARSING_OUTPUT_INVALID,
      message: expect.stringContaining('sensitive'),
    })
  })

  it('refuses a credential-bearing user directory', async () => {
    const target = join(homedir(), '.ssh', 'parsed')
    await expect(resolveOutputDir(target, deps())).rejects.toMatchObject({
      code: ZOTERO_PARSING_OUTPUT_INVALID,
      message: expect.stringContaining('sensitive'),
    })
  })

  it('refuses a system directory even when it resolves to itself', async () => {
    await expect(resolveOutputDir('/usr/local/share', deps())).rejects.toMatchObject({
      code: ZOTERO_PARSING_OUTPUT_INVALID,
    })
  })

  it('reports a failure to create the default directory', async () => {
    const failing = deps({
      mkdir: async () => {
        throw new Error('EACCES')
      },
    })
    await expect(resolveOutputDir('', failing)).rejects.toMatchObject({
      code: ZOTERO_PARSING_OUTPUT_INVALID,
      message: expect.stringContaining('could not create the default directory'),
    })
  })
})
