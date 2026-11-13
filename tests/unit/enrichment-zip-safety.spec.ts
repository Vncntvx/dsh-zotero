/**
 * The precise-API result archive is untrusted input: entry names are validated
 * before extraction, only the two wanted files are decompressed, and an unsafe
 * or oversized archive is refused rather than written anywhere.
 * @module tests/unit/enrichment-zip-safety
 */

import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { extractParsedFiles } from '../../src/enrichment/zip.ts'
import { ZOTERO_ENRICHMENT_ARCHIVE_INVALID } from '../../src/errors.ts'

const encoder = new TextEncoder()

/** Build a zip from a name → text map. */
function archiveOf(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const [name, text] of Object.entries(files)) entries[name] = encoder.encode(text)
  return zipSync(entries)
}

describe('extractParsedFiles', () => {
  it('extracts full.md and the content list from a well-formed archive', () => {
    const archive = archiveOf({
      'full.md': '# Paper\n\nBody text.',
      'abc_content_list.json': '[{"type":"text"}]',
      'layout.json': '{}',
    })
    expect(extractParsedFiles(archive)).toEqual({
      markdown: '# Paper\n\nBody text.',
      contentList: '[{"type":"text"}]',
      images: [],
    })
  })

  it('accepts a nested full.md and omits the content list when absent', () => {
    const archive = archiveOf({ 'result/full.md': 'Nested body' })
    expect(extractParsedFiles(archive)).toEqual({ markdown: 'Nested body', images: [] })
  })

  it('refuses a name that escapes with ..', () => {
    const archive = archiveOf({ 'full.md': 'ok', '../../etc/passwd': 'evil' })
    expect(() => extractParsedFiles(archive)).toThrow(
      expect.objectContaining({
        code: ZOTERO_ENRICHMENT_ARCHIVE_INVALID,
        message: expect.stringContaining('unsafe'),
      }),
    )
  })

  it('refuses an absolute name', () => {
    const archive = archiveOf({ 'full.md': 'ok', '/etc/shadow': 'evil' })
    expect(() => extractParsedFiles(archive)).toThrow(/invalid/)
  })

  it('refuses a backslash-separated name', () => {
    const archive = archiveOf({ 'full.md': 'ok', 'dir\\file.txt': 'evil' })
    expect(() => extractParsedFiles(archive)).toThrow(/invalid/)
  })

  it("keeps a figure-heavy archive's images beside the Markdown", () => {
    const entries: Record<string, Uint8Array> = {
      'full.md': encoder.encode(
        '# Figure heavy\n\n' +
          Array.from({ length: 300 }, (_, i) => `![](images/page_${i}_image_0.png)`).join('\n\n'),
      ),
      'doc_content_list.json': encoder.encode('[]'),
    }
    for (let index = 0; index < 300; index += 1) {
      entries[`images/page_${index}_image_0.png`] = encoder.encode(`png-${index}`)
    }
    const extracted = extractParsedFiles(zipSync(entries))
    expect(extracted.images).toHaveLength(300)
    expect(extracted.images[0]).toMatchObject({
      name: 'images/page_0_image_0.png',
      mediaType: 'image/png',
    })
    // The bytes are the archive's, not a placeholder.
    const late = extracted.images.find((image) => image.name === 'images/page_299_image_0.png')
    expect(new TextDecoder().decode(late!.data)).toBe('png-299')
  })

  it('canonicalizes a nested images directory to the reference full.md carries', () => {
    const archive = zipSync({
      'result/full.md': encoder.encode('# Nested\n\n![](images/figure.jpg)'),
      'result/images/figure.jpg': encoder.encode('jpeg-bytes'),
    })
    expect(extractParsedFiles(archive).images).toEqual([
      { name: 'images/figure.jpg', mediaType: 'image/jpeg', data: encoder.encode('jpeg-bytes') },
    ])
  })

  it('drops figure entries a browser would not draw', () => {
    const archive = zipSync({
      'full.md': encoder.encode('# Shapes'),
      'images/diagram.svg': encoder.encode('<svg/>'),
      'images/notes.txt': encoder.encode('text'),
      'assets/other.png': encoder.encode('png'),
    })
    expect(extractParsedFiles(archive).images).toEqual([])
  })

  it('refuses two figures sharing one canonical name', () => {
    const archive = zipSync({
      'full.md': encoder.encode('# Duplicate'),
      'a/images/figure.png': encoder.encode('one'),
      'b/images/figure.png': encoder.encode('two'),
    })
    expect(() => extractParsedFiles(archive)).toThrow(/unsafe|duplicate/)
  })

  it('refuses a figure over the per-image ceiling', () => {
    const huge = new Uint8Array(9 * 1024 * 1024)
    expect(() =>
      extractParsedFiles(
        zipSync(
          { 'full.md': encoder.encode('# Big\n\n![](images/huge.png)'), 'images/huge.png': huge },
          { level: 0 },
        ),
      ),
    ).toThrow(/unsafe|oversized|excessive/)
  })

  it('refuses an archive with an excessive number of entries', () => {
    const entries: Record<string, Uint8Array> = { 'full.md': encoder.encode('ok') }
    for (let index = 0; index < 5_000; index += 1) {
      entries[`images/f${index}.png`] = encoder.encode('x')
    }
    expect(() => extractParsedFiles(zipSync(entries))).toThrow(/unsafe|excessive/)
  })

  it('refuses duplicate wanted entries instead of letting the last one win', () => {
    const archive = archiveOf({
      'a/full.md': '# first',
      'b/full.md': '# second',
      'doc_content_list.json': '[]',
    })
    expect(() => extractParsedFiles(archive)).toThrow(
      expect.objectContaining({
        code: ZOTERO_ENRICHMENT_ARCHIVE_INVALID,
        message: expect.stringContaining('duplicate'),
      }),
    )
  })

  it('refuses an archive whose wanted file is over the per-file ceiling', () => {
    // A stored (uncompressed) entry whose declared original size exceeds the
    // per-file cap is dropped before decompression and reported.
    const huge = new Uint8Array(33 * 1024 * 1024)
    huge.set(encoder.encode('# big'))
    expect(() => extractParsedFiles(zipSync({ 'full.md': huge }, { level: 0 }))).toThrow(
      /unsafe|excessive/,
    )
  })

  it('refuses an archive without full.md', () => {
    expect(() => extractParsedFiles(archiveOf({ 'other.md': 'x' }))).toThrow(
      /does not contain full\.md/,
    )
  })

  it('refuses an empty full.md', () => {
    expect(() => extractParsedFiles(archiveOf({ 'full.md': '   ' }))).toThrow(/full\.md is empty/)
  })

  it('refuses an empty archive', () => {
    expect(() => extractParsedFiles(new Uint8Array())).toThrow(/empty/)
  })

  it('refuses bytes that are not a zip', () => {
    expect(() => extractParsedFiles(encoder.encode('definitely not a zip'))).toThrow(
      /could not be read/,
    )
  })
})
