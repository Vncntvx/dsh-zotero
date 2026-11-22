/** Reconciliation against a changing parsed artifact and its Zotero source. */
import { unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { ParsedArtifactStore } from '../../src/enrichment/artifact-store.ts'
import { sourceKeyOf } from '../../src/enrichment/source-stamp.ts'
import {
  ZoteroError,
  ZOTERO_FILE_UNREADABLE,
  ZOTERO_NO_ATTACHMENT,
  ZOTERO_PROVIDER_UNAVAILABLE,
} from '../../src/errors.ts'
import { withTempDir } from '../helpers/temp-dir.ts'
import {
  ARTIFACT,
  CACHE_KEY,
  SOURCE_RECORD,
  parsedIndexOf as indexOf,
} from './support/enrichment-artifacts.ts'

it('allows retry after an unwritable index path is repaired', async () => {
  await withTempDir(async (root) => {
    const obstruction = join(root, 'obstruction')
    await writeFile(obstruction, 'keep')
    const store = new ParsedArtifactStore(join(root, 'artifacts'))
    const index = indexOf(join(obstruction, 'database'))
    try {
      await expect(index.discard(store.root, CACHE_KEY)).rejects.toMatchObject({ code: 'ENOTDIR' })
      const request = {
        query: 'evidence',
        scope: { kind: 'artifacts' as const, artifactIds: [CACHE_KEY] },
        limit: 1,
      }
      const deps = {
        store,
        provider: () => {
          throw new Error('unexpected Zotero request')
        },
        probe: async () => false,
      }
      await expect(index.search(deps, request, AbortSignal.any([]))).rejects.toMatchObject({
        code: ZOTERO_FILE_UNREADABLE,
      })
      await unlink(obstruction)
      await expect(index.search(deps, request, AbortSignal.any([]))).resolves.toMatchObject({
        coverage: { status: 'unavailable', missing: 1 },
      })
    } finally {
      await index.close()
    }
  })
})

it('rejects an artifact revision that changes before indexing and re-reads it on retry', async () => {
  await withTempDir(async (root) => {
    const index = indexOf(join(root, 'database'))
    const store = new ParsedArtifactStore(join(root, 'artifacts'))
    const identity = 'zotero://user/0/attachment/ATTACH01?server=S1'
    const meta = { ...ARTIFACT.meta, identity, sourceId: sourceKeyOf(identity) }
    await store.put(CACHE_KEY, { ...ARTIFACT, markdown: 'Reservoir old evidence', meta })
    const generation = randomUUID()
    const metaFor = store.metaFor.bind(store)
    vi.spyOn(store, 'metaFor').mockImplementationOnce(async (artifactId) => {
      const old = await metaFor(artifactId)
      await store.put(artifactId, {
        ...ARTIFACT,
        markdown: 'Reservoir new evidence',
        meta: { ...meta, generation },
      })
      return old
    })
    const deps = {
      store,
      provider: () => {
        throw new Error('unexpected Zotero request')
      },
      probe: async () => false,
    }
    const request = {
      query: 'reservoir',
      scope: { kind: 'artifacts' as const, artifactIds: [CACHE_KEY] },
      limit: 1,
    }
    const signal = AbortSignal.any([])
    try {
      await expect(index.search(deps, request, signal)).rejects.toMatchObject({
        code: ZOTERO_PROVIDER_UNAVAILABLE,
      })
      await expect(index.search(deps, request, signal)).resolves.toMatchObject({
        passages: [{ attachmentRef: identity, generation, text: 'Reservoir new evidence' }],
      })
    } finally {
      await index.close()
    }
  })
})

it('counts disappeared files only within their current collection and refuses a removed member', async () => {
  await withTempDir(async (root) => {
    const index = indexOf(join(root, 'database'))
    const store = new ParsedArtifactStore(join(root, 'artifacts'))
    const collection = 'COLL0001'
    const identities = ['ATTACH01', 'ATTACH02', 'ATTACH03'].map(
      (key) => `zotero://user/0/attachment/${key}?server=S1`,
    )
    for (const [i, identity] of identities.entries()) {
      const sourceId = sourceKeyOf(identity)
      const artifactId = String(i + 1).repeat(64)
      await store.put(artifactId, {
        ...ARTIFACT,
        markdown: 'Reservoir calibration',
        meta: { ...ARTIFACT.meta, identity, sourceId },
      })
      await store.putSource(sourceId, { ...SOURCE_RECORD, cacheKey: artifactId })
    }
    const item = {
      ref: 'zotero://user/0/item/PARENT01?server=S1',
      title: 'Reservoir',
      creatorSummary: '',
    }
    let active = true
    const deps = {
      store,
      provider: () => ({
        parsedSearchAuthority: async () => 'S1',
        parsedSearchAttachment: async (ref: string) => ({
          serverId: 'S1',
          attachmentRef: ref,
          item,
          collectionKeys:
            ref === identities[2] || (ref === identities[0] && !active) ? [] : [collection],
        }),
      }),
      probe: vi.fn(async (ref: string) => {
        if (ref === identities[1]) throw new ZoteroError('PDF disappeared', ZOTERO_NO_ATTACHMENT)
        if (ref === identities[2]) throw Object.assign(new Error('PDF missing'), { code: 'ENOENT' })
        return true
      }),
    }
    const request = {
      query: 'reservoir',
      scope: {
        kind: 'collection' as const,
        ref: `zotero://user/0/collection/${collection}?server=S1`,
      },
      limit: 3,
    }
    const signal = AbortSignal.any([])
    try {
      await expect(index.search(deps, request, signal)).resolves.toMatchObject({
        coverage: { status: 'partial', discovered: 2, missing: 1 },
        passages: [{ itemRef: item.ref, attachmentRef: identities[0] }],
      })
      deps.probe.mockImplementation(async (ref) => {
        if (ref === identities[0]) active = false
        return true
      })
      await expect(index.search(deps, request, signal)).rejects.toMatchObject({
        code: ZOTERO_PROVIDER_UNAVAILABLE,
      })
    } finally {
      await index.close()
    }
  })
})
