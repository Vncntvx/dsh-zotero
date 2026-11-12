/**
 * Cross-platform path-resolution edge behaviours: mount-table lines that are
 * not WSL drive records, the process-wide mount scan, root-shaped drive and
 * WSL mount URLs, UNC/WSL-UNC candidates, and a discovered drive whose file
 * is missing.
 * @module tests/local/path-resolution-arms
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZOTERO_FILE_MISSING } from '../../src/errors.js'
import {
  candidateLocalPaths,
  clearWslMountsCache,
  discoverWslMounts,
  parseAttachmentFileUrl,
  parseWslMounts,
  resolveExistingAttachmentPath,
} from '../../src/local/path-resolution.js'
import { zoteroError } from '../helpers/server/assert.js'

const fsMock = vi.hoisted(() => ({
  readFileSync: vi.fn<(path: string, encoding: string) => string>(),
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, readFileSync: fsMock.readFileSync }
})

beforeEach(() => {
  clearWslMountsCache()
  fsMock.readFileSync.mockReset()
})

afterEach(() => {
  clearWslMountsCache()
})

describe('parseWslMounts line filtering', () => {
  it('ignores a mount line that mentions WSL but is not a drive mount', () => {
    const mapping = parseWslMounts(
      [
        'weird9p',
        'foo /mnt/c9p ext4 rw 0 0',
        'C:\\ /mnt/c 9p rw,noatime,dirsync,uid=1000 0 0',
      ].join('\n'),
    )
    expect([...mapping.entries()]).toEqual([['c', ['/mnt/c']]])
  })

  it('records no mount for a three-field drvfs line without a drive spec', () => {
    expect(parseWslMounts('none /custom/e drvfs')).toEqual(new Map())
  })

  it('deduplicates a mount path recorded by two lines for the same drive', () => {
    const mapping = parseWslMounts(['C:\\ /mnt/c 9p rw 0 0', 'C:\\ /mnt/c drvfs rw 0 0'].join('\n'))
    expect(mapping.get('c')).toEqual(['/mnt/c'])
  })
})

describe('discoverWslMounts process cache', () => {
  it('reads the default mount table once across default calls', () => {
    fsMock.readFileSync.mockReturnValue('C:\\ /mnt/c 9p rw 0 0\n')
    const first = discoverWslMounts()
    const second = discoverWslMounts()
    expect(fsMock.readFileSync).toHaveBeenCalledTimes(1)
    expect(fsMock.readFileSync).toHaveBeenCalledWith('/proc/mounts', 'utf-8')
    expect(first.get('c')).toEqual(['/mnt/c'])
    expect(second).toBe(first)
  })
})

describe('parseAttachmentFileUrl root forms', () => {
  it('parses a WSL UNC URL without a distribution segment', () => {
    expect(parseAttachmentFileUrl(new URL('file://wsl.localhost'), 'linux')).toEqual({
      kind: 'wsl-unc',
      distro: '',
      subpath: '/',
      reported: 'file://wsl.localhost/',
    })
  })

  it('normalizes a drive-root Windows path to a slash subpath', () => {
    expect(parseAttachmentFileUrl(new URL('file:///C:'), 'linux')).toEqual({
      kind: 'windows-drive',
      drive: 'c',
      subpath: '/',
      reported: '/C:',
    })
  })

  it('treats a POSIX path on Windows as a local path', () => {
    expect(parseAttachmentFileUrl(new URL('file:///Users/alice/doc.pdf'), 'win32')).toEqual({
      kind: 'local-path',
      path: '/Users/alice/doc.pdf',
      reported: '/Users/alice/doc.pdf',
    })
  })

  it('normalizes a WSL drive mount root on Windows to a slash subpath', () => {
    expect(parseAttachmentFileUrl(new URL('file:///mnt/c'), 'win32')).toEqual({
      kind: 'wsl-mount-on-windows',
      drive: 'c',
      subpath: '/',
      reported: '/mnt/c',
    })
  })
})

describe('candidateLocalPaths location kinds', () => {
  it('maps a remote UNC location to its UNC path', () => {
    const parsed = parseAttachmentFileUrl(new URL('file://nas.example/share/a.pdf'), 'linux')
    expect(candidateLocalPaths(parsed, { platform: 'linux' })).toEqual([
      '\\\\nas.example\\share\\a.pdf',
    ])
  })

  it('maps a WSL UNC location to a backslash path on Windows', () => {
    const parsed = parseAttachmentFileUrl(
      new URL('file://wsl.localhost/Ubuntu/home/alice/a.pdf'),
      'linux',
    )
    expect(candidateLocalPaths(parsed, { platform: 'win32' })).toEqual([
      '\\\\wsl.localhost\\Ubuntu\\home\\alice\\a.pdf',
    ])
  })

  it('offers only the /mnt/wsl candidate when another distribution is current', () => {
    const parsed = parseAttachmentFileUrl(
      new URL('file://wsl.localhost/Ubuntu/home/alice/a.pdf'),
      'linux',
    )
    expect(
      candidateLocalPaths(parsed, {
        platform: 'linux',
        env: { WSL_DISTRO_NAME: 'Debian' },
      }),
    ).toEqual(['/mnt/wsl/Ubuntu/home/alice/a.pdf'])
  })
})

describe('resolveExistingAttachmentPath discovered mounts', () => {
  it('reports a missing file when the drive was discovered in the mount table', async () => {
    const url = new URL('file:///C:/Users/alice/paper.pdf')
    const error = await zoteroError(
      resolveExistingAttachmentPath(url, {
        access: async () => {
          const missing = new Error('ENOENT') as NodeJS.ErrnoException
          missing.code = 'ENOENT'
          throw missing
        },
        platform: 'linux',
        env: { WSL_DISTRO_NAME: 'Ubuntu' },
        readFileSync: () => 'C:\\ /mnt/c 9p rw 0 0\n',
      }),
      ZOTERO_FILE_MISSING,
    )
    expect(error.message).toBe(
      'The attachment file is missing from disk: /C:/Users/alice/paper.pdf',
    )
  })
})
