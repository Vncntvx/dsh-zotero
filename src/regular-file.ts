/** Bounded descriptor reads shared by disk caches and model bundles. */
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'

/** Read a regular file through one descriptor, bounded before allocating or reading. */
export async function readRegularFile(path: string, maxBytes: number): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('Invalid file byte limit')
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
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
