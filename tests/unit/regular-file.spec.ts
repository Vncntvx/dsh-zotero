/** Descriptor-based reads enforce bounds and refuse filesystem aliases and special entries. */
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readRegularFile } from '../../src/regular-file.ts'

let root: string | undefined
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
})

it('reads the complete bytes once and rejects an oversized file before allocating its contents', async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-regular-file-'))
  const path = join(root, 'data')
  const data = Buffer.from('a😀字\u0000')
  await writeFile(path, data)
  expect(await readRegularFile(path, data.length)).toEqual(data)
  await expect(readRegularFile(path, data.length - 1)).rejects.toThrow('bounded size')
  await writeFile(path, '')
  expect(await readRegularFile(path, 0)).toEqual(Buffer.alloc(0))
})

it('refuses directories, symlinks and invalid allocation limits', async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-regular-file-'))
  await expect(readRegularFile(root, 100)).rejects.toThrow('regular file')
  await writeFile(join(root, 'real'), 'data')
  await symlink(join(root, 'real'), join(root, 'alias'))
  await expect(readRegularFile(join(root, 'alias'), 100)).rejects.toMatchObject({ code: 'ELOOP' })
  for (const bound of [-1, 1.5, Infinity, NaN])
    await expect(readRegularFile(join(root, 'real'), bound)).rejects.toThrow(
      'Invalid file byte limit',
    )
})
