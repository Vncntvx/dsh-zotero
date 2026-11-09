/**
 * The production filesystem adapters behind the parsing component: the real
 * output-directory resolver, the real artifact store, and the real source-byte
 * reader. These run against a temporary directory so the adapters themselves —
 * not just the injected seams — are exercised.
 * @module tests/host/parsing-host-adapters
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveOutputDir } from '../../src/parsing/output-dir.ts'
import { ParsedArtifactStore } from '../../src/parsing/artifact-store.ts'
import { hostSourceBytesDeps } from '../../src/parsing/source-bytes.ts'
import type { MineruClient } from '../../src/parsing/transport.ts'

let dir: string | undefined

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

describe('parsing host adapters', () => {
  it('creates the default-style output directory and returns its canonical path', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-zotero-parsing-host-'))
    const nested = join(dir, 'nested', 'artifacts')
    await expect(resolveOutputDir(nested, undefined)).rejects.toThrow()
    // A missing directory is refused; create it and the real adapter accepts.
    const { mkdir, realpath } = await import('node:fs/promises')
    await mkdir(nested, { recursive: true })
    // macOS resolves /var to /private/var, so compare canonical forms.
    await expect(resolveOutputDir(nested, undefined)).resolves.toBe(await realpath(nested))
  })

  it('creates the harness default directory when the value is empty', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-zotero-parsing-home-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = dir
    try {
      const resolved = await resolveOutputDir('', undefined)
      expect(resolved.endsWith(join('zotero-parsed'))).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })

  it('writes and reads an artifact on the real filesystem', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-zotero-parsing-store-'))
    const store = new ParsedArtifactStore(dir)
    await store.put('key-a', {
      markdown: '# Real',
      contentList: '[]',
      meta: {
        identity: 'i',
        mode: 'free',
        contentFingerprint: 'f',
        taskId: 't',
        files: [],
      },
    })
    const read = await store.get('key-a')
    expect(read?.markdown).toBe('# Real')
    expect(await store.get('absent')).toBeUndefined()
  })

  it('reads a real local file through the production source-byte deps', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-zotero-parsing-bytes-'))
    const file = join(dir, 'a.pdf')
    await writeFile(file, '%PDF-1.7 real')
    const deps = hostSourceBytesDeps(async () => ({ kind: 'file', path: file }), {} as MineruClient)
    const bytes = await deps.readFile(file, undefined)
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('%PDF')
    const resolved = await deps.resolveAttachment('r', undefined)
    expect(resolved).toEqual({ kind: 'file', path: file })
    expect((await deps.stat(file)).size).toBeGreaterThan(0)
  })
})
