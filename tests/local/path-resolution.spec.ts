/**
 * Specification for the cross-platform attachment path resolution domain.
 * @module tests/local/path-resolution
 */

import { describe, expect, it, vi } from 'vitest'
import { ZOTERO_FILE_MISSING, ZOTERO_FILE_UNREADABLE } from '../../src/errors.js'
import { isWsl, appendWslEnv } from '../../src/environment.js'
import {
  candidateLocalPaths,
  candidateMountRootsForDrive,
  clearWslMountsCache,
  discoverWslMounts,
  parseAttachmentFileUrl,
  parseWslMounts,
  resolveExistingAttachmentPath,
  unmountedDriveMessage,
  unsupportedUncShareMessage,
  unsupportedWslUncMessage,
} from '../../src/local/path-resolution.js'
import { zoteroError } from '../helpers/server/assert.js'

describe('isWsl and appendWslEnv', () => {
  it('detects WSL when WSL_DISTRO_NAME is set', () => {
    expect(isWsl({ WSL_DISTRO_NAME: 'Ubuntu' })).toBe(true)
  })

  it('detects WSL when WSL_INTEROP is set', () => {
    expect(isWsl({ WSL_INTEROP: '/run/WSL/1_interop' })).toBe(true)
  })

  it('returns false when neither WSL variable is present', () => {
    expect(isWsl({})).toBe(false)
  })

  it('appends variable to WSLENV without duplicating', () => {
    expect(appendWslEnv({}, 'VAR_A')).toBe('VAR_A')
    expect(appendWslEnv({ WSLENV: 'VAR_A' }, 'VAR_A')).toBe('VAR_A')
    expect(appendWslEnv({ WSLENV: 'VAR_A:VAR_B' }, 'VAR_C')).toBe('VAR_A:VAR_B:VAR_C')
  })
})

describe('parseWslMounts and discoverWslMounts', () => {
  const mountsText = `
rootfs / 9p rw,dirsync,noatime,aname=drvfs;path=/;uid=1000;gid=1000 0 0
sysfs /sys sysfs rw,nosuid,nodev,noexec,relatime 0 0
proc /proc proc rw,nosuid,nodev,noexec,relatime 0 0
C:\\ /mnt/c 9p rw,noatime,dirsync,aname=drvfs;path=C:\\;uid=1000;gid=1000 0 0
D:\\134 /d drvfs rw,noatime,dirsync,uid=1000;gid=1000 0 0
none /custom/e 9p rw,noatime,dirsync,aname=drvfs;path=E:\\134;uid=1000;gid=1000 0 0
`

  it('extracts drive letters and mount paths including Linux kernel \\134 octal escaping', () => {
    const mapping = parseWslMounts(mountsText)
    expect(mapping.get('c')).toEqual(['/mnt/c'])
    expect(mapping.get('d')).toEqual(['/d'])
    expect(mapping.get('e')).toEqual(['/custom/e'])
    expect(mapping.get('f')).toBeUndefined()
  })

  it('gracefully handles empty or unreadable /proc/mounts', () => {
    const empty = parseWslMounts('')
    expect(empty.size).toBe(0)

    const map = discoverWslMounts({
      readFileSync: () => {
        throw new Error('ENOENT')
      },
    })
    expect(map.size).toBe(0)
  })

  it('caches discovered mounts across calls', () => {
    clearWslMountsCache()
    const reader = vi.fn(() => mountsText)
    const first = discoverWslMounts({ readFileSync: reader })
    expect(first.get('c')).toEqual(['/mnt/c'])
    expect(reader).toHaveBeenCalledTimes(1)
  })
})

describe('candidateMountRootsForDrive', () => {
  it('combines discovered mounts, custom mountRoot, and standard defaults in order without duplicates', () => {
    const mountMap = new Map([['c', ['/mnt/c']]])
    const roots = candidateMountRootsForDrive('C', {
      mountPointsMap: mountMap,
      mountRoot: '/custom',
      platform: 'linux',
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
    })
    expect(roots).toEqual(['/mnt/c', '/custom/c', '/c'])
  })

  it('defaults to /mnt/<drive> and /<drive> without duplicates', () => {
    const roots = candidateMountRootsForDrive('d', {
      platform: 'linux',
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
    })
    expect(roots).toEqual(['/mnt/d', '/d'])
  })
})

describe('parseAttachmentFileUrl', () => {
  it('parses Windows drive URLs on POSIX platform', () => {
    const url = new URL('file:///C:/Users/alice/Zotero/storage/ABC12345/paper.pdf')
    const parsed = parseAttachmentFileUrl(url, 'linux')
    expect(parsed).toEqual({
      kind: 'windows-drive',
      drive: 'c',
      subpath: '/Users/alice/Zotero/storage/ABC12345/paper.pdf',
      reported: '/C:/Users/alice/Zotero/storage/ABC12345/paper.pdf',
    })
  })

  it('fully decodes percent-encoded academic characters (#, +, &, spaces) in Windows drive URLs', () => {
    const url = new URL('file:///D:/Papers/C%2B%2B%20Guide%231%262.pdf')
    const parsed = parseAttachmentFileUrl(url, 'darwin')
    expect(parsed).toEqual({
      kind: 'windows-drive',
      drive: 'd',
      subpath: '/Papers/C++ Guide#1&2.pdf',
      reported: '/D:/Papers/C++ Guide#1&2.pdf',
    })
  })

  it('parses WSL UNC URLs on POSIX platform', () => {
    const url = new URL('file://wsl.localhost/Ubuntu/home/alice/docs/paper.pdf')
    const parsed = parseAttachmentFileUrl(url, 'linux')
    expect(parsed).toEqual({
      kind: 'wsl-unc',
      distro: 'Ubuntu',
      subpath: '/home/alice/docs/paper.pdf',
      reported: 'file://wsl.localhost/Ubuntu/home/alice/docs/paper.pdf',
    })
  })

  it('parses WSL UNC root distro URLs without trailing slash', () => {
    const url = new URL('file://wsl.localhost/Ubuntu')
    const parsed = parseAttachmentFileUrl(url, 'linux')
    expect(parsed).toEqual({
      kind: 'wsl-unc',
      distro: 'Ubuntu',
      subpath: '/',
      reported: 'file://wsl.localhost/Ubuntu',
    })
  })

  it('parses wsl$ UNC host names', () => {
    const url = new URL('file://wsl$/Debian/var/data/ref.pdf')
    const parsed = parseAttachmentFileUrl(url, 'linux')
    expect(parsed).toEqual({
      kind: 'wsl-unc',
      distro: 'Debian',
      subpath: '/var/data/ref.pdf',
      reported: 'file://wsl$/Debian/var/data/ref.pdf',
    })
  })

  it('parses remote UNC hosts safely on POSIX without throwing TypeError', () => {
    const url = new URL('file://server.domain/share/research/paper.pdf')
    const parsed = parseAttachmentFileUrl(url, 'linux')
    expect(parsed).toEqual({
      kind: 'remote-unc',
      uncPath: '\\\\server.domain\\share\\research\\paper.pdf',
      reported: 'file://server.domain/share/research/paper.pdf',
    })
  })

  it('parses 4-slash UNC URLs safely', () => {
    const url = new URL('file:////server.domain/share/research/paper.pdf')
    const parsed = parseAttachmentFileUrl(url, 'linux')
    expect(parsed).toEqual({
      kind: 'remote-unc',
      uncPath: '\\\\server.domain\\share\\research\\paper.pdf',
      reported: 'file:////server.domain/share/research/paper.pdf',
    })
  })

  it('parses WSL mount paths on Windows host', () => {
    const url = new URL('file:///mnt/c/Users/alice/doc.pdf')
    const parsed = parseAttachmentFileUrl(url, 'win32')
    expect(parsed).toEqual({
      kind: 'wsl-mount-on-windows',
      drive: 'c',
      subpath: '/Users/alice/doc.pdf',
      reported: '/mnt/c/Users/alice/doc.pdf',
    })
  })

  it('parses native local URLs on POSIX', () => {
    const url = new URL('file:///home/alice/paper.pdf')
    const parsed = parseAttachmentFileUrl(url, 'linux')
    expect(parsed).toEqual({
      kind: 'local-path',
      path: '/home/alice/paper.pdf',
      reported: '/home/alice/paper.pdf',
    })
  })
})

describe('candidateLocalPaths', () => {
  it('places the literal Windows path before WSL mount candidates', () => {
    const parsed = parseAttachmentFileUrl(new URL('file:///C:/Users/alice/doc.pdf'), 'linux')
    const candidates = candidateLocalPaths(parsed, {
      platform: 'linux',
      mountRoot: '/mnt',
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
    })
    expect(candidates).toEqual([
      '/C:/Users/alice/doc.pdf',
      '/mnt/c/Users/alice/doc.pdf',
      '/c/Users/alice/doc.pdf',
    ])
  })

  it('does not infer WSL mount roots on native POSIX hosts', () => {
    const parsed = parseAttachmentFileUrl(new URL('file:///C:/Users/alice/doc.pdf'), 'linux')
    expect(candidateLocalPaths(parsed, { platform: 'linux', env: {} })).toEqual([
      '/C:/Users/alice/doc.pdf',
    ])
  })

  it('maps WSL UNC to local POSIX path when distro matches in WSL', () => {
    const parsed = parseAttachmentFileUrl(
      new URL('file://wsl.localhost/Ubuntu/home/alice/doc.pdf'),
      'linux',
    )
    const candidates = candidateLocalPaths(parsed, {
      platform: 'linux',
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
    })
    expect(candidates).toEqual(['/home/alice/doc.pdf', '/mnt/wsl/Ubuntu/home/alice/doc.pdf'])
  })

  it('returns empty candidates for WSL UNC on macOS or non-WSL Linux', () => {
    const parsed = parseAttachmentFileUrl(
      new URL('file://wsl.localhost/Ubuntu/home/alice/doc.pdf'),
      'darwin',
    )
    const candidates = candidateLocalPaths(parsed, {
      platform: 'darwin',
      env: {},
    })
    expect(candidates).toEqual([])
  })

  it('maps WSL mount path back to Windows drive on Windows', () => {
    const parsed = parseAttachmentFileUrl(new URL('file:///mnt/c/Users/alice/doc.pdf'), 'win32')
    const candidates = candidateLocalPaths(parsed, { platform: 'win32' })
    expect(candidates).toEqual(['C:\\Users\\alice\\doc.pdf', '/mnt/c/Users/alice/doc.pdf'])
  })
})

describe('resolveExistingAttachmentPath', () => {
  it('resolves an attachment when the literal path exists', async () => {
    const url = new URL('file:///tmp/test.pdf')
    const result = await resolveExistingAttachmentPath(url, {
      access: async (p) => {
        if (p === '/tmp/test.pdf') return
        const err = new Error('ENOENT') as NodeJS.ErrnoException
        err.code = 'ENOENT'
        throw err
      },
      platform: 'linux',
    })
    expect(result).toEqual({
      path: '/tmp/test.pdf',
      reported: '/tmp/test.pdf',
    })
  })

  it('resolves a Windows drive URL with special characters (#, +) to /mnt/c on WSL/POSIX', async () => {
    const url = new URL('file:///C:/Users/alice/C%2B%2B%20Guide%231.pdf')
    const expectedPath = '/mnt/c/Users/alice/C++ Guide#1.pdf'
    const result = await resolveExistingAttachmentPath(url, {
      access: async (p) => {
        if (p === expectedPath || p === '/mnt/c') return
        const err = new Error('ENOENT') as NodeJS.ErrnoException
        err.code = 'ENOENT'
        throw err
      },
      platform: 'linux',
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
    })
    expect(result).toEqual({
      path: expectedPath,
      reported: '/C:/Users/alice/C++ Guide#1.pdf',
    })
  })

  it('keeps the literal path when both it and the WSL mount path exist', async () => {
    const url = new URL('file:///C:/Users/alice/paper.pdf')
    const access = vi.fn(async () => {})
    const result = await resolveExistingAttachmentPath(url, {
      access,
      platform: 'linux',
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
    })
    expect(result.path).toBe('/C:/Users/alice/paper.pdf')
    expect(access).toHaveBeenCalledExactlyOnceWith('/C:/Users/alice/paper.pdf')
  })

  it('tries WSL mounts only after ENOENT on the literal path', async () => {
    const url = new URL('file:///C:/Users/alice/paper.pdf')
    const attempts: string[] = []
    const result = await resolveExistingAttachmentPath(url, {
      access: async (path) => {
        attempts.push(path)
        if (path === '/mnt/c/Users/alice/paper.pdf') return
        const error = new Error('ENOENT') as NodeJS.ErrnoException
        error.code = 'ENOENT'
        throw error
      },
      platform: 'linux',
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
    })
    expect(result.path).toBe('/mnt/c/Users/alice/paper.pdf')
    expect(attempts.slice(0, 2)).toEqual([
      '/C:/Users/alice/paper.pdf',
      '/mnt/c/Users/alice/paper.pdf',
    ])
  })

  it('does not map a native Linux Windows-drive URL to an unrelated /mnt/c path', async () => {
    const url = new URL('file:///C:/Users/alice/paper.pdf')
    const attempts: string[] = []
    await zoteroError(
      resolveExistingAttachmentPath(url, {
        access: async (path) => {
          attempts.push(path)
          if (path === '/mnt/c/Users/alice/paper.pdf') return
          const error = new Error('ENOENT') as NodeJS.ErrnoException
          error.code = 'ENOENT'
          throw error
        },
        platform: 'linux',
        env: {},
      }),
      ZOTERO_FILE_UNREADABLE,
      unmountedDriveMessage('c', '/C:/Users/alice/paper.pdf'),
    )
    expect(attempts).toEqual(['/C:/Users/alice/paper.pdf'])
  })

  it('does not try a WSL mount after a non-ENOENT literal-path failure', async () => {
    const url = new URL('file:///C:/Users/alice/paper.pdf')
    const attempts: string[] = []
    await zoteroError(
      resolveExistingAttachmentPath(url, {
        access: async (path) => {
          attempts.push(path)
          const error = new Error('Permission denied') as NodeJS.ErrnoException
          error.code = 'EACCES'
          throw error
        },
        platform: 'linux',
        env: { WSL_DISTRO_NAME: 'Ubuntu' },
      }),
      ZOTERO_FILE_UNREADABLE,
      'cannot be accessed',
    )
    expect(attempts).toEqual(['/C:/Users/alice/paper.pdf'])
  })

  it('resolves a Windows drive URL to /c when custom automount root is used in WSL', async () => {
    const url = new URL('file:///D:/Data/paper.pdf')
    const result = await resolveExistingAttachmentPath(url, {
      access: async (p) => {
        if (p === '/d/Data/paper.pdf' || p === '/d') return
        const err = new Error('ENOENT') as NodeJS.ErrnoException
        err.code = 'ENOENT'
        throw err
      },
      platform: 'linux',
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
    })
    expect(result).toEqual({
      path: '/d/Data/paper.pdf',
      reported: '/D:/Data/paper.pdf',
    })
  })

  it('resolves WSL UNC URL to local path in WSL', async () => {
    const url = new URL('file://wsl.localhost/Ubuntu/home/alice/paper.pdf')
    const result = await resolveExistingAttachmentPath(url, {
      access: async (p) => {
        if (p === '/home/alice/paper.pdf') return
        const err = new Error('ENOENT') as NodeJS.ErrnoException
        err.code = 'ENOENT'
        throw err
      },
      platform: 'linux',
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
    })
    expect(result).toEqual({
      path: '/home/alice/paper.pdf',
      reported: 'file://wsl.localhost/Ubuntu/home/alice/paper.pdf',
    })
  })

  it('throws ZOTERO_FILE_UNREADABLE on macOS without probing /proc/mounts', async () => {
    const readSpy = vi.fn()
    const url = new URL('file:///C:/Users/alice/paper.pdf')
    const err = await zoteroError(
      resolveExistingAttachmentPath(url, {
        access: async () => {
          const e = new Error('ENOENT') as NodeJS.ErrnoException
          e.code = 'ENOENT'
          throw e
        },
        platform: 'darwin',
        readFileSync: readSpy,
      }),
      ZOTERO_FILE_UNREADABLE,
      unmountedDriveMessage('c', '/C:/Users/alice/paper.pdf'),
    )
    expect(err.message).toBe(unmountedDriveMessage('c', '/C:/Users/alice/paper.pdf'))
    expect(readSpy).not.toHaveBeenCalled()
  })

  it('throws ZOTERO_FILE_UNREADABLE with unmounted drive diagnosis when mount root does not exist in WSL', async () => {
    const url = new URL('file:///C:/Users/alice/paper.pdf')
    // Neither /mnt/c nor /c exists
    await zoteroError(
      resolveExistingAttachmentPath(url, {
        access: async () => {
          const err = new Error('ENOENT') as NodeJS.ErrnoException
          err.code = 'ENOENT'
          throw err
        },
        platform: 'linux',
        env: { WSL_DISTRO_NAME: 'Ubuntu' },
      }),
      ZOTERO_FILE_UNREADABLE,
      unmountedDriveMessage('c', '/C:/Users/alice/paper.pdf'),
    )
  })

  it('throws ZOTERO_FILE_MISSING when mount root exists but file is missing inside it in WSL', async () => {
    const url = new URL('file:///C:/Users/alice/paper.pdf')
    // /mnt/c exists, but paper.pdf does not
    await zoteroError(
      resolveExistingAttachmentPath(url, {
        access: async (p) => {
          if (p === '/mnt/c') return
          const err = new Error('ENOENT') as NodeJS.ErrnoException
          err.code = 'ENOENT'
          throw err
        },
        platform: 'linux',
        env: { WSL_DISTRO_NAME: 'Ubuntu' },
      }),
      ZOTERO_FILE_MISSING,
      '/C:/Users/alice/paper.pdf',
    )
  })

  it('throws ZOTERO_FILE_UNREADABLE for remote UNC paths on POSIX', async () => {
    const url = new URL('file://nas.company/share/alice/paper.pdf')
    await zoteroError(
      resolveExistingAttachmentPath(url, { platform: 'linux' }),
      ZOTERO_FILE_UNREADABLE,
      unsupportedUncShareMessage('\\\\nas.company\\share\\alice\\paper.pdf'),
    )
  })

  it('throws ZOTERO_FILE_UNREADABLE for WSL UNC paths on non-WSL POSIX host', async () => {
    const url = new URL('file://wsl.localhost/Ubuntu/home/alice/paper.pdf')
    await zoteroError(
      resolveExistingAttachmentPath(url, { platform: 'darwin', env: {} }),
      ZOTERO_FILE_UNREADABLE,
      unsupportedWslUncMessage('file://wsl.localhost/Ubuntu/home/alice/paper.pdf'),
    )
  })

  it('preserves non-ENOENT access errors as ZOTERO_FILE_UNREADABLE', async () => {
    const url = new URL('file:///tmp/secret.pdf')
    await zoteroError(
      resolveExistingAttachmentPath(url, {
        access: async () => {
          const err = new Error('Permission denied') as NodeJS.ErrnoException
          err.code = 'EACCES'
          throw err
        },
        platform: 'linux',
      }),
      ZOTERO_FILE_UNREADABLE,
      'cannot be accessed',
    )
  })
})
