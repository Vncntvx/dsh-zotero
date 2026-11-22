/** The maintenance path stages and replaces a real SQLite FTS5 partition. */
import { lstat, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { ParsedArtifactStore } from '../../src/enrichment/artifact-store.ts'
import { openParsedIndex } from '../../src/enrichment/parsed-index-worker.ts'
import { withTempDir } from '../helpers/temp-dir.ts'
import { deferred } from '../helpers/sync.ts'
import { ARTIFACT, CACHE_KEY, parsedIndexOf as indexOf } from './support/enrichment-artifacts.ts'

it('keeps active rebuilds bound to their output directory while switching the index to another', async () => {
  await withTempDir(async (root) => {
    const first = new ParsedArtifactStore(join(root, 'first'))
    const second = new ParsedArtifactStore(join(root, 'second'))
    const index = indexOf()
    const entered = deferred<void>()
    const resume = deferred<void>()
    const signal = new AbortController().signal
    const staging = new ParsedArtifactStore(first.root)
    const read = staging.readMarkdown.bind(staging)
    staging.readMarkdown = async (...args) => {
      entered.resolve()
      await resume.promise
      return await read(...args)
    }
    try {
      await first.put(CACHE_KEY, { ...ARTIFACT, markdown: 'first document' })
      await second.put(CACHE_KEY, { ...ARTIFACT, markdown: 'second document' })
      const rebuild = index.rebuild(staging, signal)
      await entered.promise
      try {
        await index.publish(second, CACHE_KEY)
        expect(await index.status(second, signal)).toMatchObject({ indexed: 1, total: 1 })
      } finally {
        resume.resolve()
        await rebuild
      }
      expect(await index.status(first, signal)).toMatchObject({ indexed: 1, total: 1 })
      await index.discard(first.root, CACHE_KEY)
      expect(await index.status(first, signal)).toMatchObject({ indexed: 0, total: 1 })
      expect(await index.status(second, signal)).toMatchObject({ indexed: 1, total: 1 })
      await expect(lstat(join(root, 'index.db'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await index.close()
    }
  })
})

it('recognizes the existing search index after its output directory moves', async () => {
  await withTempDir(async (root) => {
    const store = new ParsedArtifactStore(join(root, 'original'))
    const index = indexOf()
    const signal = new AbortController().signal
    try {
      await store.put(CACHE_KEY, { ...ARTIFACT, markdown: 'portable document' })
      await index.publish(store, CACHE_KEY)
    } finally {
      await index.close()
    }
    const moved = new ParsedArtifactStore(join(root, 'moved'))
    await rename(store.root, moved.root)
    const reopened = indexOf()
    try {
      expect(await reopened.status(moved, signal)).toMatchObject({ indexed: 1, total: 1 })
    } finally {
      await reopened.close()
    }
  })
})

it('reports live index coverage and replaces the FTS5 partition from committed Markdown', async () => {
  await withTempDir(async (root) => {
    const store = new ParsedArtifactStore(join(root, 'artifacts'))
    const index = indexOf()
    const obsolete = 'b'.repeat(64)
    const signal = new AbortController().signal
    try {
      await store.put(CACHE_KEY, { ...ARTIFACT, markdown: '# Flood\n\n水库调度。' })
      expect(await index.status(store, signal)).toEqual({
        total: 1,
        indexed: 0,
        unreadable: 0,
        obsolete: 0,
      })
      await expect(lstat(join(store.root, 'index.db'))).rejects.toMatchObject({ code: 'ENOENT' })
      await store.put(obsolete, { ...ARTIFACT, markdown: 'obsolete' })
      await index.publish(store, obsolete)
      await store.discardArtifact(obsolete)
      expect(await index.status(store, signal)).toMatchObject({ indexed: 0, obsolete: 1 })
      await index.rebuild(store, signal)
      expect(await index.status(store, signal)).toEqual({
        total: 1,
        indexed: 1,
        unreadable: 0,
        obsolete: 0,
      })
      using db = new DatabaseSync(join(store.root, 'index.db'), { readOnly: true })
      const name = String(db.prepare('SELECT name FROM parsed_partitions').get()?.name)
      const term = 'x' + Buffer.from('调度').toString('hex')
      expect(
        db.prepare(`SELECT count(*) AS hits FROM ${name}_fts WHERE ${name}_fts MATCH ?`).get(term)
          ?.hits,
      ).toBe(1)
    } finally {
      await index.close()
    }
  })
})

it('keeps the old FTS5 partition if rebuild is cancelled immediately before publication', async () => {
  await withTempDir(async (root) => {
    const store = new ParsedArtifactStore(join(root, 'artifacts'))
    const index = indexOf()
    const controller = new AbortController()
    try {
      await store.put(CACHE_KEY, { ...ARTIFACT, markdown: 'oxidation' })
      await index.publish(store, CACHE_KEY)
      await store.put(CACHE_KEY, { ...ARTIFACT, markdown: 'reduction' })
      await expect(
        index.rebuild(store, controller.signal, () => controller.abort()),
      ).rejects.toMatchObject({ name: 'AbortError' })
      using db = new DatabaseSync(join(store.root, 'index.db'), { readOnly: true })
      const name = String(db.prepare('SELECT name FROM parsed_partitions').get()?.name)
      const query = db.prepare(`SELECT count(*) AS hits FROM ${name}_fts WHERE ${name}_fts MATCH ?`)
      expect(query.get('x' + Buffer.from('oxidation').toString('hex'))?.hits).toBe(1)
      expect(query.get('x' + Buffer.from('reduction').toString('hex'))?.hits).toBe(0)
      await expect(index.rebuild(store, controller.signal)).rejects.toMatchObject({
        name: 'AbortError',
      })
      expect(await index.status(store, new AbortController().signal)).toMatchObject({
        indexed: 0,
        total: 1,
      })
    } finally {
      await index.close()
    }
  })
})

it('does not overwrite a newer artifact generation published during a rebuild', async () => {
  await withTempDir(async (root) => {
    const store = new ParsedArtifactStore(join(root, 'artifacts'))
    const index = indexOf()
    const signal = new AbortController().signal
    const reading = deferred<void>()
    const proceed = deferred<void>()
    const originalRead = store.readMarkdown.bind(store)
    const stagingStore = new ParsedArtifactStore(store.root)
    stagingStore.readMarkdown = async (...args) => {
      const markdown = await originalRead(...args)
      reading.resolve()
      await proceed.promise
      return markdown
    }
    try {
      await store.put(CACHE_KEY, { ...ARTIFACT, markdown: 'old generation' })
      const rebuild = index.rebuild(stagingStore, signal)
      const rejected = expect(rebuild).rejects.toThrow('changed during the rebuild')
      await reading.promise
      try {
        expect(await index.status(store, signal)).toMatchObject({ progress: { done: 0, total: 1 } })
        await expect(index.rebuild(store, signal)).rejects.toThrow('already running')
        await store.put(CACHE_KEY, { ...ARTIFACT, markdown: 'new generation' })
        await index.publish(store, CACHE_KEY)
      } finally {
        proceed.resolve()
      }
      await rejected
      expect(await index.status(store, signal)).toMatchObject({ indexed: 1, total: 1 })
    } finally {
      await index.close()
    }
  })
})

it('cleans up a failed Markdown stage and permits a successful retry', async () => {
  await withTempDir(async (root) => {
    const store = new ParsedArtifactStore(join(root, 'artifacts'))
    const index = indexOf()
    const signal = new AbortController().signal
    try {
      await store.put(CACHE_KEY, { ...ARTIFACT, markdown: 'working Markdown' })
      const failingStore = new ParsedArtifactStore(store.root)
      failingStore.readMarkdown = async () => {
        throw new Error('Markdown read failed after inventory')
      }
      await expect(index.rebuild(failingStore, signal)).rejects.toThrow(
        'The parsed index could not be rebuilt',
      )
      expect(await index.status(store, signal)).toMatchObject({ indexed: 0, total: 1 })
      await index.rebuild(store, signal)
      expect(await index.status(store, signal)).toMatchObject({ indexed: 1, total: 1 })
    } finally {
      await index.close()
    }
  })
})

it('accounts for an unreadable committed artifact without dropping other documents', async () => {
  await withTempDir(async (root) => {
    const store = new ParsedArtifactStore(join(root, 'artifacts'))
    const index = indexOf()
    const unreadable = 'c'.repeat(64)
    const signal = new AbortController().signal
    try {
      await store.put(CACHE_KEY, { ...ARTIFACT, markdown: 'readable' })
      await store.put(unreadable, { ...ARTIFACT, markdown: 'damaged metadata' })
      await index.publish(store, unreadable)
      await writeFile(join(store.root, unreadable, 'meta.json'), '{')
      expect(await index.status(store, signal)).toMatchObject({
        total: 1,
        indexed: 0,
        unreadable: 1,
        obsolete: 1,
      })
      await index.rebuild(store, signal)
      expect(await index.status(store, signal)).toMatchObject({
        total: 1,
        indexed: 1,
        unreadable: 1,
        obsolete: 0,
      })
    } finally {
      await index.close()
    }
  })
})

it('rolls back failed staging and a cancelled SQLite switch without touching other partitions', async () => {
  await withTempDir(async (root) => {
    const stage = join(root, 'stage.db')
    await writeFile(stage, '', { mode: 0o600 })
    const path = join(root, 'index.db')
    const partition = '1'.repeat(128)
    const other = '2'.repeat(128)
    const document = { artifactId: CACHE_KEY, sourceId: 's', generation: 'g1', digest: 'd1' }
    const replacement = { ...document, generation: 'g2', digest: 'd2' }
    const cancelled = new Int32Array(new SharedArrayBuffer(4))
    using db = openParsedIndex(path)
    expect(db.execute({ kind: 'inspect', partition })).toEqual([])
    db.execute({ kind: 'put', partition, document, markdown: 'old content' })
    db.execute({ kind: 'put', partition: other, document, markdown: 'unrelated' })
    expect(() => db.execute({ kind: 'rebuild-start', path: join(root, 'missing') })).toThrow(
      'Missing',
    )
    db.execute({ kind: 'rebuild-start', path: stage })
    db.execute({ kind: 'rebuild-stage', document: replacement, markdown: 'new content' })
    expect(() =>
      db.execute({ kind: 'rebuild-stage', document: replacement, markdown: 'duplicate' }),
    ).toThrow('UNIQUE')
    Atomics.store(cancelled, 0, 1)
    expect(() => db.execute({ kind: 'rebuild-commit', partition, cancelled })).toThrow('cancelled')
    expect(db.execute({ kind: 'inspect', partition })).toEqual([document])
    Atomics.store(cancelled, 0, 0)
    db.execute({ kind: 'rebuild-commit', partition, cancelled })
    db.execute({ kind: 'rebuild-drop' })
    expect(db.execute({ kind: 'inspect', partition })).toEqual([replacement])
    expect(db.execute({ kind: 'inspect', partition: other })).toEqual([document])
  })
})
