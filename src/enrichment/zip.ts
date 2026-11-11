/**
 * Extract the two files the reader needs from a MinerU precise-API result zip.
 *
 * The archive is untrusted input. Entry names are validated before extraction
 * (no `..`, no absolute paths, no backslashes, no directory-escaping names),
 * and every wanted entry's declared uncompressed size is checked against a
 * per-file and total ceiling through fflate's filter, which runs *before* that
 * file is decompressed — so a zip bomb is skipped, not expanded into memory.
 * Only `full.md` and `*_content_list.json` are ever extracted; everything else
 * is discarded, including the `images/` entries a normal MinerU result carries.
 * The total-entry cap bounds the central-directory walk, not the wanted set, so
 * a figure-heavy document with hundreds of images still has exactly two wanted
 * entries. Duplicate wanted entries are rejected rather than silently resolved
 * by "last one wins". Nothing here writes a name from the archive to disk.
 * @module dsh-zotero/enrichment/zip
 */

import { unzipSync, type UnzipFileInfo } from 'fflate'
import { ZOTERO_ENRICHMENT_ARCHIVE_INVALID, ZoteroError } from '../errors.js'

/** Ceilings on the archive structure and its decompressed content. */
export const ZIP_MAX_TOTAL_ENTRIES = 4_096
export const ZIP_MAX_WANTED_ENTRIES = 2
export const ZIP_MAX_FILE_BYTES = 32 * 1024 * 1024
export const ZIP_MAX_ARCHIVE_BYTES = 256 * 1024 * 1024

/** A name that could escape the intended flat file set if written to disk. */
function unsafeName(name: string): boolean {
  if (name === '' || name.startsWith('/') || name.startsWith('\\')) return true
  if (name.includes('\\')) return true
  if (name.includes('\0')) return true
  const segments = name.split('/')
  return segments.some((seg) => seg === '..' || seg === '')
}

/** Whether an entry name is one of the two we keep. */
function wanted(name: string): 'markdown' | 'contentList' | undefined {
  const base = name.slice(name.lastIndexOf('/') + 1)
  if (base === 'full.md') return 'markdown'
  if (base.endsWith('_content_list.json') || base === 'content_list.json') return 'contentList'
  return undefined
}

/** The extracted text payloads. */
export interface ExtractedParsedFiles {
  readonly markdown: string
  readonly contentList?: string
}

function invalid(reason: string): never {
  throw new ZoteroError(
    `MinerU result archive is invalid: ${reason}`,
    ZOTERO_ENRICHMENT_ARCHIVE_INVALID,
  )
}

/**
 * Validate and unpack a precise-API result zip.
 * @param bytes - the downloaded zip.
 * @returns the Markdown body and, when present, the content-list JSON text.
 * @throws {ZoteroError} `ZOTERO_ENRICHMENT_ARCHIVE_INVALID` on any structural or
 *   safety violation.
 */
export function extractParsedFiles(bytes: Uint8Array): ExtractedParsedFiles {
  if (bytes.byteLength === 0) invalid('the archive is empty')
  if (bytes.byteLength > ZIP_MAX_ARCHIVE_BYTES) invalid('the archive exceeds the size ceiling')

  let entries = 0
  let wantedCount = 0
  let unsafe = false
  const seenKinds = new Set<'markdown' | 'contentList'>()
  const selected = new Map<'markdown' | 'contentList', Uint8Array>()

  let archive: ReturnType<typeof unzipSync>
  try {
    archive = unzipSync(bytes, {
      filter: (info: UnzipFileInfo): boolean => {
        entries += 1
        const directory = info.name.endsWith('/')
        if (
          entries > ZIP_MAX_TOTAL_ENTRIES ||
          unsafeName(directory ? info.name.slice(0, -1) : info.name)
        ) {
          unsafe = true
          return false
        }
        if (directory) return false
        // Only the two wanted files are decompressed; a bomb hidden in any
        // other entry is skipped entirely and never expanded into memory.
        const kind = wanted(info.name)
        if (kind === undefined) return false
        wantedCount += 1
        if (wantedCount > ZIP_MAX_WANTED_ENTRIES || seenKinds.has(kind)) {
          unsafe = true
          return false
        }
        seenKinds.add(kind)
        if (
          info.originalSize > ZIP_MAX_FILE_BYTES ||
          (info.compression !== 0 && info.compression !== 8)
        ) {
          unsafe = true
          return false
        }
        return true
      },
    })
  } catch (error) {
    invalid(`the archive could not be read (${(error as Error).message})`)
  }

  if (unsafe) invalid('it contains an unsafe, oversized, duplicate, or excessive entry')
  for (const [name, data] of Object.entries(archive)) {
    const kind = wanted(name)
    if (kind !== undefined) selected.set(kind, data)
  }
  const markdownBytes = selected.get('markdown')
  if (markdownBytes === undefined) invalid('it does not contain full.md')

  const decoder = new TextDecoder('utf-8', { fatal: true })
  let markdown: string
  let contentList: string | undefined
  try {
    markdown = decoder.decode(markdownBytes).trim()
    const contentListBytes = selected.get('contentList')
    if (contentListBytes !== undefined) {
      contentList = decoder.decode(contentListBytes)
      if (!Array.isArray(JSON.parse(contentList))) invalid('content list must be a JSON array')
    }
  } catch (error) {
    if (error instanceof ZoteroError) throw error
    invalid('text is not valid UTF-8 or the content list is not valid JSON')
  }
  if (markdown === '') invalid('full.md is empty')
  return {
    markdown,
    ...(contentList !== undefined ? { contentList } : {}),
  }
}
