/**
 * The parsed-artifact store: `meta.json` is the commit marker, a half-written
 * directory reads as a miss and is evicted, and a hit returns the stored
 * Markdown without touching the network.
 * @module tests/host/enrichment-artifact-store
 */

import { describe, expect, it, vi } from 'vitest'
import { ParsedArtifactStore, type ArtifactStoreDeps } from '../../src/enrichment/artifact-store.ts'
import type { ParsedArtifact } from '../../src/enrichment/types.ts'

/** An in-memory filesystem implementing exactly the five seams. */
function memoryDeps(): ArtifactStoreDeps & { files: Map<string, Uint8Array | string> } {
  const files = new Map<string, Uint8Array | string>()
  const deps = {
    files,
    mkdir: async (): Promise<void> => {},
    readFile: async (path: string): Promise<Uint8Array> => {
      const value = files.get(path)
      if (value === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
      return typeof value === 'string' ? new TextEncoder().encode(value) : value
    },
    writeFile: async (path: string, data: Uint8Array | string): Promise<void> => {
      files.set(path, data)
    },
    rename: async (from: string, to: string): Promise<void> => {
      const value = files.get(from)
      if (value === undefined) throw new Error(`ENOENT: ${from}`)
      files.delete(from)
      files.set(to, value)
    },
    rm: async (path: string): Promise<void> => {
      for (const key of [...files.keys()]) if (key.startsWith(path)) files.delete(key)
    },
  }
  return deps as ArtifactStoreDeps & { files: Map<string, Uint8Array | string> }
}

const artifact: ParsedArtifact = {
  markdown: '# Parsed body',
  contentList: '[{"type":"text"}]',
  meta: {
    identity: 'zotero://user/0/attachment/ABCD',
    mode: 'pro',
    contentFingerprint: 'f'.repeat(64),
    taskId: 't1',
    files: [],
  },
}

describe('ParsedArtifactStore', () => {
  it('round-trips an artifact and records the file list in meta', async () => {
    const deps = memoryDeps()
    const store = new ParsedArtifactStore('/root', deps)
    await store.put('key1', artifact)

    const read = await store.get('key1')
    expect(read).toMatchObject({
      markdown: '# Parsed body',
      contentList: '[{"type":"text"}]',
    })
    expect(read?.meta.files).toEqual(['full.md', 'content_list.json'])
  })

  it('rejects when the cache root cannot be created', async () => {
    const deps = memoryDeps()
    const store = new ParsedArtifactStore('/root', {
      ...deps,
      mkdir: async () => {
        throw new Error('EACCES: root')
      },
    })
    await expect(store.get('key')).rejects.toThrow('EACCES')
  })

  it('reads a miss for an absent key', async () => {
    const store = new ParsedArtifactStore('/root', memoryDeps())
    await expect(store.get('missing')).resolves.toBeUndefined()
  })

  it('treats a directory without meta.json as a miss and evicts it', async () => {
    const deps = memoryDeps()
    const store = new ParsedArtifactStore('/root', deps)
    await deps.writeFile('/root/key/full.md', 'orphan')
    const rm = vi.spyOn(deps, 'rm')
    await expect(store.get('key')).resolves.toBeUndefined()
    expect(rm).toHaveBeenCalled()
  })

  it('evicts a directory whose meta.json is malformed', async () => {
    const deps = memoryDeps()
    const store = new ParsedArtifactStore('/root', deps)
    await deps.writeFile('/root/key/meta.json', '{"identity": 7}')
    await expect(store.get('key')).resolves.toBeUndefined()
  })

  it('evicts a directory whose full.md is empty', async () => {
    const deps = memoryDeps()
    const store = new ParsedArtifactStore('/root', deps)
    await store.put('key', { ...artifact, markdown: '   ' })
    // A blank markdown is written as-is; the read refuses to serve it.
    await expect(store.get('key')).resolves.toBeUndefined()
  })

  it('omits the content list when the artifact has none', async () => {
    const deps = memoryDeps()
    const store = new ParsedArtifactStore('/root', deps)
    await store.put('key', { markdown: '# Only', meta: artifact.meta })
    const read = await store.get('key')
    expect(read?.contentList).toBeUndefined()
    expect(read?.meta.files).toEqual(['full.md'])
  })

  it('serves a source-index hit when the stamp matches', async () => {
    const deps = memoryDeps()
    const store = new ParsedArtifactStore('/root', deps)
    await store.put('key', artifact)
    await store.putSource('source', {
      version: 1,
      cacheKey: 'key',
      fingerprint: artifact.meta.contentFingerprint,
      stamp: { kind: 'file', size: 10, mtimeMs: 20 },
    })

    await expect(
      store.lookupSource('source', { kind: 'file', size: 10, mtimeMs: 20 }),
    ).resolves.toMatchObject({ markdown: '# Parsed body' })
    expect(deps.files.has('/root/sources/source.json')).toBe(true)
  })

  it('misses a source index whose stamp changed', async () => {
    const deps = memoryDeps()
    const store = new ParsedArtifactStore('/root', deps)
    await store.put('key', artifact)
    await store.putSource('source', {
      version: 1,
      cacheKey: 'key',
      fingerprint: artifact.meta.contentFingerprint,
      stamp: { kind: 'file', size: 10, mtimeMs: 20 },
    })

    await expect(
      store.lookupSource('source', { kind: 'file', size: 11, mtimeMs: 20 }),
    ).resolves.toBeUndefined()
  })

  it('compares URL validators and refuses an unvalidated source-index hit', async () => {
    const deps = memoryDeps()
    const store = new ParsedArtifactStore('/root', deps)
    await store.put('key', artifact)
    await store.putSource('source', {
      version: 1,
      cacheKey: 'key',
      fingerprint: artifact.meta.contentFingerprint,
      stamp: { kind: 'url', url: 'https://example.org/a.pdf', etag: '"v1"' },
    })

    await expect(
      store.lookupSource('source', {
        kind: 'url',
        url: 'https://example.org/a.pdf',
        etag: '"v2"',
      }),
    ).resolves.toBeUndefined()
    await expect(
      store.lookupSource('source', { kind: 'url', url: 'https://example.org/a.pdf' }),
    ).resolves.toBeUndefined()
  })

  it('evicts a malformed source index', async () => {
    const deps = memoryDeps()
    const store = new ParsedArtifactStore('/root', deps)
    await deps.writeFile('/root/sources/source.json', '{bad json')
    await expect(
      store.lookupSource('source', { kind: 'file', size: 1, mtimeMs: 1 }),
    ).resolves.toBeUndefined()
    expect(deps.files.has('/root/sources/source.json')).toBe(false)
  })

  it('evicts an index whose artifact is gone', async () => {
    const deps = memoryDeps()
    const store = new ParsedArtifactStore('/root', deps)
    await store.putSource('source', {
      version: 1,
      cacheKey: 'missing-key',
      fingerprint: artifact.meta.contentFingerprint,
      stamp: { kind: 'file', size: 1, mtimeMs: 1 },
    })
    await expect(
      store.lookupSource('source', { kind: 'file', size: 1, mtimeMs: 1 }),
    ).resolves.toBeUndefined()
    expect(deps.files.has('/root/sources/source.json')).toBe(false)
  })

  it('serves and compares a bytes stamp', async () => {
    const deps = memoryDeps()
    const store = new ParsedArtifactStore('/root', deps)
    await store.put('key', artifact)
    await store.putSource('source', {
      version: 1,
      cacheKey: 'key',
      fingerprint: artifact.meta.contentFingerprint,
      stamp: { kind: 'bytes', fingerprint: 'abc' },
    })
    await expect(
      store.lookupSource('source', { kind: 'bytes', fingerprint: 'abc' }),
    ).resolves.toMatchObject({ markdown: '# Parsed body' })
    await expect(
      store.lookupSource('source', { kind: 'bytes', fingerprint: 'def' }),
    ).resolves.toBeUndefined()
  })

  it('evicts a syntactically valid index with an invalid stamp or record', async () => {
    for (const record of [
      { version: 1, cacheKey: 'key', fingerprint: 'f', stamp: { kind: 'wat' } },
      { version: 1, cacheKey: 'key', fingerprint: 'f', stamp: { kind: 'bytes' } },
      { version: 1, cacheKey: 'key', fingerprint: 'f', stamp: { kind: 'url', url: 7 } },
      { version: 2, cacheKey: 'key', fingerprint: 'f', stamp: { kind: 'bytes', fingerprint: 'a' } },
      { version: 1, cacheKey: 7, fingerprint: 'f', stamp: { kind: 'bytes', fingerprint: 'a' } },
    ]) {
      const deps = memoryDeps()
      const store = new ParsedArtifactStore('/root', deps)
      await deps.writeFile('/root/sources/source.json', JSON.stringify(record))
      await expect(
        store.lookupSource('source', { kind: 'bytes', fingerprint: 'a' }),
      ).resolves.toBeUndefined()
      expect(deps.files.has('/root/sources/source.json')).toBe(false)
    }
  })

  it('propagates eviction failures instead of resubmitting against an unreadable cache', async () => {
    const deps = memoryDeps()
    const store = new ParsedArtifactStore('/root', {
      ...deps,
      rm: async () => {
        throw new Error('EIO')
      },
    })
    await expect(store.get('missing')).rejects.toThrow('EIO')
    await deps.writeFile('/root/sources/source.json', '{bad')
    await expect(store.lookupSource('source', { kind: 'bytes', fingerprint: 'a' })).rejects.toThrow(
      'EIO',
    )
  })

  it('puts, gets, and deletes durable task records', async () => {
    const deps = memoryDeps()
    const store = new ParsedArtifactStore('/root', deps)
    await expect(store.getTask('task-key')).resolves.toBeUndefined()

    const task = {
      taskId: 't-123',
      uploadUrl: 'https://cdn.example.org/upload',
      createdAt: 1000,
      uploaded: false as const,
    }
    await store.putTask('task-key', task)
    await expect(store.getTask('task-key')).resolves.toEqual(task)

    await store.deleteTask('task-key')
    await expect(store.getTask('task-key')).resolves.toBeUndefined()
  })

  it('rejects invalid or malformed task receipts', async () => {
    const deps = memoryDeps()
    const store = new ParsedArtifactStore('/root', deps)

    await deps.writeFile('/root/tasks/bad-json.json', 'not json')
    await expect(store.getTask('bad-json')).rejects.toThrow()

    await deps.writeFile('/root/tasks/not-object.json', 'null')
    await expect(store.getTask('not-object')).rejects.toThrow(/Invalid MinerU task receipt/)

    await deps.writeFile('/root/tasks/missing-fields.json', JSON.stringify({ taskId: 't' }))
    await expect(store.getTask('missing-fields')).rejects.toThrow(/Invalid MinerU task receipt/)

    await deps.writeFile(
      '/root/tasks/bad-url.json',
      JSON.stringify({
        taskId: 't',
        uploadUrl: 'ftp://insecure',
        createdAt: 100,
        uploaded: false,
      }),
    )
    await expect(store.getTask('bad-url')).rejects.toThrow(/Invalid MinerU task receipt/)
  })
})
