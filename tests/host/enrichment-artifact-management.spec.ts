/** Management inventory unions index and directory views; a discard clears every trace. */
import { describe, expect, it, vi } from 'vitest'
import { deferred } from '../helpers/sync.ts'
import { ParsedArtifactStore } from '../../src/enrichment/artifact-store.ts'
import {
  discardParsedDocument,
  listParsedDocuments,
  type ArtifactManagementDeps,
} from '../../src/enrichment/artifact-management.ts'
import { memoryFiles } from './support/enrichment-parse-domain.ts'
import { ARTIFACT, CACHE_KEY, SOURCE_RECORD } from './support/enrichment-artifacts.ts'
import { sourceKeyOf } from '../../src/enrichment/source-stamp.ts'
import { attachmentRef } from '../helpers/server/keys.ts'

const REF = attachmentRef()
/** The unwindowed first page every inventory read starts from. */
const FIRST_PAGE = { offset: 0, limit: 50 } as const

const URL = 'https://papers.example.org/a.pdf?token=secret'
const FIGURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
const URL_ARTIFACT = {
  ...ARTIFACT,
  images: [{ name: 'images/figure.png', data: FIGURE }],
  meta: {
    ...ARTIFACT.meta,
    identity: 'https://papers.example.org/…',
    sourceUrl: URL,
    images: [
      { name: 'images/figure.png', mediaType: 'image/png' as const, bytes: FIGURE.byteLength },
    ],
  },
}

function management(fs: ReturnType<typeof memoryFiles>) {
  const store = new ParsedArtifactStore('/root', fs.deps)
  const persistence = {
    get: vi.fn(async () => undefined),
    put: vi.fn(async () => {}),
    generation: vi.fn(async () => undefined),
    putGeneration: vi.fn(async () => {}),
    deleteByGeneration: vi.fn(async () => 2),
  }
  const jobs = {
    retireArtifact: vi.fn(),
    forgetGeneration: vi.fn(),
  }
  const deps: ArtifactManagementDeps = {
    store: async () => store,
    config: () => ({}) as never,
    persistence: persistence as never,
    jobs: jobs as never,
  }
  return { store, persistence, jobs, deps, fs }
}

describe('parsed artifact inventory', () => {
  it('deduplicates index aliases and never returns a complete URL', async () => {
    const world = management(memoryFiles())
    await world.store.put(CACHE_KEY, URL_ARTIFACT)
    const aliases = [sourceKeyOf(URL), sourceKeyOf(`${URL}&v=2`), 'b'.repeat(64)]
    await world.store.putSources(aliases, SOURCE_RECORD)
    const list = await listParsedDocuments(world.deps, FIRST_PAGE)
    expect(list.total).toBe(1)
    expect(list.rows[0]!.state).toBe('indexed')
    expect(list.rows[0]!.aliases).toHaveLength(3)
    expect(list.rows[0]!.targetLabel).toBe('https://papers.example.org/…')
    expect(list.rows[0]!.actionable).toBe(true)
    expect(JSON.stringify(list.rows)).not.toContain('secret')
  })

  it('lists an orphan directory without an index pointer', async () => {
    const world = management(memoryFiles())
    await world.store.put(CACHE_KEY, URL_ARTIFACT)
    const list = await listParsedDocuments(world.deps, FIRST_PAGE)
    expect(list.rows[0]!.state).toBe('orphan')
    expect(list.rows[0]!.actionable).toBe(true)
  })

  it('marks a dangling index record broken without failing the whole list', async () => {
    const world = management(memoryFiles())
    await world.store.putSources(['c'.repeat(64)], SOURCE_RECORD)
    await world.store.put('d'.repeat(64), ARTIFACT)
    const list = await listParsedDocuments(world.deps, FIRST_PAGE)
    expect(list.total).toBe(2)
    expect(list.rows.find((row) => row.state === 'broken')?.broken).toBeDefined()
    expect(list.rows.find((row) => row.state === 'orphan')).toBeDefined()
  })

  it('discards the directory, every alias, the task and all receipts', async () => {
    const world = management(memoryFiles())
    await world.store.put(CACHE_KEY, ARTIFACT)
    await world.store.putTask(CACHE_KEY, {
      taskId: 't1',
      createdAt: 1,
      uploaded: true,
    })
    await world.store.putSources(['c'.repeat(64), 'd'.repeat(64)], SOURCE_RECORD)
    const result = await discardParsedDocument(world.deps, CACHE_KEY)
    expect(result).toEqual({ kind: 'discarded', removedAliases: 2, removedReceipts: 2 })
    expect(await world.store.get(CACHE_KEY)).toBeUndefined()
    expect((await world.store.groupByArtifact()).get(CACHE_KEY)?.aliases ?? []).toEqual([])
    expect(await world.store.getTask(CACHE_KEY)).toBeUndefined()
    expect(world.persistence.deleteByGeneration).toHaveBeenCalledWith({}, ARTIFACT.meta.generation)
    expect(world.jobs.retireArtifact).toHaveBeenCalledWith(CACHE_KEY)
    expect(world.jobs.forgetGeneration).toHaveBeenCalledWith(ARTIFACT.meta.generation)
    const list = await listParsedDocuments(world.deps, FIRST_PAGE)
    expect(list.total).toBe(0)
  })

  it('returns missing for an unknown artifact id', async () => {
    const world = management(memoryFiles())
    expect(await discardParsedDocument(world.deps, 'e'.repeat(64))).toEqual({ kind: 'missing' })
    expect(world.jobs.retireArtifact).not.toHaveBeenCalled()
  })

  it('rejects a malformed artifact id', async () => {
    const world = management(memoryFiles())
    await expect(discardParsedDocument(world.deps, 'nope')).rejects.toMatchObject({
      code: 'ZOTERO_ENRICHMENT_ARTIFACT_NOT_FOUND',
    })
  })

  it('reports a failed cleanup with the artifact delete code', async () => {
    const world = management(memoryFiles())
    await world.store.put(CACHE_KEY, ARTIFACT)
    vi.spyOn(world.store, 'discardArtifact').mockRejectedValue(
      new Error(`EACCES: permission denied, rm '/root/${CACHE_KEY}'`),
    )
    const error = await discardParsedDocument(world.deps, CACHE_KEY).then(
      () => undefined,
      (cause) => cause as Error,
    )
    expect(error).toMatchObject({ code: 'ZOTERO_ENRICHMENT_ARTIFACT_DELETE_FAILED' })
    expect(error!.message).not.toContain('/root/')
    expect(error!.message).toContain('[path]')
  })

  it('keeps a corrupt meta row isolated from a healthy one', async () => {
    const world = management(memoryFiles())
    await world.store.put('d'.repeat(64), ARTIFACT)
    const broken = 'c'.repeat(64)
    world.fs.files.set(`/root/${broken}/meta.json`, new TextEncoder().encode('{bad json'))
    await world.store.putSources([broken], SOURCE_RECORD)
    const list = await listParsedDocuments(world.deps, FIRST_PAGE)
    expect(list.total).toBe(3)
    expect(list.rows.find((entry) => entry.artifactId === broken)?.state).toBe('broken')
    expect(list.rows.find((entry) => entry.state === 'orphan')?.actionable).toBe(true)
  })

  it('sanitizes an unreadable meta row instead of leaking its path', async () => {
    const world = management(memoryFiles())
    const broken = 'c'.repeat(64)
    world.fs.files.set(`/root/${broken}/meta.json`, new TextEncoder().encode('{}'))
    await world.store.putSources([broken], SOURCE_RECORD)
    const readFile = vi.mocked(world.fs.deps.readFile).getMockImplementation()!
    vi.mocked(world.fs.deps.readFile).mockImplementation(async (path) => {
      if (path.endsWith(`${broken}/meta.json`))
        throw new Error(`EACCES: permission denied, open '/root/${broken}/meta.json'`)
      return await readFile(path)
    })
    const list = await listParsedDocuments(world.deps, FIRST_PAGE)
    expect(list.rows.find((entry) => entry.artifactId === broken)?.broken).toEqual({
      code: 'unreadable-meta',
      detail: "EACCES: permission denied, open '[path]'",
    })
    expect(JSON.stringify(list.rows)).not.toContain('/root/')
  })

  it('marks an unresolvable source as not actionable', async () => {
    const world = management(memoryFiles())
    await world.store.put('d'.repeat(64), {
      ...ARTIFACT,
      meta: { ...ARTIFACT.meta, identity: 'https://papers.example.org/…' },
    })
    const list = await listParsedDocuments(world.deps, FIRST_PAGE)
    expect(list.rows[0]!.state).toBe('orphan')
    expect(list.rows[0]!.actionable).toBe(false)
  })

  it('marks an attachment artifact with a corrupted identity as not actionable', async () => {
    const world = management(memoryFiles())
    // safeDisplay refuses a non-attachment identity at the store boundary, so
    // the corrupted row is written directly, the way an older format would
    // have left it behind.
    world.fs.files.set(
      `/root/${CACHE_KEY}/meta.json`,
      new TextEncoder().encode(
        JSON.stringify({
          ...ARTIFACT.meta,
          identity: 'zotero://user/0/item/ITEM0001',
          sourceId: 'b'.repeat(64),
        }),
      ),
    )
    await world.store.putSources([sourceKeyOf(REF)], SOURCE_RECORD)
    const list = await listParsedDocuments(world.deps, FIRST_PAGE)
    expect(list.rows.find((entry) => entry.artifactId === CACHE_KEY)?.actionable).toBe(false)
  })

  it('passes the captured Markdown title through to the row', async () => {
    const world = management(memoryFiles())
    await world.store.put(CACHE_KEY, {
      ...ARTIFACT,
      meta: { ...ARTIFACT.meta, title: 'Attention Is All You Need' },
    })
    const list = await listParsedDocuments(world.deps, FIRST_PAGE)
    expect(list.rows[0]!.title).toBe('Attention Is All You Need')
  })

  it('leaves a broken row without a title', async () => {
    const world = management(memoryFiles())
    await world.store.putSources(['c'.repeat(64)], SOURCE_RECORD)
    const list = await listParsedDocuments(world.deps, FIRST_PAGE)
    expect(list.rows[0]!.state).toBe('broken')
    expect(list.rows[0]!.title).toBeUndefined()
  })

  it('narrows by state and counts only the rows it admits', async () => {
    const world = management(memoryFiles())
    await world.store.put(CACHE_KEY, ARTIFACT)
    await world.store.putSources([sourceKeyOf(REF)], SOURCE_RECORD)
    await world.store.put('d'.repeat(64), ARTIFACT)
    const indexed = await listParsedDocuments(world.deps, { ...FIRST_PAGE, state: 'indexed' })
    expect(indexed.total).toBe(1)
    expect(indexed.rows.map((row) => row.artifactId)).toEqual([CACHE_KEY])
    const orphan = await listParsedDocuments(world.deps, { ...FIRST_PAGE, state: 'orphan' })
    expect(orphan.total).toBe(1)
    expect(orphan.rows.map((row) => row.artifactId)).toEqual(['d'.repeat(64)])
  })

  it('matches a search needle against the title, the safe label and the id', async () => {
    const world = management(memoryFiles())
    await world.store.put(CACHE_KEY, {
      ...ARTIFACT,
      meta: { ...ARTIFACT.meta, title: 'Attention Is All You Need' },
    })
    await world.store.put('d'.repeat(64), URL_ARTIFACT)
    const byTitle = await listParsedDocuments(world.deps, { ...FIRST_PAGE, query: 'attention' })
    expect(byTitle.rows.map((row) => row.artifactId)).toEqual([CACHE_KEY])
    const byLabel = await listParsedDocuments(world.deps, {
      ...FIRST_PAGE,
      query: 'papers.example.org',
    })
    expect(byLabel.rows.map((row) => row.artifactId)).toEqual(['d'.repeat(64)])
    const byId = await listParsedDocuments(world.deps, {
      ...FIRST_PAGE,
      query: CACHE_KEY.slice(0, 8),
    })
    expect(byId.rows.map((row) => row.artifactId)).toEqual([CACHE_KEY])
  })

  it('windows after filtering so the filtered total drives the pager', async () => {
    const world = management(memoryFiles())
    await world.store.put(CACHE_KEY, {
      ...ARTIFACT,
      meta: { ...ARTIFACT.meta, title: 'Attention Is All You Need' },
    })
    await world.store.put('d'.repeat(64), {
      ...ARTIFACT,
      meta: { ...ARTIFACT.meta, title: 'Attention Sinks' },
    })
    const page = await listParsedDocuments(world.deps, { offset: 0, limit: 1, query: 'attention' })
    expect(page.total).toBe(2)
    expect(page.rows).toHaveLength(1)
  })

  it('returns an empty page past the end while still counting the rows', async () => {
    const world = management(memoryFiles())
    await world.store.put(CACHE_KEY, ARTIFACT)
    const list = await listParsedDocuments(world.deps, { offset: 50, limit: 50 })
    expect(list.rows).toEqual([])
    expect(list.total).toBe(1)
  })

  it('groups every alias under its artifact id in one pass', async () => {
    const world = management(memoryFiles())
    await world.store.put(CACHE_KEY, URL_ARTIFACT)
    await world.store.putSources([sourceKeyOf(URL), sourceKeyOf(`${URL}&v=2`)], SOURCE_RECORD)
    const group = (await world.store.groupByArtifact()).get(CACHE_KEY)
    expect(group?.aliases).toEqual([sourceKeyOf(URL), sourceKeyOf(`${URL}&v=2`)])
    expect(group?.record?.cacheKey).toBe(CACHE_KEY)
  })

  it('serves the inventory from cache until the store is written again', async () => {
    const world = management(memoryFiles())
    await world.store.put(CACHE_KEY, ARTIFACT)
    const metaReads = () => vi.mocked(world.fs.deps.readFile).mock.calls.length
    await world.store.inventory()
    const afterFirst = metaReads()
    await world.store.inventory()
    expect(metaReads()).toBe(afterFirst)
    await world.store.put('d'.repeat(64), ARTIFACT)
    await world.store.inventory()
    expect(metaReads()).toBeGreaterThan(afterFirst)
  })

  it('answers directory presence without enumerating the store', async () => {
    const world = management(memoryFiles())
    await world.store.put(CACHE_KEY, ARTIFACT)
    expect(await world.store.hasArtifactDirectory(CACHE_KEY)).toBe(true)
    expect(await world.store.hasArtifactDirectory('e'.repeat(64))).toBe(false)
  })

  it('keeps a concurrent publication intact while a discard removes the same artifact', async () => {
    const world = management(memoryFiles())
    await world.store.put(CACHE_KEY, ARTIFACT)
    await world.store.putSources([sourceKeyOf(URL)], SOURCE_RECORD)
    const dirRemoval = deferred()
    const rm = vi.mocked(world.fs.deps.rm).getMockImplementation()!
    vi.mocked(world.fs.deps.rm).mockImplementation(async (path, options) => {
      if (path === `/root/${CACHE_KEY}`) await dirRemoval.promise
      return await rm(path, options)
    })
    const discard = world.store.discardArtifact(CACHE_KEY)
    // The publication enters the same lock and must land after the whole
    // discard, never between its alias and directory removals.
    const publish = world.store.putSources([sourceKeyOf(URL)], SOURCE_RECORD)
    dirRemoval.resolve()
    const removedAliases = await discard
    await publish
    expect(removedAliases).toBe(1)
    expect((await world.store.groupByArtifact()).get(CACHE_KEY)?.aliases).toEqual([
      sourceKeyOf(URL),
    ])
    expect(await world.store.get(CACHE_KEY)).toBeUndefined()
    expect(await world.store.getTask(CACHE_KEY)).toBeUndefined()
  })
})
