/** Closed v2 artifact and index formats reject corruption without repair or migration. */
import { describe, expect, it } from 'vitest'
import { ParsedArtifactStore } from '../../src/enrichment/artifact-store.ts'
import {
  SOURCE_INDEX_MAX_BYTES,
  SOURCE_INDEX_MAX_ENTRIES,
  sourceIndexSchema,
} from '../../src/enrichment/artifact-schema.ts'
import { memoryFiles } from './support/enrichment-parse-domain.ts'
import { ARTIFACT, CACHE_KEY, SOURCE_KEY, SOURCE_RECORD } from './support/enrichment-artifacts.ts'

const invalidMeta: ReadonlyArray<{ name: string; value: unknown }> = [
  { name: 'v1', value: { ...ARTIFACT.meta, version: 1 } },
  { name: 'absent version', value: { ...ARTIFACT.meta, version: undefined } },
  { name: 'unknown field', value: { ...ARTIFACT.meta, rawUrl: 'https://example.org/private' } },
  { name: 'wrong parser', value: { ...ARTIFACT.meta, parser: 'local' } },
  { name: 'wrong format', value: { ...ARTIFACT.meta, format: 'text' } },
  { name: 'invalid sourceId', value: { ...ARTIFACT.meta, sourceId: 'abc' } },
  { name: 'invalid generation', value: { ...ARTIFACT.meta, generation: 'generation-1' } },
  {
    name: 'unsafe URL display',
    value: { ...ARTIFACT.meta, identity: 'https://example.org/secret.pdf' },
  },
  {
    name: 'query in display',
    value: { ...ARTIFACT.meta, identity: 'https://example.org/…?token=secret' },
  },
  { name: 'invalid fingerprint', value: { ...ARTIFACT.meta, contentFingerprint: 'g'.repeat(64) } },
  { name: 'invalid taskId', value: { ...ARTIFACT.meta, taskId: '../task' } },
  { name: 'empty files', value: { ...ARTIFACT.meta, files: [] } },
  { name: 'unknown file', value: { ...ARTIFACT.meta, files: ['full.md', '../other'] } },
  { name: 'duplicate files', value: { ...ARTIFACT.meta, files: ['full.md', 'full.md'] } },
  { name: 'reordered files', value: { ...ARTIFACT.meta, files: ['content_list.json', 'full.md'] } },
  { name: 'zero pages', value: { ...ARTIFACT.meta, pageCount: 0 } },
  { name: 'fractional pages', value: { ...ARTIFACT.meta, pageCount: 1.5 } },
]

describe('strict v2 artifact format', () => {
  it('rejects changed UTF-8 bytes even when the displayed character count is unchanged', async () => {
    const fs = memoryFiles()
    const store = new ParsedArtifactStore('/root', fs.deps)
    await store.put(CACHE_KEY, { ...ARTIFACT, markdown: 'é' })
    await expect(store.readMarkdown(CACHE_KEY, 1, 2)).resolves.toBe('é')
    await fs.deps.writeFile(`/root/${CACHE_KEY}/full.md`, 'e')
    await expect(store.readMarkdown(CACHE_KEY, 1, 2)).rejects.toThrow(/metadata/)
  })

  it.each(invalidMeta)('rejects $name metadata in a committed artifact', async ({ value }) => {
    const fs = memoryFiles()
    const store = new ParsedArtifactStore('/root', fs.deps)
    await store.put(CACHE_KEY, ARTIFACT)
    await fs.deps.writeFile(`/root/${CACHE_KEY}/meta.json`, JSON.stringify(value))
    const before = new Map(fs.files)
    await expect(store.get(CACHE_KEY)).rejects.toThrow()
    expect(fs.files).toEqual(before)
  })

  it('validates artifact files against their payload before any filesystem write', async () => {
    const fs = memoryFiles()
    await expect(
      new ParsedArtifactStore('/root', fs.deps).put(CACHE_KEY, {
        ...ARTIFACT,
        meta: { ...ARTIFACT.meta, files: ['full.md'] },
      }),
    ).rejects.toThrow(/file list/)
    expect(fs.deps.mkdir).not.toHaveBeenCalled()
    expect(fs.deps.writeFile).not.toHaveBeenCalled()
  })
})

const invalidRecord: ReadonlyArray<{ name: string; value: unknown }> = [
  { name: 'v1 record', value: { ...SOURCE_RECORD, version: 1 } },
  { name: 'unknown record field', value: { ...SOURCE_RECORD, mode: 'free' } },
  { name: 'wrong cache key', value: { ...SOURCE_RECORD, cacheKey: '../cache' } },
  { name: 'short fingerprint', value: { ...SOURCE_RECORD, fingerprint: 'abc' } },
  { name: 'non-UUID generation', value: { ...SOURCE_RECORD, generation: 'old' } },
  { name: 'wrong parser', value: { ...SOURCE_RECORD, parser: 'other' } },
  { name: 'wrong format', value: { ...SOURCE_RECORD, format: 'text' } },
  { name: 'unknown stamp', value: { ...SOURCE_RECORD, stamp: { kind: 'other' } } },
  {
    name: 'extra stamp field',
    value: { ...SOURCE_RECORD, stamp: { kind: 'file', size: 1, mtimeMs: 2, path: '/private.pdf' } },
  },
  {
    name: 'negative size',
    value: { ...SOURCE_RECORD, stamp: { kind: 'file', size: -1, mtimeMs: 2 } },
  },
  {
    name: 'fractional size',
    value: { ...SOURCE_RECORD, stamp: { kind: 'file', size: 1.2, mtimeMs: 2 } },
  },
  {
    name: 'negative mtime',
    value: { ...SOURCE_RECORD, stamp: { kind: 'file', size: 1, mtimeMs: -1 } },
  },
  { name: 'missing byte fingerprint', value: { ...SOURCE_RECORD, stamp: { kind: 'bytes' } } },
  {
    name: 'invalid byte fingerprint',
    value: { ...SOURCE_RECORD, stamp: { kind: 'bytes', fingerprint: 'z'.repeat(64) } },
  },
  {
    name: 'non-HTTP URL',
    value: { ...SOURCE_RECORD, stamp: { kind: 'url', url: 'file:///private.pdf' } },
  },
  {
    name: 'URL credentials',
    value: { ...SOURCE_RECORD, stamp: { kind: 'url', url: 'https://secret@example.org/a' } },
  },
  {
    name: 'URL fragment',
    value: { ...SOURCE_RECORD, stamp: { kind: 'url', url: 'https://example.org/a#fragment' } },
  },
  {
    name: 'negative content length',
    value: {
      ...SOURCE_RECORD,
      stamp: { kind: 'url', url: 'https://example.org/a', contentLength: -1 },
    },
  },
  {
    name: 'empty etag',
    value: { ...SOURCE_RECORD, stamp: { kind: 'url', url: 'https://example.org/a', etag: '' } },
  },
]

describe('strict v2 source snapshot', () => {
  it.each(invalidRecord)('rejects $name without removing stored evidence', async ({ value }) => {
    const fs = memoryFiles()
    await fs.deps.writeFile(
      '/root/sources/index.json',
      JSON.stringify({ version: 2, sources: { [SOURCE_KEY]: value } }),
    )
    const before = new Map(fs.files)
    await expect(
      new ParsedArtifactStore('/root', fs.deps).sourceRecord(SOURCE_KEY),
    ).rejects.toThrow()
    expect(fs.files).toEqual(before)
  })

  it.each([
    { name: 'legacy per-key v1', body: { ...SOURCE_RECORD, version: 1 } },
    { name: 'v1 snapshot', body: { version: 1, sources: {} } },
    { name: 'unknown snapshot field', body: { version: 2, sources: {}, token: 'x' } },
    { name: 'non-hash source key', body: { version: 2, sources: { source: SOURCE_RECORD } } },
    { name: 'null snapshot', body: null },
  ])('rejects $name', async ({ body }) => {
    const fs = memoryFiles()
    await fs.deps.writeFile('/root/sources/index.json', JSON.stringify(body))
    await expect(
      new ParsedArtifactStore('/root', fs.deps).sourceRecord(SOURCE_KEY),
    ).rejects.toThrow()
  })

  it('ignores old per-key files rather than reading or migrating v1', async () => {
    const fs = memoryFiles()
    await fs.deps.writeFile(
      `/root/sources/${SOURCE_KEY}.json`,
      JSON.stringify({ ...SOURCE_RECORD, version: 1 }),
    )
    expect(await new ParsedArtifactStore('/root', fs.deps).sourceRecord(SOURCE_KEY)).toBeUndefined()
    expect(fs.deps.writeFile).toHaveBeenCalledTimes(1)
  })

  it('rejects an oversized byte snapshot before decoding JSON', async () => {
    const fs = memoryFiles()
    fs.files.set('/root/sources/index.json', new Uint8Array(SOURCE_INDEX_MAX_BYTES + 1))
    await expect(
      new ParsedArtifactStore('/root', fs.deps).sourceRecord(SOURCE_KEY),
    ).rejects.toThrow(/too large/)
  })

  it('rejects excessive entries at schema validation even before byte encoding', () => {
    const sources = Object.fromEntries(
      Array.from({ length: SOURCE_INDEX_MAX_ENTRIES + 1 }, (_, index) => [
        index.toString(16).padStart(64, '0'),
        SOURCE_RECORD,
      ]),
    )
    expect(() => sourceIndexSchema.parse({ version: 2, sources })).toThrow(/too many entries/)
  })
})
