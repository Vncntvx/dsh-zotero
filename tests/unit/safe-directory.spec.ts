/**
 * The shared writable-directory resolver: absolute shape, existence/writability,
 * sensitive-root and symlink-escape refusals in canonical space, the creation
 * policy, and validation of the complete canonical candidate before creation.
 * @module tests/unit/safe-directory
 */

import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  resolveSafeDirectory,
  type SafeDirectoryDeps,
} from '../../src/enrichment/safe-directory.ts'
import { ZOTERO_ENRICHMENT_OUTPUT_INVALID } from '../../src/errors.ts'

const roots: string[] = []

afterEach(async () => {
  const current = roots.splice(0)
  await Promise.all(current.map((root) => rm(root, { recursive: true, force: true })))
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-safe-'))
  roots.push(root)
  return root
}

function deps(): SafeDirectoryDeps {
  return {
    realpath,
    stat,
    access,
    mkdir: async (path) => {
      await mkdir(path, { recursive: true })
    },
  }
}

describe('resolveSafeDirectory', () => {
  it('creates and validates the default root for an empty value', async () => {
    const root = await tempRoot()
    const defaultRoot = join(root, 'models')
    const resolved = await resolveSafeDirectory({
      configured: '',
      defaultRoot,
      create: true,
      errorCode: ZOTERO_ENRICHMENT_OUTPUT_INVALID,
      label: 'model directory',
      deps: deps(),
    })
    expect(resolved).toBe(await realpath(defaultRoot))
  })

  it('refuses a relative configured path', async () => {
    const root = await tempRoot()
    await expect(
      resolveSafeDirectory({
        configured: 'relative/dir',
        defaultRoot: join(root, 'x'),
        create: true,
        errorCode: ZOTERO_ENRICHMENT_OUTPUT_INVALID,
        label: 'model directory',
        deps: deps(),
      }),
    ).rejects.toThrow(/not absolute/)
  })

  it('refuses a configured path that does not exist when creation is off', async () => {
    const root = await tempRoot()
    await expect(
      resolveSafeDirectory({
        configured: join(root, 'missing'),
        defaultRoot: join(root, 'x'),
        create: false,
        errorCode: ZOTERO_ENRICHMENT_OUTPUT_INVALID,
        label: 'output directory',
        deps: deps(),
      }),
    ).rejects.toThrow(/does not exist \(ENOENT\)/)
  })

  it('creates a missing configured path when creation is on, after validating the ancestor', async () => {
    const root = await tempRoot()
    const target = join(root, 'a', 'b', 'models')
    const resolved = await resolveSafeDirectory({
      configured: target,
      defaultRoot: join(root, 'x'),
      create: true,
      errorCode: ZOTERO_ENRICHMENT_OUTPUT_INVALID,
      label: 'model directory',
      deps: deps(),
    })
    // The resolver returns the canonical path; macOS /var → /private/var.
    expect(resolved).toBe(await realpath(target))
  })

  it('refuses the home directory itself and the filesystem root', async () => {
    const root = await tempRoot()
    for (const candidate of [homedir(), '/']) {
      await expect(
        resolveSafeDirectory({
          configured: candidate,
          defaultRoot: join(root, 'x'),
          create: true,
          errorCode: ZOTERO_ENRICHMENT_OUTPUT_INVALID,
          label: 'model directory',
          deps: deps(),
        }),
      ).rejects.toThrow(/sensitive/)
    }
  })

  it('refuses a symlink that escapes into a sensitive root', async () => {
    const root = await tempRoot()
    // macOS /etc → /private/etc is the classic case; /etc is a sensitive root
    // on every platform this test runs on.
    const link = join(root, 'escape')
    await symlink('/etc', link)
    await expect(
      resolveSafeDirectory({
        configured: link,
        defaultRoot: join(root, 'x'),
        create: true,
        errorCode: ZOTERO_ENRICHMENT_OUTPUT_INVALID,
        label: 'model directory',
        deps: deps(),
      }),
    ).rejects.toThrow(/sensitive/)
  })

  it('refuses creation inside a sensitive ancestor instead of creating first', async () => {
    const root = await tempRoot()
    // A non-existent path whose nearest existing ancestor is sensitive.
    const target = join(homedir(), '.ssh', 'never-created', 'models')
    await expect(
      resolveSafeDirectory({
        configured: target,
        defaultRoot: join(root, 'x'),
        create: true,
        errorCode: ZOTERO_ENRICHMENT_OUTPUT_INVALID,
        label: 'model directory',
        deps: deps(),
      }),
    ).rejects.toThrow(/sensitive/)
  })

  it('refuses a file, and a directory that is not writable', async () => {
    const root = await tempRoot()
    const filePath = join(root, 'a-file')
    await writeFile(filePath, 'x')
    await expect(
      resolveSafeDirectory({
        configured: filePath,
        defaultRoot: join(root, 'x'),
        create: true,
        errorCode: ZOTERO_ENRICHMENT_OUTPUT_INVALID,
        label: 'model directory',
        deps: deps(),
      }),
    ).rejects.toThrow(/not a directory/)

    const readOnly = join(root, 'read-only')
    await mkdir(readOnly)
    await chmod(readOnly, 0o500)
    try {
      if (process.platform !== 'win32') {
        await expect(
          resolveSafeDirectory({
            configured: readOnly,
            defaultRoot: join(root, 'x'),
            create: true,
            errorCode: ZOTERO_ENRICHMENT_OUTPUT_INVALID,
            label: 'model directory',
            deps: deps(),
          }),
        ).rejects.toThrow(/not writable/)
      }
    } finally {
      await chmod(readOnly, 0o700)
    }
  })
})
