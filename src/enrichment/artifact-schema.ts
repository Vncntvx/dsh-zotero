/** Closed v2 persistence contracts; no older artifact or index format is read. */
import { z } from 'zod'
import { ARTIFACT_IMAGE_NAME_PATTERN } from '../artifact-images.js'
import { canonicalSourceIdentityOf } from './identity.js'
import type { FulltextSourceStamp, ParsedArtifactMeta } from './types.js'
import {
  ARCHIVE_MAX_IMAGE_BYTES,
  ARCHIVE_MAX_IMAGES,
  ARCHIVE_MAX_IMAGE_TOTAL_BYTES,
} from './archive-limits.js'

export const SHA256 = z.string().regex(/^[0-9a-f]{64}$/)
export const PARSE_GENERATION = z.uuid()
export const SOURCE_INDEX_MAX_BYTES = 16 * 1024 * 1024
export const SOURCE_INDEX_MAX_ENTRIES = 50_000

const sourceUrl = z
  .string()
  .max(16_384)
  .refine((value) => {
    try {
      return !value.startsWith('zotero://') && canonicalSourceIdentityOf(value) === value
    } catch {
      return false
    }
  })
const safeDisplay = z
  .string()
  .max(1024)
  .refine((value) => {
    try {
      if (value.startsWith('zotero://')) return canonicalSourceIdentityOf(value) === value
      const url = new URL(value)
      return (url.protocol === 'http:' || url.protocol === 'https:') && value === `${url.origin}/…`
    } catch {
      return false
    }
  })

const sourceValidator = z
  .string()
  .min(1)
  .max(8192)
  .refine((value) => value.trim() === value)

export const sourceStampSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('file'),
      size: z.number().int().nonnegative(),
      mtimeMs: z.number().finite().nonnegative(),
    })
    .strict(),
  z.object({ kind: z.literal('bytes'), fingerprint: SHA256 }).strict(),
  z
    .object({
      kind: z.literal('url'),
      url: sourceUrl,
      etag: sourceValidator.optional(),
      lastModified: sourceValidator.optional(),
      contentLength: z.number().int().nonnegative().optional(),
    })
    .strict(),
]) satisfies z.ZodType<FulltextSourceStamp>

const parsedImageMetaSchema = z
  .object({
    name: z.string().regex(ARTIFACT_IMAGE_NAME_PATTERN),
    mediaType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']),
    bytes: z.number().int().positive().max(ARCHIVE_MAX_IMAGE_BYTES),
  })
  .strict()

export const artifactMetaSchema = z
  .object({
    version: z.literal(2),
    characterCount: z
      .number()
      .int()
      .nonnegative()
      .max(64 * 1024 * 1024),
    markdownBytes: z
      .number()
      .int()
      .positive()
      .max(64 * 1024 * 1024),
    parser: z.literal('mineru'),
    format: z.literal('markdown'),
    sourceId: SHA256,
    generation: PARSE_GENERATION,
    identity: safeDisplay,
    mode: z.enum(['free', 'pro']),
    contentFingerprint: SHA256,
    taskId: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/),
    files: z.union([
      z.tuple([z.literal('full.md')]),
      z.tuple([z.literal('full.md'), z.literal('content_list.json')]),
    ]),
    images: z
      .array(parsedImageMetaSchema)
      .max(ARCHIVE_MAX_IMAGES)
      .refine(
        (images) =>
          new Set(images.map((image) => image.name)).size === images.length &&
          images.reduce((sum, image) => sum + image.bytes, 0) <= ARCHIVE_MAX_IMAGE_TOTAL_BYTES,
      )
      .optional(),
    pageCount: z.number().int().positive().optional(),
  })
  .strict() satisfies z.ZodType<ParsedArtifactMeta>

export const sourceRecordSchema = z
  .object({
    version: z.literal(2),
    cacheKey: SHA256,
    fingerprint: SHA256,
    generation: PARSE_GENERATION,
    parser: z.literal('mineru'),
    format: z.literal('markdown'),
    stamp: sourceStampSchema,
  })
  .strict()
export type SourceIndexRecord = z.infer<typeof sourceRecordSchema>

export const sourceIndexSchema = z
  .object({
    version: z.literal(2),
    sources: z
      .record(SHA256, sourceRecordSchema)
      .refine(
        (records) => Object.keys(records).length <= SOURCE_INDEX_MAX_ENTRIES,
        'The parsed source index has too many entries',
      ),
  })
  .strict()
