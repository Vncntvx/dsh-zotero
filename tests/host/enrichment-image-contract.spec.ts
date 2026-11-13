/** Extraction output crosses persistence and wire with one canonical image vocabulary. */
import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { artifactImageName } from '../../src/artifact-images.ts'
import { extractParsedFiles } from '../../src/enrichment/zip.ts'
import { markdownImageReferences } from '../../src/enrichment/markdown-images.ts'
import { ParsedArtifactStore } from '../../src/enrichment/artifact-store.ts'
import { zoteroDocumentArtifactRequestSchema } from '../../src/wire-schemas.ts'
import { ARTIFACT, CACHE_KEY } from './support/enrichment-artifacts.ts'
import { memoryFiles } from './support/enrichment-parse-domain.ts'

const encoder = new TextEncoder()

describe('canonical artifact figure names', () => {
  it('round-trips the maximum stem across extraction, persistence and image reads', async () => {
    const name = `images/${'a'.repeat(111)}.png`
    const bytes = new Uint8Array([137, 80, 78, 71])
    const extracted = extractParsedFiles(
      zipSync({ 'full.md': encoder.encode(`![figure](${name})`), [name]: bytes }),
    )
    const store = new ParsedArtifactStore('/root', memoryFiles().deps)
    await store.put(CACHE_KEY, {
      ...ARTIFACT,
      markdown: extracted.markdown,
      images: extracted.images,
      meta: {
        ...ARTIFACT.meta,
        images: extracted.images.map((image) => ({
          name: image.name,
          mediaType: image.mediaType,
          bytes: image.data.byteLength,
        })),
      },
    })
    expect(
      zoteroDocumentArtifactRequestSchema.safeParse({
        sessionId: 's',
        op: 'image',
        lease: '11111111-1111-4111-8111-111111111111',
        name,
      }).success,
    ).toBe(true)
    expect(await store.readImage(CACHE_KEY, name)).toEqual({ data: bytes, mediaType: 'image/png' })
  })

  it('rejects an over-limit referenced name before persistence', () => {
    const name = `images/${'a'.repeat(112)}.png`
    expect(artifactImageName(name)).toBeUndefined()
    expect(() =>
      extractParsedFiles(
        zipSync({ 'full.md': encoder.encode(`![](${name})`), [name]: new Uint8Array([1]) }),
      ),
    ).toThrow(/invalid/)
    expect(
      zoteroDocumentArtifactRequestSchema.safeParse({
        sessionId: 's',
        op: 'image',
        lease: '11111111-1111-4111-8111-111111111111',
        name,
      }).success,
    ).toBe(false)
  })

  it('resolves reference-style images and ignores inline and fenced code', () => {
    expect(
      markdownImageReferences(
        '![figure][ref]\n\n[ref]: ./images/figure.png\n\n`![](images/fake.png)`\n\n```md\n![](images/code.png)\n```',
      ),
    ).toEqual(['images/figure.png'])
    expect(
      markdownImageReferences(
        '![figure][REF]\n\n[ref]: images/first.png\n\n[REF]: images/second.png',
      ),
    ).toEqual(['images/first.png'])
  })

  it('reports a missing referenced figure but never expands an unreferenced image', () => {
    expect(() =>
      extractParsedFiles(zipSync({ 'full.md': encoder.encode('![](images/missing.png)') })),
    ).toThrow(/missing/)
    const result = extractParsedFiles(
      zipSync({
        'full.md': encoder.encode('# No figures'),
        'images/unreferenced.png': new Uint8Array(9 * 1024 * 1024),
      }),
    )
    expect(result.images).toEqual([])
  })
})
