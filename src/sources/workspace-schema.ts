/** Strict source workspace schemas shared by Remote boundaries. */

import { z } from 'zod'
import type { FulltextRead } from './model.js'

function lazySchema<S extends z.ZodType>(factory: () => S): z.ZodLazy<S> {
  let schema: S | undefined
  return z.lazy(() => (schema ??= factory()))
}

const supportedLibrarySchema = lazySchema(() =>
  z.union([
    z.object({ type: z.literal('user'), id: z.literal(0) }).strict(),
    z.object({ type: z.literal('group'), id: z.number().int().positive() }).strict(),
  ]),
)

const operationFactsSchema = lazySchema(() =>
  z
    .object({
      running: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      stopped: z.number().int().nonnegative(),
    })
    .strict(),
)

const sourceScopeSchema = lazySchema(() =>
  z.union([
    z.object({ kind: z.literal('library'), library: supportedLibrarySchema.optional() }).strict(),
    z
      .object({ kind: z.literal('publications'), library: supportedLibrarySchema.optional() })
      .strict(),
    z
      .object({
        kind: z.literal('collection'),
        ref: z.string().optional(),
        name: z.string().optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('savedSearch'),
        ref: z.string().optional(),
        name: z.string().optional(),
      })
      .strict(),
  ]),
)

const searchOccurrenceSchema = lazySchema(() =>
  z
    .object({
      callId: z.string().min(1),
      query: z.string().optional(),
      mode: z.enum(['metadata', 'everything']),
      itemLevel: z.enum(['top', 'all']),
      scope: sourceScopeSchema,
      library: supportedLibrarySchema.optional(),
      itemTypes: z.array(z.string()),
      tags: z.array(z.string()),
      tagMatch: z.enum(['all', 'any']).optional(),
      excludeTags: z.array(z.string()),
      returned: z.number().int().nonnegative(),
      total: z.number().int().nonnegative().optional(),
      noteMatches: z.number().int().nonnegative().optional(),
    })
    .strict(),
)

const artifactProvenanceSchema = lazySchema(() =>
  z
    .object({
      parser: z.literal('mineru'),
      mode: z.enum(['free', 'pro']),
      artifactId: z.string().min(1),
      fingerprint: z.string().min(1),
      sourceId: z.string().min(1),
      generation: z.string().min(1),
    })
    .strict(),
)

const evidencePassageSchema = lazySchema(() =>
  z
    .object({
      source: z.string(),
      sourceRef: z.string(),
      text: z.string(),
      previewTruncated: z.boolean(),
      textFormat: z.enum(['markdown', 'text']).optional(),
      artifact: artifactProvenanceSchema.optional(),
      start: z.number().int().nonnegative().optional(),
      end: z.number().int().nonnegative().optional(),
      pageLabel: z.string().optional(),
      attachmentRef: z.string().optional(),
      matchKind: z.enum(['lexical', 'semantic', 'hybrid']).optional(),
      matchedFields: z.array(z.enum(['text', 'comment'])).optional(),
      callIds: z.array(z.string()),
    })
    .strict()
    .refine(
      (value) =>
        (value.start === undefined && value.end === undefined) ||
        (value.start !== undefined && value.end !== undefined && value.end >= value.start),
      { message: 'Fulltext offsets must include both start and end' },
    )
    .refine(
      (value) =>
        value.source === 'fulltext' ||
        (value.textFormat === undefined &&
          value.artifact === undefined &&
          value.start === undefined &&
          value.end === undefined),
      { message: 'Only fulltext evidence carries artifact and offset facts' },
    )
    .refine((value) => value.artifact === undefined || value.textFormat === 'markdown', {
      message: 'An artifact identifies Markdown fulltext',
    }),
)

const coverageSchema = lazySchema(() =>
  z
    .object({
      indexedPages: z.number().int().nonnegative().optional(),
      totalPages: z.number().int().nonnegative().optional(),
      indexedChars: z.number().int().nonnegative().optional(),
      totalChars: z.number().int().nonnegative().optional(),
      complete: z.boolean(),
    })
    .strict(),
)

const fulltextReadSchema = lazySchema(() =>
  z
    .object({
      sourceKind: z.enum(['attachment', 'url']),
      sourceLabel: z.string(),
      item: z
        .object({
          ref: z.string().min(1),
          title: z.string(),
          creatorSummary: z.string(),
          year: z.number().optional(),
          venue: z.string().optional(),
        })
        .strict()
        .optional(),
      attachmentContentType: z.string().optional(),
      textFormat: z.enum(['markdown', 'text']),
      artifact: artifactProvenanceSchema.optional(),
      coverage: coverageSchema.optional(),
      totalChars: z.number().int().nonnegative(),
      inputTruncated: z.boolean(),
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
      isTruncated: z.boolean(),
      spillAvailable: z.boolean(),
      attachmentRef: z.string().optional(),
      callIds: z.array(z.string()),
    })
    .strict()
    .refine((value) => value.end >= value.start, {
      message: 'A fulltext window end must be at or after its start',
    })
    .refine((value) => value.artifact === undefined || value.textFormat === 'markdown', {
      message: 'An artifact identifies Markdown fulltext',
    }),
)

/**
 * Compile-time tie between the trail model and this wire schema. A field the
 * model produces and the schema omits makes every row carrying it unparseable
 * at the projection boundary, so the omission is a type error here instead of
 * a runtime rejection later. Removing the field from the schema, or adding one
 * to {@link FulltextRead} without adding it above, flips this to `false`.
 */
export const FULLTEXT_READ_SCHEMA_MATCHES_MODEL: Exclude<
  keyof FulltextRead,
  keyof z.infer<typeof fulltextReadSchema>
> extends never
  ? true
  : false = true

const exportDocumentItemSchema = lazySchema(() => {
  const fields = {
    ref: z.string(),
    exportKey: z.string().optional(),
    citationKey: z.string().optional(),
    citationKeySource: z.enum(['native', 'extra']).optional(),
    citationKeyConflict: z.object({ native: z.string(), extra: z.string() }).strict().optional(),
    title: z.string().optional(),
    entryIndex: z.number().int().nonnegative().optional(),
  }
  return z.union([
    z.object(fields).strict(),
    z
      .object({
        ...fields,
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
      })
      .strict()
      .refine((span) => span.end > span.start, {
        message: 'Export text locations require a nonempty ordered span.',
      }),
  ])
})

const exportArtifactSchema = lazySchema(() =>
  z
    .object({
      resultFile: z
        .object({ seq: z.number().int().nonnegative(), index: z.number().int().nonnegative() })
        .strict()
        .optional(),
      callId: z.string().min(1),
      format: z.string(),
      style: z.string().optional(),
      locale: z.string().optional(),
      refs: z.array(z.string()),
      refsOmitted: z.number().int().nonnegative(),
      settledAt: z.number().optional(),
      items: z.array(exportDocumentItemSchema).optional(),
      text: z.string(),
    })
    .strict(),
)

const availabilitySchema = lazySchema(() =>
  z
    .object({
      requested: z.boolean(),
      returnedPassages: z.number().int().nonnegative(),
      unavailable: z.boolean(),
    })
    .strict(),
)

const retrievalFactsSchema = lazySchema(() =>
  z
    .object({
      attachmentRef: z.string().optional(),
      attachmentContentType: z.string().optional(),
      coverage: coverageSchema.optional(),
      truncated: z.boolean(),
      sourceAvailability: z.record(z.string(), availabilitySchema),
    })
    .strict(),
)

const retrievalSummarySchema = lazySchema(() =>
  z
    .object({
      runCount: z.number().int().nonnegative(),
      truncated: z.boolean(),
    })
    .strict(),
)

const attachmentSchema = lazySchema(() =>
  z
    .object({
      ref: z.string().optional(),
      kind: z.enum(['file', 'url']),
      contentType: z.string(),
      title: z.string(),
      location: z.string(),
    })
    .strict(),
)

const attachmentHintSchema = lazySchema(() =>
  z
    .object({
      ref: z.string().optional(),
      contentType: z.string().optional(),
    })
    .strict(),
)

export const sourceItemSchema = lazySchema(() =>
  z
    .object({
      key: z.string().min(1),
      ref: z.string(),
      serverIds: z.array(z.string()),
      evidenceMatch: z.enum(['verified', 'unknown', 'mismatch']),
      title: z.string().optional(),
      creators: z.string().optional(),
      year: z.number().optional(),
      venue: z.string().optional(),
      facts: z.object({ reportedEvidenceCount: z.number().int().nonnegative() }).strict(),
      operations: operationFactsSchema,
      searches: z.array(searchOccurrenceSchema),
      searchesTotal: z.number().int().nonnegative(),
      evidence: z.array(evidencePassageSchema),
      evidenceTotal: z.number().int().nonnegative(),
      fulltextReads: z.array(fulltextReadSchema),
      fulltextReadsTotal: z.number().int().nonnegative(),
      bestAttachment: attachmentHintSchema.optional(),
      readAttachment: attachmentHintSchema.optional(),
      attachment: attachmentSchema.optional(),
      retrievalFacts: retrievalFactsSchema.optional(),
      retrievalSummary: retrievalSummarySchema.optional(),
      exports: z.array(exportArtifactSchema),
      exportsTotal: z.number().int().nonnegative(),
      firstSeenAt: z.number(),
      lastTouchedAt: z.number(),
    })
    .strict(),
)

export const sourceWorkspaceSchema = lazySchema(() =>
  z
    .object({
      detailsDeferred: z.literal(true).optional(),
      detailsRevision: z.number().int().nonnegative().optional(),
      sources: z.array(sourceItemSchema),
      sourceTotal: z.number().int().nonnegative(),
      exports: z.array(exportArtifactSchema),
      exportTotal: z.number().int().nonnegative(),
      exportOperations: operationFactsSchema,
      searchOperations: operationFactsSchema,
      omittedRows: z.number().int().nonnegative(),
      filterCounts: z
        .object({
          all: z.number().int().nonnegative(),
          pdf: z.number().int().nonnegative(),
          retrieved: z.number().int().nonnegative(),
          evidence: z.number().int().nonnegative(),
          exported: z.number().int().nonnegative(),
          issues: z.number().int().nonnegative(),
        })
        .strict(),
      evidencePassageTotal: z.number().int().nonnegative(),
      exportedRefCount: z.number().int().nonnegative(),
    })
    .strict(),
)
