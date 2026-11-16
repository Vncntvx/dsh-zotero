/**
 * The filesystem words the model installer, the bundle inspector, and the
 * removal path share.
 *
 * Each of those modules carried its own copy of "the identity a stat reports"
 * and of "absent is not an error", and the copies had started to drift. One
 * definition keeps a file installed by one path recognizable to the path that
 * verifies it and the one that deletes it.
 *
 * Dependency-free on purpose: Node's native TypeScript stripping loads these
 * modules from the CLI scripts, so nothing here may pull in a package.
 * @module dsh-zotero/enrichment/model-fs
 */

import { constants, type Stats } from 'node:fs'
import { lstat, open } from 'node:fs/promises'

/** Read a regular file through one descriptor, bounded before allocating or reading. */
export async function readRegularFile(path: string, maxBytes: number): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('Invalid file byte limit')
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Error('The path is not a regular file')
    if (info.size > maxBytes) throw new Error('The file exceeds its bounded size')
    const bytes = Buffer.alloc(info.size + 1)
    let length = 0
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null)
      if (bytesRead === 0) break
      length += bytesRead
    }
    if (length !== info.size) throw new Error('The file changed size while being read')
    return bytes.subarray(0, length)
  } finally {
    await handle.close()
  }
}

/**
 * Everything about one file that decides whether it is still the same file:
 * the device and inode catch a replacement, the size and timestamps catch an
 * edit in place.
 */
export interface BundleFileIdentity {
  readonly dev: number
  readonly ino: number
  readonly size: number
  readonly mtimeMs: number
  readonly ctimeMs: number
}

/**
 * The identity of one stat result.
 * @param info - the `lstat`/`stat` result.
 * @returns the five fields callers compare.
 */
export function identityOf(info: {
  readonly dev: number
  readonly ino: number
  readonly size: number
  readonly mtimeMs: number
  readonly ctimeMs: number
}): BundleFileIdentity {
  return {
    dev: info.dev,
    ino: info.ino,
    size: info.size,
    mtimeMs: info.mtimeMs,
    ctimeMs: info.ctimeMs,
  }
}

/**
 * `lstat` with absence read as `undefined`.
 *
 * A missing model file is a state the caller reports, not an exception: the
 * inspector calls it "not installed", the installer calls it "create it", and
 * the removal path calls it "already gone". Any other failure still throws.
 * @param path - the path to stat, without following a final symlink.
 * @returns the stat result, or undefined when nothing is there.
 */
export async function lstatOrUndefined(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
