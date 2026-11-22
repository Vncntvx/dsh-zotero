/** Real SQLite worker, committed artifact revisions, and scope fences. */
import { chmod, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { expect, it, vi } from 'vitest'
import { ParsedArtifactStore } from '../../src/enrichment/artifact-store.ts'
import { refFieldsOf } from '../../src/ref-grammar.ts'
import { sourceKeyOf } from '../../src/enrichment/source-stamp.ts'
import {
  ZoteroError,
  ZOTERO_FILE_UNREADABLE,
  ZOTERO_NOT_FOUND,
  ZOTERO_PROVIDER_UNAVAILABLE,
} from '../../src/errors.ts'
import { withTempDir } from '../helpers/temp-dir.ts'
import { deferred } from '../helpers/sync.ts'
import {
  ARTIFACT,
  CACHE_KEY,
  SOURCE_RECORD,
  parsedIndexOf as indexOf,
} from './support/enrichment-artifacts.ts'

it('indexes all sections and verifies a reopened artifact index against committed Markdown', async () => {
  await withTempDir(async (root) => {
    const store = new ParsedArtifactStore(join(root, 'artifacts'))
    const markdown =
      '# 水库调度\n\nAnnual discharge.\n\n## 防洪风险\n\n暴雨期间，水库降低洪峰流量。'
    await store.put(CACHE_KEY, { ...ARTIFACT, markdown })
    const provider = vi.fn(() => {
      throw new Error('explicit search contacted Zotero')
    })
    const probe = vi.fn(async () => {
      throw new Error('explicit search probed an origin')
    })
    const request = {
      query: '洪峰流量',
      scope: { kind: 'artifacts' as const, artifactIds: [CACHE_KEY] },
      limit: 20,
    }
    const signal = new AbortController().signal
    for (let pass = 0; pass < 2; pass++) {
      const index = indexOf()
      try {
        const result = await index.search({ store, provider, probe }, request, signal)
        expect(result.coverage).toEqual({
          status: 'complete',
          discovered: 1,
          searchable: 1,
          stale: 0,
          missing: 0,
        })
        expect(result.passages).toHaveLength(1)
        const hit = result.passages[0]!
        expect(hit.heading).toBe('水库调度 / 防洪风险')
        expect(markdown.slice(hit.start, hit.end)).toBe(hit.text)
        expect(hit).toMatchObject({ artifactId: CACHE_KEY, generation: ARTIFACT.meta.generation })
      } finally {
        await index.close()
      }
    }
    expect(provider).not.toHaveBeenCalled()
    expect(probe).not.toHaveBeenCalled()
    const db = new DatabaseSync(join(store.root, 'index.db'), { readOnly: true })
    try {
      const definitions = db
        .prepare('SELECT sql FROM sqlite_schema WHERE sql LIKE ?')
        .all('%USING fts5%')
      expect(definitions).toHaveLength(1)
    } finally {
      db.close()
    }

    await store.discardArtifact(CACHE_KEY)
    const index = indexOf()
    try {
      const result = await index.search({ store, provider, probe }, request, signal)
      expect(result.coverage).toMatchObject({ status: 'unavailable', missing: 1 })
      expect(result.passages).toEqual([])
    } finally {
      await index.close()
    }
  })
})

it('filters by the current collection and generation before ranking and caps each document at three passages', async () => {
  await withTempDir(async (root) => {
    const index = indexOf()
    const store = new ParsedArtifactStore(join(root, 'artifacts'))
    const myCollection = 'COLL0001'
    const allowedRef = 'zotero://user/0/attachment/ATTACH01?server=local'
    const excludedRef = 'zotero://user/0/attachment/ATTACH02?server=local'
    const provider = () => ({
      parsedSearchAuthority: async () => 'local',
      parsedSearchAttachment: async (ref: string) => ({
        serverId: 'local',
        attachmentRef: ref,
        collectionKeys: ref === allowedRef ? [myCollection] : [],
      }),
    })
    const probe = async () => true
    const request = {
      query: 'resilience',
      variants: ['flooding'],
      scope: {
        kind: 'collection' as const,
        ref: `zotero://user/0/collection/${myCollection}?server=local`,
      },
      limit: 4,
    }
    const publish = async (
      artifactId: string,
      ref: string,
      markdown: string,
      generation = randomUUID(),
    ) => {
      const sourceId = sourceKeyOf(ref)
      await store.put(artifactId, {
        ...ARTIFACT,
        markdown,
        meta: { ...ARTIFACT.meta, sourceId, generation, identity: ref },
      })
      await store.putSource(sourceId, { ...SOURCE_RECORD, cacheKey: artifactId, generation })
      return generation
    }
    try {
      const allowedMarkdown = Array.from(
        { length: 8 },
        (_, index) => `## Evidence ${index}\n\nResilience and flooding measurement ${index}.\n\n`,
      ).join('')
      const generation = await publish(CACHE_KEY, allowedRef, allowedMarkdown)
      const signal = new AbortController().signal
      const withoutExcluded = await index.search({ store, provider, probe }, request, signal)
      await publish(
        'b'.repeat(64),
        excludedRef,
        Array.from({ length: 10 }, () => 'Resilience').join(' '),
      )
      const first = await index.search({ store, provider, probe }, request, signal)
      expect(first).toEqual(withoutExcluded)
      expect(first.passages).toHaveLength(3)
      expect(
        first.passages.every(
          (p) => p.generation === generation && refFieldsOf(p.attachmentRef!)?.key === 'ATTACH01',
        ),
      ).toBe(true)
      await publish(CACHE_KEY, allowedRef, '# Updated\n\nSeismic damage only.')
      const next = await index.search({ store, provider, probe }, request, signal)
      expect(next.coverage).toMatchObject({ status: 'complete', searchable: 1 })
      expect(next.passages).toEqual([])
    } finally {
      await index.close()
    }
  })
})

it('rejects a foreign database without changing its contents', async () => {
  await withTempDir(async (root) => {
    const path = join(root, 'index.db')
    const db = new DatabaseSync(path)
    db.exec("CREATE TABLE original (value TEXT); INSERT INTO original VALUES ('keep')")
    db.close()
    await chmod(path, 0o600)
    const index = indexOf()
    try {
      await expect(
        index.search(
          {
            store: new ParsedArtifactStore(root),
            provider: () => {
              throw new Error('unexpected Zotero request')
            },
            probe: async () => false,
          },
          { query: 'original', scope: { kind: 'artifacts', artifactIds: [CACHE_KEY] }, limit: 1 },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ code: ZOTERO_FILE_UNREADABLE })
    } finally {
      await index.close()
    }
    using verified = new DatabaseSync(path, { readOnly: true })
    expect(verified.prepare('SELECT value FROM original').get()?.value).toBe('keep')
    expect(verified.prepare('PRAGMA application_id').get()?.application_id).toBe(0)
  })
})

it.runIf(process.platform !== 'win32')('rejects a linked SQLite side file', async () => {
  await withTempDir(async (root) => {
    const path = join(root, 'index.db')
    await symlink(join(root, 'unrelated'), path + '-wal')
    const index = indexOf()
    try {
      await expect(index.publish(new ParsedArtifactStore(root), CACHE_KEY)).resolves.toBeUndefined()
      await expect(
        index.search(
          {
            store: new ParsedArtifactStore(root),
            provider: () => {
              throw new Error('unexpected Zotero request')
            },
            probe: async () => false,
          },
          { query: 'original', scope: { kind: 'artifacts', artifactIds: [CACHE_KEY] }, limit: 1 },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ code: ZOTERO_FILE_UNREADABLE })
    } finally {
      await index.close()
    }
  })
})

it('reports missing and stale scoped sources and excludes another Zotero instance', async () => {
  await withTempDir(async (root) => {
    const index = indexOf()
    const store = new ParsedArtifactStore(join(root, 'artifacts'))
    const one = 'zotero://user/0/attachment/ATTACH01?server=S1'
    const two = 'zotero://user/0/attachment/ATTACH02?server=S1'
    const foreign = 'zotero://user/0/attachment/ATTACH03?server=S2'
    const missing = 'zotero://user/0/attachment/ATTACH04?server=S1'
    const fixture = [one, two, foreign, missing]
    const ids = fixture.map((_, i) => String(i + 1).repeat(64))
    const request = {
      query: 'reservoir',
      scope: { kind: 'library' as const, library: { type: 'user' as const, id: 0 as const } },
      limit: 10,
    }
    const signal = new AbortController().signal
    const attachment = vi.fn(async (ref: string) => {
      if (ref === missing) throw new ZoteroError('Attachment was deleted', ZOTERO_NOT_FOUND)
      return { serverId: 'S1', attachmentRef: ref }
    })
    const authority = vi.fn(async () => 'S1')
    const provider = () => ({
      parsedSearchAuthority: authority,
      parsedSearchAttachment: attachment,
    })
    const probe = vi.fn(async (ref: string) => ref !== two)
    try {
      await index.discard(store.root, ids[0]!)
      for (const [i, identity] of fixture.entries()) {
        const sourceId = sourceKeyOf(identity)
        await store.put(ids[i]!, {
          ...ARTIFACT,
          markdown: 'Reservoir calibration',
          meta: {
            ...ARTIFACT.meta,
            sourceId,
            identity,
          },
        })
        await store.putSource(sourceId, { ...SOURCE_RECORD, cacheKey: ids[i]! })
        await index.publish(store, ids[i]!)
      }
      const result = await index.search({ store, provider, probe }, request, signal)
      expect(result.coverage).toEqual({
        status: 'partial',
        discovered: 3,
        searchable: 1,
        stale: 1,
        missing: 1,
      })
      expect(result.passages).toMatchObject([{ attachmentRef: one, artifactId: ids[0] }])
      expect(attachment.mock.calls.flat()).not.toContain(foreign)

      // Change the live attachment after admission but before delivering the passage.
      probe.mockImplementation(async (ref) => {
        if (ref === one) {
          const numProbes = probe.mock.calls.filter(([seen]) => seen === one).length
          return numProbes % 2 === 1
        }
        return false
      })
      await expect(index.search({ store, provider, probe }, request, signal)).rejects.toMatchObject(
        { code: ZOTERO_PROVIDER_UNAVAILABLE },
      )

      await store.withSourcePublicationLock(async () => {
        await index.discard(store.root, ids[0]!)
      }, signal)
      using db = new DatabaseSync(join(store.root, 'index.db'), { readOnly: true })
      const table = db.prepare("SELECT name FROM sqlite_master WHERE name GLOB '*_doc'").get()!
      expect(
        db.prepare(`SELECT artifactId FROM ${table.name} WHERE artifactId=?`).get(ids[0]!),
      ).toBeUndefined()
    } finally {
      await index.close()
    }
  })
})

it('releases query admission after the caller cancels source validation', async () => {
  await withTempDir(async (root) => {
    const index = indexOf()
    const store = new ParsedArtifactStore(join(root, 'artifacts'))
    const received = deferred<AbortSignal>()
    const controller = new AbortController()
    const error = new DOMException('cancelled search', 'AbortError')
    const request = {
      query: 'query',
      scope: { kind: 'library' as const, library: { type: 'user' as const, id: 0 as const } },
      limit: 1,
    }
    const deps = {
      store,
      probe: async () => false,
      provider: () => ({
        parsedSearchAuthority: async (
          _library: unknown,
          _collection: unknown,
          _expected: unknown,
          signal: AbortSignal,
        ) => {
          received.resolve(signal)
          return await new Promise<string>((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
          )
        },
        parsedSearchAttachment: async (ref: string) => ({ serverId: 'S1', attachmentRef: ref }),
      }),
    }
    try {
      const pending = index.search(deps, request, controller.signal)
      const rejection = expect(pending).rejects.toBe(error)
      const admitted = await received.promise
      await expect(index.search(deps, request, new AbortController().signal)).rejects.toMatchObject(
        { code: ZOTERO_PROVIDER_UNAVAILABLE },
      )
      controller.abort(error)
      await rejection
      expect(admitted.aborted).toBe(true)
      const result = await index.search(
        deps,
        {
          ...request,
          scope: { kind: 'artifacts', artifactIds: [CACHE_KEY] },
        },
        new AbortController().signal,
      )
      expect(result.coverage).toMatchObject({ status: 'unavailable', missing: 1 })
    } finally {
      controller.abort(error)
      await index.close()
    }
  })
})
