/**
 * The precise-API result archive is untrusted input: entry names are validated
 * before extraction, only the two wanted files are decompressed, and an unsafe
 * or oversized archive is refused rather than written anywhere.
 * @module tests/unit/parsing-zip-safety
 */

import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { extractParsedFiles } from '../../src/parsing/zip.ts'
import { ZOTERO_PARSING_ARCHIVE_INVALID } from '../../src/errors.ts'

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
    })
  })

  it('accepts a nested full.md and omits the content list when absent', () => {
    const archive = archiveOf({ 'result/full.md': 'Nested body' })
    expect(extractParsedFiles(archive)).toEqual({ markdown: 'Nested body' })
  })

  it('refuses a name that escapes with ..', () => {
    const archive = archiveOf({ 'full.md': 'ok', '../../etc/passwd': 'evil' })
    expect(() => extractParsedFiles(archive)).toThrow(
      expect.objectContaining({
        code: ZOTERO_PARSING_ARCHIVE_INVALID,
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

  it('accepts a figure-heavy archive with hundreds of discarded image entries', () => {
    const entries: Record<string, Uint8Array> = {
      'full.md': encoder.encode('# Figure heavy'),
      'doc_content_list.json': encoder.encode('[]'),
    }
    for (let index = 0; index < 300; index += 1) {
      entries[`images/page_${index}_image_0.png`] = encoder.encode('png')
    }
    expect(extractParsedFiles(zipSync(entries))).toEqual({
      markdown: '# Figure heavy',
      contentList: '[]',
    })
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
        code: ZOTERO_PARSING_ARCHIVE_INVALID,
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
