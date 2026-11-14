/** v2 artifact and source-index reads preserve data and never mutate the filesystem. */
import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { symlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ParsedArtifactStore } from '../../src/enrichment/artifact-store.ts'
import { memoryFiles } from './support/enrichment-parse-domain.ts'
import {
  ARTIFACT,
  CACHE_KEY,
  FILE_STAMP,
  SOURCE_KEY,
  SOURCE_RECORD,
} from './support/enrichment-artifacts.ts'

function readOnlyPhase(fs: ReturnType<typeof memoryFiles>) {
  const before = new Map(fs.files)
  const ports = [fs.deps.mkdir, fs.deps.writeFile, fs.deps.rename, fs.deps.rm]
  for (const port of ports) vi.mocked(port).mockClear()
  return () => {
    for (const port of ports) expect(port).not.toHaveBeenCalled()
    expect(fs.files).toEqual(before)
  }
}

const FIGURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
const WITH_FIGURES = {
  ...ARTIFACT,
  images: [{ name: 'images/page_0_figure.png', data: FIGURE }],
  meta: {
    ...ARTIFACT.meta,
    images: [
      {
        name: 'images/page_0_figure.png',
        mediaType: 'image/png' as const,
        bytes: FIGURE.byteLength,
      },
    ],
  },
}

describe('ParsedArtifactStore figures', () => {
  it('stores a figure beside the Markdown and serves only the names its meta lists', async () => {
    const fs = memoryFiles()
    const store = new ParsedArtifactStore('/root', fs.deps)
    await store.put(CACHE_KEY, WITH_FIGURES)
    expect(fs.files.has(`/root/${CACHE_KEY}/images/page_0_figure.png`)).toBe(true)
    const unchanged = readOnlyPhase(fs)
    expect(await store.readImage(CACHE_KEY, 'images/page_0_figure.png')).toEqual({
      data: FIGURE,
      mediaType: 'image/png',
    })
    // A name the artifact does not declare never becomes a file read.
    expect(await store.readImage(CACHE_KEY, 'images/other.png')).toBeUndefined()
    expect(await store.readImage(CACHE_KEY, '../meta.json')).toBeUndefined()
    unchanged()
  })

  it('keeps the text read to the Markdown while the meta names its figures', async () => {
    const fs = memoryFiles()
    const store = new ParsedArtifactStore('/root', fs.deps)
    await store.put(CACHE_KEY, WITH_FIGURES)
    const loaded = await store.get(CACHE_KEY)
    expect(loaded).toEqual({
      markdown: ARTIFACT.markdown,
      contentList: ARTIFACT.contentList,
      meta: WITH_FIGURES.meta,
    })
  })

  it('refuses a payload whose figures do not match the metadata', async () => {
    const store = new ParsedArtifactStore('/root', memoryFiles().deps)
    await expect(
      store.put(CACHE_KEY, { ...ARTIFACT, images: WITH_FIGURES.images }),
    ).rejects.toThrow(/image list/)
    await expect(store.put(CACHE_KEY, { ...WITH_FIGURES, images: [] })).rejects.toThrow(
      /image list/,
    )
    await expect(
      store.put(CACHE_KEY, {
        ...WITH_FIGURES,
        meta: {
          ...WITH_FIGURES.meta,
          images: [{ ...WITH_FIGURES.meta.images![0]!, bytes: 99 }],
        },
      }),
    ).rejects.toThrow(/size/)
  })

  it('reports a figure whose stored bytes vanished', async () => {
    const fs = memoryFiles()
    const store = new ParsedArtifactStore('/root', fs.deps)
    await store.put(CACHE_KEY, WITH_FIGURES)
    fs.files.delete(`/root/${CACHE_KEY}/images/page_0_figure.png`)
    expect(await store.readImage(CACHE_KEY, 'images/page_0_figure.png')).toBeUndefined()
  })
})

describe('ParsedArtifactStore artifact reads', () => {
  it('round-trips exact v2 metadata and payload without mutating on read', async () => {
    const fs = memoryFiles()
    const store = new ParsedArtifactStore('/root', fs.deps)
    await store.put(CACHE_KEY, ARTIFACT)
    const unchanged = readOnlyPhase(fs)
    expect(await store.get(CACHE_KEY)).toEqual(ARTIFACT)
    unchanged()
  })

  it('commits the Markdown H1 as the artifact title when meta omits it', async () => {
    const fs = memoryFiles()
    const store = new ParsedArtifactStore('/root', fs.deps)
    await store.put(CACHE_KEY, {
      ...ARTIFACT,
      markdown: '# A Different Paper\n\nbody',
      meta: { ...ARTIFACT.meta, title: undefined },
    })
    const stored = await store.metaFor(CACHE_KEY)
    expect(stored?.meta.title).toBe('A Different Paper')
  })

  it('reads an absent artifact without creating a root', async () => {
    const fs = memoryFiles()
    const unchanged = readOnlyPhase(fs)
    expect(await new ParsedArtifactStore('/root', fs.deps).get(CACHE_KEY)).toBeUndefined()
    unchanged()
  })

  it('does not serve an uncommitted artifact without meta.json', async () => {
    const fs = memoryFiles()
    fs.files.set(`/root/${CACHE_KEY}/full.md`, new TextEncoder().encode('orphan'))
    const unchanged = readOnlyPhase(fs)
    expect(await new ParsedArtifactStore('/root', fs.deps).get(CACHE_KEY)).toBeUndefined()
    unchanged()
  })

  it.each(['full.md', 'content_list.json'])(
    'keeps committed evidence when %s is absent',
    async (file) => {
      const fs = memoryFiles()
      const store = new ParsedArtifactStore('/root', fs.deps)
      await store.put(CACHE_KEY, ARTIFACT)
      fs.files.delete(`/root/${CACHE_KEY}/${file}`)
      const unchanged = readOnlyPhase(fs)
      expect(await store.get(CACHE_KEY)).toBeUndefined()
      unchanged()
    },
  )

  it.each([
    { name: 'malformed meta JSON', file: 'meta.json', body: '{bad json' },
    { name: 'invalid meta fields', file: 'meta.json', body: '{"identity":7}' },
    { name: 'blank Markdown', file: 'full.md', body: '   \n' },
    { name: 'invalid UTF-8', file: 'full.md', body: new Uint8Array([0xff]) },
    { name: 'malformed content list', file: 'content_list.json', body: '{bad json' },
    { name: 'non-array content list', file: 'content_list.json', body: '{}' },
  ])('rejects $name without deleting the artifact', async ({ file, body }) => {
    const fs = memoryFiles()
    const store = new ParsedArtifactStore('/root', fs.deps)
    await store.put(CACHE_KEY, ARTIFACT)
    await fs.deps.writeFile(`/root/${CACHE_KEY}/${file}`, body)
    const unchanged = readOnlyPhase(fs)
    await expect(store.get(CACHE_KEY)).rejects.toThrow()
    unchanged()
  })

  it('omits an undeclared content list without mutating stray files', async () => {
    const fs = memoryFiles()
    const store = new ParsedArtifactStore('/root', fs.deps)
    await store.put(CACHE_KEY, {
      markdown: '# Only',
      meta: { ...ARTIFACT.meta, files: ['full.md'] },
    })
    await fs.deps.writeFile(`/root/${CACHE_KEY}/content_list.json`, 'stray')
    const unchanged = readOnlyPhase(fs)
    expect((await store.get(CACHE_KEY))?.contentList).toBeUndefined()
    unchanged()
  })

  it.each(['meta.json', 'full.md', 'content_list.json'])(
    'propagates I/O errors reading %s',
    async (file) => {
      const fs = memoryFiles()
      const store = new ParsedArtifactStore('/root', fs.deps)
      await store.put(CACHE_KEY, ARTIFACT)
      const readFile = vi.mocked(fs.deps.readFile).getMockImplementation()!
      const error = Object.assign(new Error('EIO'), { code: 'EIO' })
      vi.mocked(fs.deps.readFile).mockImplementation(async (path) => {
        if (path === `/root/${CACHE_KEY}/${file}`) throw error
        return await readFile(path)
      })
      const unchanged = readOnlyPhase(fs)
      await expect(store.get(CACHE_KEY)).rejects.toBe(error)
      unchanged()
    },
  )
})

describe('ParsedArtifactStore real-filesystem discard', () => {
  it('removes a real directory under the publication lock and refuses foreign paths', async () => {
    // Normalize the root through realpath so the store's own path guards
    // compare equal on hosts whose tmpdir sits behind a symlink.
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'zotero-store-discard-')))
    try {
      const store = new ParsedArtifactStore(dir)
      await store.put(CACHE_KEY, ARTIFACT)
      // The publication path creates the sources directory its lock guards.
      await store.putSource(SOURCE_KEY, SOURCE_RECORD)
      expect(await store.hasArtifactDirectory(CACHE_KEY)).toBe(true)
      // A directory entry that is not a regular, expected path is not an
      // artifact directory, and a symlink is never followed.
      const foreign = join(dir, 'f'.repeat(64))
      await mkdir(foreign)
      await symlink(join(dir, 'elsewhere'), join(dir, 'd'.repeat(64)))
      expect(await store.hasArtifactDirectory('d'.repeat(64))).toBe(false)
      const removed = await store.discardArtifact(CACHE_KEY)
      expect(removed).toBe(1)
      expect(await store.metaFor(CACHE_KEY)).toBeUndefined()
      expect(await store.hasArtifactDirectory(CACHE_KEY)).toBe(false)
      expect(existsSync(foreign)).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('ParsedArtifactStore source-index reads', () => {
  it('reads one committed source snapshot and matching artifact without mutations', async () => {
    const fs = memoryFiles()
    const store = new ParsedArtifactStore('/root', fs.deps)
    await store.put(CACHE_KEY, ARTIFACT)
    await store.putSource(SOURCE_KEY, SOURCE_RECORD)
    const unchanged = readOnlyPhase(fs)
    expect(await store.sourceRecord(SOURCE_KEY)).toEqual(SOURCE_RECORD)
    expect(await store.lookupSource(SOURCE_KEY, FILE_STAMP)).toEqual(ARTIFACT)
    unchanged()
  })

  it('reads only the snapshot for an absent source', async () => {
    const fs = memoryFiles()
    const store = new ParsedArtifactStore('/root', fs.deps)
    const unchanged = readOnlyPhase(fs)
    expect(await store.sourceRecord(SOURCE_KEY)).toBeUndefined()
    expect(await store.lookupSource(SOURCE_KEY, FILE_STAMP)).toBeUndefined()
    expect(vi.mocked(fs.deps.readFile).mock.calls.map(([path]) => path)).toEqual([
      '/root/sources/index.json',
      '/root/sources/index.json',
    ])
    unchanged()
  })

  it('misses a changed stamp without reading or deleting the old artifact', async () => {
    const fs = memoryFiles()
    const store = new ParsedArtifactStore('/root', fs.deps)
    await store.put(CACHE_KEY, ARTIFACT)
    await store.putSource(SOURCE_KEY, SOURCE_RECORD)
    vi.mocked(fs.deps.readFile).mockClear()
    const unchanged = readOnlyPhase(fs)
    expect(
      await store.lookupSource(SOURCE_KEY, { kind: 'file', size: 11, mtimeMs: 20 }),
    ).toBeUndefined()
    expect(fs.deps.readFile).toHaveBeenCalledExactlyOnceWith('/root/sources/index.json')
    unchanged()
  })

  it('retains a source whose committed artifact is absent', async () => {
    const fs = memoryFiles()
    const store = new ParsedArtifactStore('/root', fs.deps)
    await store.putSource(SOURCE_KEY, SOURCE_RECORD)
    const unchanged = readOnlyPhase(fs)
    expect(await store.lookupSource(SOURCE_KEY, FILE_STAMP)).toBeUndefined()
    expect(await store.sourceRecord(SOURCE_KEY)).toEqual(SOURCE_RECORD)
    unchanged()
  })

  it.each([
    { name: 'fingerprint', change: { fingerprint: 'b'.repeat(64) } },
    { name: 'generation', change: { generation: '22222222-2222-4222-8222-222222222222' } },
  ])('refuses a source-to-meta $name mismatch without evicting data', async ({ change }) => {
    const fs = memoryFiles()
    const store = new ParsedArtifactStore('/root', fs.deps)
    await store.put(CACHE_KEY, ARTIFACT)
    await store.putSource(SOURCE_KEY, { ...SOURCE_RECORD, ...change })
    const unchanged = readOnlyPhase(fs)
    await expect(store.lookupSource(SOURCE_KEY, FILE_STAMP)).rejects.toThrow(/does not match/)
    unchanged()
  })

  it('propagates source snapshot I/O failures without deleting the index', async () => {
    const fs = memoryFiles()
    const store = new ParsedArtifactStore('/root', fs.deps)
    await store.putSource(SOURCE_KEY, SOURCE_RECORD)
    const error = Object.assign(new Error('EACCES'), { code: 'EACCES' })
    vi.mocked(fs.deps.readFile).mockRejectedValue(error)
    const unchanged = readOnlyPhase(fs)
    await expect(store.sourceRecord(SOURCE_KEY)).rejects.toBe(error)
    unchanged()
  })

  it('requires common URL validators and preserves expired records', async () => {
    const fs = memoryFiles()
    const store = new ParsedArtifactStore('/root', fs.deps)
    await store.put(CACHE_KEY, ARTIFACT)
    const url = 'https://example.org/a.pdf'
    await store.putSource(SOURCE_KEY, {
      ...SOURCE_RECORD,
      stamp: { kind: 'url', url, etag: '"v1"' },
    })
    const unchanged = readOnlyPhase(fs)
    expect(await store.lookupSource(SOURCE_KEY, { kind: 'url', url, etag: '"v1"' })).toEqual(
      ARTIFACT,
    )
    expect(await store.lookupSource(SOURCE_KEY, { kind: 'url', url, etag: '"v2"' })).toBeUndefined()
    expect(await store.lookupSource(SOURCE_KEY, { kind: 'url', url })).toBeUndefined()
    unchanged()
  })

  it('compares exact byte fingerprints without modifying the source', async () => {
    const fs = memoryFiles()
    const store = new ParsedArtifactStore('/root', fs.deps)
    await store.put(CACHE_KEY, ARTIFACT)
    await store.putSource(SOURCE_KEY, {
      ...SOURCE_RECORD,
      stamp: { kind: 'bytes', fingerprint: 'c'.repeat(64) },
    })
    const unchanged = readOnlyPhase(fs)
    expect(
      await store.lookupSource(SOURCE_KEY, { kind: 'bytes', fingerprint: 'c'.repeat(64) }),
    ).toEqual(ARTIFACT)
    expect(
      await store.lookupSource(SOURCE_KEY, { kind: 'bytes', fingerprint: 'd'.repeat(64) }),
    ).toBeUndefined()
    unchanged()
  })
})

describe('ParsedArtifactStore task receipts', () => {
  it('puts, gets and deletes a strict durable task receipt', async () => {
    const fs = memoryFiles()
    const store = new ParsedArtifactStore('/root', fs.deps)
    expect(await store.getTask(CACHE_KEY)).toBeUndefined()
    const task = {
      taskId: 't-123',
      uploadUrl: 'https://cdn.example.org/upload',
      createdAt: 1000,
      uploaded: false as const,
    }
    await store.putTask(CACHE_KEY, task)
    expect(await store.getTask(CACHE_KEY)).toEqual(task)
    await store.deleteTask(CACHE_KEY)
    expect(await store.getTask(CACHE_KEY)).toBeUndefined()
  })

  it.each([
    { name: 'malformed JSON', body: 'not json' },
    { name: 'null', body: 'null' },
    { name: 'missing fields', body: JSON.stringify({ taskId: 't' }) },
    {
      name: 'unknown fields',
      body: JSON.stringify({ taskId: 't', uploaded: true, createdAt: 1, token: 'x' }),
    },
    {
      name: 'insecure URL',
      body: JSON.stringify({
        taskId: 't',
        uploadUrl: 'ftp://insecure',
        createdAt: 100,
        uploaded: false,
      }),
    },
  ])('rejects a $name task receipt', async ({ body }) => {
    const fs = memoryFiles()
    await fs.deps.writeFile(`/root/tasks/${CACHE_KEY}.json`, body)
    await expect(new ParsedArtifactStore('/root', fs.deps).getTask(CACHE_KEY)).rejects.toThrow()
  })
})
