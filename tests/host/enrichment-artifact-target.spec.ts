/** An opaque artifact id expands to a concrete source on the host only. */
import { describe, expect, it } from 'vitest'
import { ParsedArtifactStore } from '../../src/enrichment/artifact-store.ts'
import { expandRequestTarget, resolveArtifactTarget } from '../../src/enrichment/artifact-target.ts'
import { memoryFiles } from './support/enrichment-parse-domain.ts'
import { ARTIFACT, CACHE_KEY, SOURCE_RECORD } from './support/enrichment-artifacts.ts'
import { sourceKeyOf } from '../../src/enrichment/source-stamp.ts'
import { attachmentRef } from '../helpers/server/keys.ts'

const URL = 'https://papers.example.org/a.pdf?token=secret'

function world() {
  const fs = memoryFiles()
  return { fs, store: new ParsedArtifactStore('/root', fs.deps) }
}

describe('artifact target expansion', () => {
  it('rebuilds an attachment target from a committed artifact', async () => {
    const { store } = world()
    await store.put(CACHE_KEY, ARTIFACT)
    await store.putSources([sourceKeyOf(attachmentRef())], SOURCE_RECORD)
    const resolved = await resolveArtifactTarget(CACHE_KEY, store)
    expect(resolved.target.target).toEqual({ kind: 'attachment', ref: attachmentRef() })
    expect(resolved.indexed).toBe(true)
    expect(resolved.generation).toBe(ARTIFACT.meta.generation)
  })

  it('rebuilds an orphan URL target from meta.sourceUrl without an index', async () => {
    const { store } = world()
    await store.put(CACHE_KEY, {
      ...ARTIFACT,
      meta: {
        ...ARTIFACT.meta,
        identity: 'https://papers.example.org/…',
        sourceUrl: URL,
      },
    })
    const expanded = await expandRequestTarget({ kind: 'artifact', artifactId: CACHE_KEY }, store)
    expect(expanded.target).toEqual({ kind: 'url', url: URL })
    const resolved = await resolveArtifactTarget(CACHE_KEY, store)
    expect(resolved.target.targetLabel).toBe('https://papers.example.org/…')
    expect(resolved.indexed).toBe(false)
  })

  it('leaves a concrete target unchanged', async () => {
    const { store } = world()
    const target = { kind: 'attachment' as const, ref: attachmentRef() }
    expect(await expandRequestTarget(target, store)).toEqual({ target })
  })

  it('rejects a malformed artifact id', async () => {
    const { store } = world()
    await expect(resolveArtifactTarget('nope', store)).rejects.toMatchObject({
      code: 'ZOTERO_ENRICHMENT_ARTIFACT_NOT_FOUND',
    })
  })

  it('rejects an artifact id with no committed meta', async () => {
    const { store } = world()
    await expect(resolveArtifactTarget('b'.repeat(64), store)).rejects.toMatchObject({
      code: 'ZOTERO_ENRICHMENT_ARTIFACT_NOT_FOUND',
    })
  })

  it('rejects a URL artifact with no recoverable source', async () => {
    const { store } = world()
    await store.put(CACHE_KEY, {
      ...ARTIFACT,
      meta: { ...ARTIFACT.meta, identity: 'https://papers.example.org/…' },
    })
    await expect(resolveArtifactTarget(CACHE_KEY, store)).rejects.toMatchObject({
      code: 'ZOTERO_ENRICHMENT_ARTIFACT_NOT_FOUND',
    })
  })

  it('falls back to the indexed URL stamp when meta has no sourceUrl', async () => {
    const { store } = world()
    await store.put(CACHE_KEY, {
      ...ARTIFACT,
      meta: { ...ARTIFACT.meta, identity: 'https://papers.example.org/…' },
    })
    await store.putSources(['c'.repeat(64)], {
      ...SOURCE_RECORD,
      stamp: { kind: 'url', url: URL },
    })
    const expanded = await expandRequestTarget({ kind: 'artifact', artifactId: CACHE_KEY }, store)
    expect(expanded.target).toEqual({ kind: 'url', url: URL })
  })
})
