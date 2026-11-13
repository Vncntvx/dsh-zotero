/** The real Gateway and store perform source/Markdown I/O only at snapshot open. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ParsedArtifactStore } from '../../src/enrichment/artifact-store.ts'
import { sourceKeyOf } from '../../src/enrichment/source-stamp.ts'
import { ZOTERO_ARTIFACT_PAGE_CHARS } from '../../src/contract.ts'
import { memoryFiles } from './support/enrichment-parse-domain.ts'
import { ARTIFACT } from './support/enrichment-artifacts.ts'
import { endpointFixture, DOCUMENT_URL } from './support/enrichment-parse-endpoints.ts'

const owned: Array<{ fixture: Awaited<ReturnType<typeof endpointFixture>>; dir: string }> = []
afterEach(async () => {
  for (const { fixture, dir } of owned.splice(0)) {
    await fixture.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

it('opens one validated source and serves 4 blocks plus 12 figures without repeated HEAD or full reads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zotero-read-io-'))
  const fs = memoryFiles()
  const store = new ParsedArtifactStore(dir, fs.deps)
  const fixture = await endpointFixture({ store })
  owned.push({ fixture, dir })
  fixture.grant()
  const text = 'x'.repeat(ZOTERO_ARTIFACT_PAGE_CHARS * 3) + 'tail'
  const images = Array.from({ length: 12 }, (_, i) => ({
    name: `images/f${i}.png`,
    data: new Uint8Array([137, 80, 78, 71]),
  }))
  const cacheKey = 'd'.repeat(64)
  const sourceId = sourceKeyOf(DOCUMENT_URL)
  await store.put(cacheKey, {
    ...ARTIFACT,
    markdown: text,
    images,
    meta: {
      ...ARTIFACT.meta,
      sourceId,
      identity: 'https://papers.example.org/…',
      images: images.map((image) => ({
        name: image.name,
        mediaType: 'image/png',
        bytes: image.data.byteLength,
      })),
    },
  })
  await store.putSource(sourceId, {
    version: 2,
    parser: 'mineru',
    format: 'markdown',
    cacheKey,
    fingerprint: ARTIFACT.meta.contentFingerprint,
    generation: ARTIFACT.meta.generation,
    stamp: { kind: 'url', url: DOCUMENT_URL, etag: '"endpoint-v1"' },
  })
  const read = vi.mocked(fs.deps.readFile)
  read.mockClear()
  const opened = await fixture.open({ kind: 'url', url: DOCUMENT_URL }, fixture.guest)
  if (opened.kind !== 'opened') throw new Error('Expected open')
  for (
    let offset = ZOTERO_ARTIFACT_PAGE_CHARS;
    offset < text.length;
    offset += ZOTERO_ARTIFACT_PAGE_CHARS
  )
    await fixture.page(opened.lease, offset, fixture.guest)
  for (const image of images) await fixture.figure(opened.lease, image.name, fixture.guest)
  const paths = read.mock.calls.map(([path]) => path)
  expect(paths.filter((path) => path.endsWith('/full.md'))).toHaveLength(1)
  expect(paths.filter((path) => path.endsWith('/content_list.json'))).toHaveLength(0)
  expect(paths.filter((path) => path.endsWith('/sources/index.json'))).toHaveLength(1)
  expect(paths.filter((path) => path.includes('/images/'))).toHaveLength(12)
  expect(fixture.http.calls.map(({ init }) => init.method)).toEqual(['HEAD'])
  expect(fixture.resolved).not.toHaveBeenCalled()
})
