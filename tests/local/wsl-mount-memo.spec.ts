/**
 * The WSL mount table: `/proc/mounts` line parsing, per-owner memoization of
 * the discovered drive map, and graceful behavior when the table is absent.
 * @module tests/local/wsl-mount-memo
 */
import { describe, expect, it, vi } from 'vitest'
import {
  createWslMountsMemo,
  discoverWslMounts,
  parseWslMounts,
} from '../../src/local/path-resolution.js'

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

  it('memoizes the mount table once per owning instance', () => {
    const reader = vi.fn(() => mountsText)
    const memo = createWslMountsMemo({ readFileSync: reader })
    const first = memo()
    const second = memo()
    expect(first.get('c')).toEqual(['/mnt/c'])
    expect(second).toBe(first)
    expect(reader).toHaveBeenCalledTimes(1)
    const live = discoverWslMounts({ readFileSync: reader })
    expect(live.get('c')).toEqual(['/mnt/c'])
    expect(reader).toHaveBeenCalledTimes(2)
  })
})
