/** Bounded, two-pass extraction of the Markdown and the figures it actually references. */
import { unzipSync, type UnzipFileInfo } from 'fflate'
import {
  artifactImageMediaType,
  ARCHIVE_MAX_IMAGES,
  ARCHIVE_MAX_IMAGE_BYTES,
  ARCHIVE_MAX_IMAGE_TOTAL_BYTES,
} from '../artifact-images.js'
import type { ZoteroArtifactImageMediaType } from '../contract.js'
import { markdownImageReferences } from './markdown-images.js'

import {
  ZIP_MAX_TOTAL_ENTRIES,
  ZIP_MAX_FILE_BYTES,
  ZIP_MAX_ARCHIVE_BYTES,
} from './archive-limits.js'
export {
  ZIP_MAX_TOTAL_ENTRIES,
  ZIP_MAX_WANTED_ENTRIES,
  ZIP_MAX_FILE_BYTES,
  ZIP_MAX_ARCHIVE_BYTES,
} from './archive-limits.js'
export const ZIP_MAX_IMAGES = ARCHIVE_MAX_IMAGES
export const ZIP_MAX_IMAGE_BYTES = ARCHIVE_MAX_IMAGE_BYTES
export const ZIP_MAX_IMAGE_TOTAL_BYTES = ARCHIVE_MAX_IMAGE_TOTAL_BYTES

export interface ExtractedImage {
  readonly name: string
  readonly mediaType: ZoteroArtifactImageMediaType
  readonly data: Uint8Array
}
declare const normalizedContentList: unique symbol
export type NormalizedContentList = string & { readonly [normalizedContentList]: true }

export interface ExtractedParsedFiles {
  readonly markdown: string
  readonly contentList?: NormalizedContentList
  readonly images: readonly ExtractedImage[]
}

export class ArchiveValidationError extends Error {
  readonly code = 'ZOTERO_ENRICHMENT_ARCHIVE_INVALID'
  constructor(reason: string) {
    super(`MinerU result archive is invalid: ${reason}`)
  }
}
function invalid(reason: string): never {
  throw new ArchiveValidationError(reason)
}
function unsafeName(name: string): boolean {
  return (
    name === '' ||
    name.startsWith('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    name.split('/').some((segment) => segment === '..' || segment === '')
  )
}
function wanted(name: string): 'markdown' | 'contentList' | undefined {
  const base = name.slice(name.lastIndexOf('/') + 1)
  if (base === 'full.md') return 'markdown'
  return base === 'content_list.json' || base.endsWith('_content_list.json')
    ? 'contentList'
    : undefined
}
function imageOf(path: string) {
  const segments = path.split('/')
  if (segments.at(-2) !== 'images') return undefined
  const name = `images/${segments.at(-1)!}`
  const mediaType = artifactImageMediaType(name)
  return mediaType === undefined ? undefined : { name, mediaType }
}

export function extractParsedFiles(bytes: Uint8Array): ExtractedParsedFiles {
  if (bytes.byteLength === 0) invalid('the archive is empty')
  if (bytes.byteLength > ZIP_MAX_ARCHIVE_BYTES) invalid('the archive exceeds the size ceiling')
  let entries = 0
  let unsafe = false
  const kinds = new Set<string>()
  const imageEntries = new Map<string, { path: string; size: number }>()
  const texts = new Map<string, Uint8Array>()
  try {
    const archive = unzipSync(bytes, {
      filter: (info: UnzipFileInfo) => {
        const directory = info.name.endsWith('/')
        if (
          ++entries > ZIP_MAX_TOTAL_ENTRIES ||
          unsafeName(directory ? info.name.slice(0, -1) : info.name)
        ) {
          unsafe = true
          return false
        }
        if (directory) return false
        const kind = wanted(info.name)
        const image = imageOf(info.name)
        if (image !== undefined) {
          if (imageEntries.has(image.name) || imageEntries.size >= ZIP_MAX_IMAGES) unsafe = true
          imageEntries.set(image.name, { path: info.name, size: info.originalSize })
        }
        if (kind === undefined) return false
        if (
          kinds.has(kind) ||
          info.originalSize > ZIP_MAX_FILE_BYTES ||
          (info.compression !== 0 && info.compression !== 8)
        ) {
          unsafe = true
          return false
        }
        kinds.add(kind)
        return true
      },
    })
    for (const [path, data] of Object.entries(archive)) {
      if (data.byteLength > ZIP_MAX_FILE_BYTES) invalid('an extracted file is oversized')
      texts.set(wanted(path)!, data)
    }
  } catch (error) {
    invalid(
      `the archive could not be read (${error instanceof Error ? error.message : String(error)})`,
    )
  }
  if (unsafe) invalid('it contains an unsafe, oversized, duplicate, or excessive entry')
  const markdownBytes = texts.get('markdown')
  if (markdownBytes === undefined) invalid('it does not contain full.md')
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let markdown: string
  let contentList: NormalizedContentList | undefined
  let references: readonly string[]
  try {
    markdown = decoder.decode(markdownBytes).trim()
    if (markdown === '') invalid('full.md is empty')
    const list = texts.get('contentList')
    if (list !== undefined) {
      const decoded = decoder.decode(list)
      if (!Array.isArray(JSON.parse(decoded))) invalid('content list must be a JSON array')
      contentList = decoded as NormalizedContentList
    }
    references = markdownImageReferences(markdown)
  } catch (error) {
    if (error instanceof ArchiveValidationError) throw error
    invalid(
      `text or image references are invalid (${error instanceof Error ? error.message : String(error)})`,
    )
  }
  if (references.length > ZIP_MAX_IMAGES) invalid('it references excessive figures')
  const selected = new Set<string>()
  let total = 0
  for (const name of references) {
    const entry = imageEntries.get(name)
    if (entry === undefined) invalid(`a referenced figure is missing: ${name}`)
    if (
      entry.size <= 0 ||
      entry.size > ZIP_MAX_IMAGE_BYTES ||
      (total += entry.size) > ZIP_MAX_IMAGE_TOTAL_BYTES
    )
      invalid('it contains an oversized or excessive figure')
    selected.add(entry.path)
  }
  const images: ExtractedImage[] = []
  try {
    const archive = unzipSync(bytes, {
      filter: (info) => {
        if (!selected.has(info.name)) return false
        if (info.compression !== 0 && info.compression !== 8)
          invalid('a figure uses an unsupported compression')
        return true
      },
    })
    for (const [path, data] of Object.entries(archive)) {
      const image = imageOf(path)!
      if (
        data.byteLength !== imageEntries.get(image.name)!.size ||
        data.byteLength > ZIP_MAX_IMAGE_BYTES
      )
        invalid('an extracted figure does not match its declared size')
      images.push({ ...image, data: new Uint8Array(data) })
    }
  } catch (error) {
    if (error instanceof ArchiveValidationError) throw error
    invalid('a referenced figure could not be decompressed')
  }
  if (images.length !== references.length) invalid('a referenced figure could not be read')
  return {
    markdown,
    ...(contentList !== undefined ? { contentList } : {}),
    images: images.sort((a, b) => a.name.localeCompare(b.name, 'en')),
  }
}
