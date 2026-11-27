import { expect, it } from 'vitest'
import {
  artifactLocationsOf,
  artifactRegionTextOf,
} from '../../src/enrichment/artifact-locations.ts'
import { ParsedArtifactStore } from '../../src/enrichment/artifact-store.ts'
import { CACHE_KEY, ARTIFACT } from './support/enrichment-artifacts.ts'
import { memoryFiles } from './support/enrichment-parse-domain.ts'
import {
  ZOTERO_ARTIFACT_LOCATION_LIMIT,
  ZOTERO_ARTIFACT_REGION_TEXT_CHARS,
} from '../../src/contract.ts'

const rows = [
  { type: 'text', text_level: 1, page_idx: 0, bbox: [0, 30, 400, 100], text: ' A  heading ' },
  { type: 'chart', page_idx: 1, bbox: [100, 100, 300, 400], chart_caption: ['Chart 1'] },
  { type: 'table', page_idx: 1, bbox: [400, 200, 400, 350] },
  { type: 'equation', page_idx: 1, bbox: [100, 300, 1_200, 500], text: 'x = 2' },
  { type: 'image', bbox: [0, 0, 1000, 1000] },
  { type: 'image', page_idx: 2, bbox: [0, 0, 1000, 1000] },
  { type: 'unknown', page_idx: 0 },
]

it('preserves MinerU pages and validates bounding boxes independently of the page', () => {
  expect(artifactLocationsOf(rows, 2)).toEqual([
    { kind: 'heading', pageIndex: 0, box: [0, 30, 400, 100], label: 'A heading' },
    { kind: 'chart', pageIndex: 1, box: [100, 100, 300, 400], label: 'Chart 1' },
    { kind: 'table', pageIndex: 1 },
    { kind: 'equation', pageIndex: 1, label: 'x = 2' },
  ])
})

it('rejects a different layout shape or a list too large to index completely', () => {
  expect(artifactLocationsOf({ pdf_info: rows })).toBeUndefined()
  expect(
    artifactLocationsOf(Array.from({ length: ZOTERO_ARTIFACT_LOCATION_LIMIT + 1 }, () => rows[0])),
  ).toBeUndefined()
})

it('quotes whole text blocks in parser order within each physical page', () => {
  expect(
    artifactRegionTextOf(
      [
        ...rows,
        { type: 'text', page_idx: 1, bbox: [120, 105, 180, 125], text: 'Second page' },
        { type: 'text', page_idx: 0, bbox: [60, 110, 300, 210], text: ' First page passage ' },
        { type: 'text', page_idx: 0, bbox: [80, 110, 420, 210], text: 'Straddles the selection' },
        { type: 'text', page_idx: 0, bbox: [60, 240, 300, 270], text: 'Outside the selection' },
      ],
      [
        { pageIndex: 1, box: [100, 100, 240, 540] },
        { pageIndex: 0, box: [0, 30, 400, 240] },
      ],
      2,
    ),
  ).toEqual({ text: 'A  heading\n\nFirst page passage\n\nSecond page', incomplete: true })
})

it('preserves Unicode at the excerpt limit and records pages with no matching block', () => {
  const prefix = 'x'.repeat(ZOTERO_ARTIFACT_REGION_TEXT_CHARS - 1)
  const regions = [
    { pageIndex: 0, box: [0, 0, 1000, 1000] as const },
    { pageIndex: 1, box: [0, 0, 1000, 1000] as const },
  ]
  expect(artifactRegionTextOf([{ ...rows[0], text: prefix + '🧪tail' }], regions, 1)).toEqual({
    text: prefix,
    incomplete: true,
  })
  expect(artifactRegionTextOf([{ ...rows[0], bbox: null }], regions)).toBeUndefined()
})

it('omits locations and text if the bounded stored list fails its committed digest', async () => {
  const { deps, files } = memoryFiles()
  const store = new ParsedArtifactStore('/root', deps)
  await store.put(CACHE_KEY, { ...ARTIFACT, contentList: JSON.stringify(rows) })
  const committed = await store.metaFor(CACHE_KEY)
  const digest = committed!.meta.contentListSha256!
  const regions = [{ pageIndex: 0, box: [0, 0, 1000, 1000] as const }]
  await expect(store.readLocations(CACHE_KEY, digest, 2)).resolves.toHaveLength(4)
  await expect(store.readRegionText(CACHE_KEY, digest, regions, 2)).resolves.toEqual({
    text: 'A  heading',
    incomplete: false,
  })
  files.set(
    `/root/${CACHE_KEY}/content_list.json`,
    new TextEncoder().encode(JSON.stringify(rows.slice(1))),
  )
  await expect(store.readLocations(CACHE_KEY, digest, 2)).resolves.toBeUndefined()
  await expect(store.readRegionText(CACHE_KEY, digest, regions, 2)).resolves.toBeUndefined()
})
