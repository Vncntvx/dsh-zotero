/**
 * Extract what the parsed document is made of from a MinerU precise-API result
 * zip: `full.md`, the optional `*_content_list.json`, and the figures under
 * `images/` that `full.md` references.
 *
 * The archive is untrusted input. Entry names are validated before extraction
 * (no `..`, no absolute paths, no backslashes, no directory-escaping names),
 * and every wanted entry's declared uncompressed size is checked against a
 * per-file and total ceiling through fflate's filter, which runs *before* that
 * file is decompressed — so a zip bomb is skipped, not expanded into memory.
 * Figures are kept because a Markdown document that names images it does not
 * carry is broken: only browser-safe raster formats under an `images/`
 * directory are accepted, keyed by basename so the reference in `full.md`
 * resolves. Everything else (`layout.json`, `*_model.json`, anything else) is
 * discarded. Duplicate wanted or image names are rejected rather than silently
 * resolved by "last one wins". Nothing here writes a name from the archive to
 * disk.
 * @module dsh-zotero/enrichment/zip
 */

import { unzipSync, type UnzipFileInfo } from 'fflate'
import {
  ARCHIVE_MAX_IMAGE_BYTES,
  ARCHIVE_MAX_IMAGES,
  ARCHIVE_MAX_IMAGE_TOTAL_BYTES,
} from './archive-limits.js'
import type { ZoteroArtifactImageMediaType } from '../contract.js'
import { ZOTERO_ENRICHMENT_ARCHIVE_INVALID, ZoteroError } from '../errors.js'

/** Ceilings on the archive structure and its decompressed content. */
export const ZIP_MAX_TOTAL_ENTRIES = 4_096
export const ZIP_MAX_WANTED_ENTRIES = 2
export const ZIP_MAX_FILE_BYTES = 32 * 1024 * 1024
export const ZIP_MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
/** Figures keep their place in the document, within bounded count and bytes. */
export const ZIP_MAX_IMAGES = ARCHIVE_MAX_IMAGES
export const ZIP_MAX_IMAGE_BYTES = ARCHIVE_MAX_IMAGE_BYTES
export const ZIP_MAX_IMAGE_TOTAL_BYTES = ARCHIVE_MAX_IMAGE_TOTAL_BYTES

/** The raster formats a browser draws without running anything. */
const IMAGE_MEDIA_TYPES: Readonly<Record<string, ZoteroArtifactImageMediaType>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
}

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

/** One figure kept beside the Markdown, addressed as `full.md` names it. */
export interface ExtractedImage {
  /** `images/<file>`, the reference the Markdown carries. */
  readonly name: string
  readonly mediaType: ZoteroArtifactImageMediaType
  readonly data: Uint8Array
}

/** The extracted payloads. */
export interface ExtractedParsedFiles {
  readonly markdown: string
  readonly contentList?: string
  readonly images: readonly ExtractedImage[]
}

/**
 * The canonical name of one figure entry, or undefined when the entry is not a
 * figure this reader serves. Only an `images/` directory's raster files count;
 * the basename is what `full.md` references, so a nested archive path and a
 * flat one resolve to the same figure.
 */
function imageOf(
  name: string,
): { name: string; mediaType: ZoteroArtifactImageMediaType } | undefined {
  const segments = name.split('/')
  if (segments.length < 2 || segments[segments.length - 2] !== 'images') return undefined
  const base = segments[segments.length - 1]!
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/u.test(base)) return undefined
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return undefined
  const mediaType = IMAGE_MEDIA_TYPES[base.slice(dot + 1)]
  if (mediaType === undefined) return undefined
  return { name: `images/${base}`, mediaType }
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
  let imageCount = 0
  let imageBytes = 0
  let unsafe = false
  const seenKinds = new Set<'markdown' | 'contentList'>()
  const seenImages = new Set<string>()
  const selected = new Map<'markdown' | 'contentList', Uint8Array>()
  const images = new Map<string, { mediaType: ZoteroArtifactImageMediaType; data: Uint8Array }>()

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
        const kind = wanted(info.name)
        const image = kind === undefined ? imageOf(info.name) : undefined
        // Anything else — layout.json, model dumps, unknown directories — is
        // skipped before decompression, so a bomb hidden in it never expands.
        if (kind === undefined && image === undefined) return false
        if (kind !== undefined) {
          wantedCount += 1
          if (wantedCount > ZIP_MAX_WANTED_ENTRIES || seenKinds.has(kind)) {
            unsafe = true
            return false
          }
          seenKinds.add(kind)
        } else {
          imageCount += 1
          imageBytes += info.originalSize
          if (
            imageCount > ZIP_MAX_IMAGES ||
            imageBytes > ZIP_MAX_IMAGE_TOTAL_BYTES ||
            seenImages.has(image!.name)
          ) {
            unsafe = true
            return false
          }
          seenImages.add(image!.name)
        }
        const ceiling = kind !== undefined ? ZIP_MAX_FILE_BYTES : ZIP_MAX_IMAGE_BYTES
        if (info.originalSize > ceiling || (info.compression !== 0 && info.compression !== 8)) {
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
    if (kind !== undefined) {
      selected.set(kind, data)
      continue
    }
    const image = imageOf(name)
    if (image !== undefined) images.set(image.name, { mediaType: image.mediaType, data })
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
    images: [...images]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([name, image]) => ({ name, mediaType: image.mediaType, data: image.data })),
  }
}
