/**
 * The wire boundary schemas both codec arms materialize. The host registry
 * (`src/status-codec.ts`) parses payloads with them through `create()`, and
 * the browser arm (`src/client/status-codec.ts`) carries the same objects.
 * Neither half imports the other's module.
 *
 * Client-safe: its imports are `zod`, the contract's own types, type-only
 * domain unions from `types.ts` (erased at build), and the runtime constants
 * module (values and type-only imports only), all of which
 * `scripts/client-graph-authority.mjs` allowlists. The sort enum derives from
 * `src/constants.ts`, the export enums derive from the sibling arrays there,
 * and the updatable-field set is pinned to it by
 * `tests/unit/wire-schemas.spec.ts`. The parity specs read both arms and keep
 * a hand-written refusal table per schema.
 * @module dsh-zotero/wire-schemas
 */

import { z } from 'zod'
import type { TypertCodec } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ZoteroChildRowsView,
  ZoteroLibraryExportFormatView,
  ZoteroLibraryExportRequestView,
  ZoteroLibraryExportResultView,
  ZoteroLibrarySortField,
  ZoteroLibraryWriteRequestView,
} from './contract.js'
import type { ZoteroTranslatorExportFormat } from './types.js'
import {
  ZOTERO_CHILD_PAGE_MAX_ROWS,
  ZOTERO_EXPORT_FORMATS,
  ZOTERO_ITEMKEY_BATCH,
  ZOTERO_SORT_FIELDS,
  ZOTERO_TRANSLATOR_EXPORT_FORMATS,
  ZOTERO_YEAR_MAX,
  ZOTERO_YEAR_MIN,
} from './constants.js'

/**
 * The panel's sort fields, derived from the domain's one array so the two
 * cannot drift (`tests/unit/wire-schemas.spec.ts` additionally pins the
 * exact order).
 */
export const zoteroLibrarySortSchema = z.enum(
  ZOTERO_SORT_FIELDS as [ZoteroLibrarySortField, ...ZoteroLibrarySortField[]],
)

/**
 * Wrap a wire schema in the strict codec arm Typert expects. The strict arm is
 * exactly `{ mode, typeSymbol, create }` (plus optional `encode`/`decode` for
 * byte-carrying results, which these pure-JSON views do not need), so no live
 * schema property is carried and `create()` materializes on first use.
 * @param typeSymbol - the boundary type identity the manifest declares.
 * @param schema - the shared wire schema both halves validate through.
 * @returns the strict codec arm.
 */
export function strictCodec(typeSymbol: string, schema: z.ZodType): TypertCodec {
  return { mode: 'strict', typeSymbol, create: () => schema }
}

/** Wire schema: one status view (strict; absent optional facts stay absent). */
export const zoteroStatusSchema = z
  .object({
    providerId: z.string(),
    // Optional on the wire because a service that is not composed dialled
    // nothing; required of every answer that reached a provider, which is what
    // `ZoteroStatus` (the provider's own record) carries.
    endpoint: z.string().optional(),
    connected: z.boolean(),
    apiVersion: z.string().optional(),
    serverId: z.string().optional(),
    schemaVersion: z.string().optional(),
    zoteroVersion: z.string().optional(),
    write: z.object({ enabled: z.boolean(), authorized: z.boolean() }).strict().optional(),
    // Optional on the wire because a connected probe has nothing to diagnose;
    // the host-internal `ZoteroStatus` keeps the total field with the
    // `ZOTERO_DIAGNOSIS_OK` sentinel, which the wire producer strips.
    diagnosis: z.string().optional(),
  })
  .strict()
  .readonly()

/** Wire schema: resolveAttachment parameter (a non-empty string ref). */
export const zoteroRefSchema = z.string().min(1)

/** Wire schema: resolveAttachment result. */
export const zoteroAttachmentLocationSchema = z
  .object({
    ref: z.string(),
    kind: z.enum(['file', 'url']),
    title: z.string(),
    contentType: z.string(),
    path: z.string().optional(),
    url: z.string().optional(),
  })
  .strict()
  .readonly()

/** Wire schema: one diagnostics snapshot (strict; the ring pre-strips absent optionals). */
export const zoteroDiagnosticsSchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            seq: z.number(),
            ts: z.number(),
            level: z.enum(['debug', 'info', 'warn', 'error']),
            event: z.string(),
            message: z.string(),
            count: z.number(),
            detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
          })
          .strict()
          .readonly(),
      )
      .readonly(),
    total: z.number(),
    truncated: z.boolean(),
    debug: z.boolean(),
  })
  .strict()
  .readonly()

/** Wire schema: reportClientError parameter (surface + message required, stacks optional). */
export const zoteroClientErrorReportSchema = z
  .object({
    surface: z.string().min(1),
    message: z.string().min(1),
    stack: z.string().optional(),
    componentStack: z.string().optional(),
  })
  .strict()
  .readonly()

/** Wire schema: reportClientError result (the ring sequence the report was assigned). */
export const zoteroReportResultSchema = z.object({ seq: z.number() }).strict().readonly()

// ── Library panel endpoints ────────────────────────────────────────────────

/** Wire schema: the canonical personal library (user/0) on its own. */
export const zoteroPersonalLibrarySchema = z
  .object({ type: z.literal('user'), id: z.literal(0) })
  .strict()
  .readonly()

/** Wire schema: one supported local library (canonical personal or a group). */
export const zoteroLibrarySchema = z.union([
  zoteroPersonalLibrarySchema,
  z
    .object({ type: z.literal('group'), id: z.number().int().positive() })
    .strict()
    .readonly(),
])

/** Wire schema: the resolved scope a search result echoes back. */
export const zoteroResolvedScopeSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('library'), library: zoteroLibrarySchema })
    .strict()
    .readonly(),
  z
    .object({ kind: z.literal('publications'), library: zoteroPersonalLibrarySchema })
    .strict()
    .readonly(),
  z
    .object({ kind: z.literal('collection'), ref: z.string(), name: z.string() })
    .strict()
    .readonly(),
  z
    .object({ kind: z.literal('savedSearch'), ref: z.string(), name: z.string() })
    .strict()
    .readonly(),
  z
    .object({ kind: z.literal('trash'), library: zoteroLibrarySchema })
    .strict()
    .readonly(),
])

/** Wire schema: browse request (one bounded navigation listing). */
export const zoteroLibraryBrowseRequestSchema = z
  .object({
    kind: z.enum(['libraries', 'collections', 'savedSearches', 'tags', 'itemTypes']),
    library: zoteroLibrarySchema.optional(),
    parentRef: z.string().min(1).optional(),
    q: z.string().min(1).optional(),
    match: z.enum(['contains', 'startsWith']).optional(),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
  })
  .strict()
  .readonly()

/** Wire schema: browse result rows, discriminated by `kind` unlike the domain union. */
export const zoteroSavedSearchConditionSchema = z
  .object({
    condition: z.string(),
    operator: z.string(),
    value: z.string(),
  })
  .strict()
  .readonly()

export const zoteroLibraryBrowseItemSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('tag'), tag: z.string() })
    .strict()
    .readonly(),
  z
    .object({ kind: z.literal('itemType'), itemType: z.string(), localized: z.string().optional() })
    .strict()
    .readonly(),
  z
    .object({ kind: z.literal('library'), library: zoteroLibrarySchema, name: z.string() })
    .strict()
    .readonly(),
  z
    .object({
      kind: z.literal('collection'),
      ref: z.string(),
      name: z.string(),
      parentRef: z.string().optional(),
      path: z.array(z.string()).readonly(),
      depth: z.number().int().nonnegative(),
    })
    .strict()
    .readonly(),
  z
    .object({
      kind: z.literal('savedSearch'),
      ref: z.string(),
      name: z.string(),
      conditions: z.array(zoteroSavedSearchConditionSchema).readonly(),
    })
    .strict()
    .readonly(),
])

/** Wire schema: browse result (the requested page of one navigation listing). */
export const zoteroLibraryBrowseResultSchema = z
  .object({
    kind: z.enum(['libraries', 'collections', 'savedSearches', 'tags', 'itemTypes']),
    items: z.array(zoteroLibraryBrowseItemSchema).readonly(),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    nextOffset: z.number().int().nonnegative().optional(),
  })
  .strict()
  .readonly()

/** Wire schema: search request scope (the panel's scope set, including trash). */
export const zoteroLibrarySearchScopeSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('library') })
    .strict()
    .readonly(),
  z
    .object({ kind: z.literal('publications') })
    .strict()
    .readonly(),
  z
    .object({ kind: z.literal('collection'), refOrName: z.string().min(1) })
    .strict()
    .readonly(),
  z
    .object({ kind: z.literal('savedSearch'), refOrName: z.string().min(1) })
    .strict()
    .readonly(),
  z
    .object({ kind: z.literal('trash') })
    .strict()
    .readonly(),
])

/**
 * The library panel's item-list filters: one schema for the wire request and
 * the panel's stored state, so the two cannot drift (a tag spelling the wire
 * refuses must not survive in localStorage either).
 */
export const zoteroLibraryFiltersSchema = z
  .object({
    itemTypes: z.array(z.string().min(1)).readonly().optional(),
    tags: z.array(z.string().min(1)).readonly().optional(),
    tagMatch: z.enum(['all', 'any']).optional(),
    yearFrom: z.number().int().min(ZOTERO_YEAR_MIN).max(ZOTERO_YEAR_MAX).optional(),
    yearTo: z.number().int().min(ZOTERO_YEAR_MIN).max(ZOTERO_YEAR_MAX).optional(),
    hasAttachment: z.boolean().optional(),
  })
  .strict()

/** Wire schema: search request (one item-list page over one scope). */
export const zoteroLibrarySearchRequestSchema = z
  .object({
    scope: zoteroLibrarySearchScopeSchema,
    library: zoteroLibrarySchema.optional(),
    q: z.string().optional(),
    mode: z.enum(['metadata', 'everything']).optional(),
    sort: zoteroLibrarySortSchema,
    direction: z.enum(['asc', 'desc']),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    itemLevel: z.enum(['top', 'all']).optional(),
    ...zoteroLibraryFiltersSchema.shape,
    cacheGeneration: z.number().int().nonnegative().optional(),
  })
  .strict()
  .readonly()

/** Wire schema: one item row of a listing (the domain's compact hit, mirrored). */
export const zoteroSearchItemSchema = z
  .object({
    ref: z.string(),
    title: z.string(),
    creatorSummary: z.string(),
    year: z.number().optional(),
    itemType: z.string(),
    parentRef: z.string().optional(),
    bestAttachmentRef: z.string().optional(),
    bestAttachmentType: z.string().optional(),
    attachmentSize: z.number().optional(),
    extra: z.string().optional(),
    doi: z.string().optional(),
  })
  .strict()
  .readonly()

/** Wire schema: search result (paged primary hits only; no note supplement crosses). */
export const zoteroSearchResultSchema = z
  .object({
    scope: zoteroResolvedScopeSchema,
    items: z.array(zoteroSearchItemSchema).readonly(),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    nextOffset: z.number().int().nonnegative().optional(),
  })
  .strict()
  .readonly()

/** Wire schema: one child listing's page window. */
const childPageSchema = z
  .object({
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive().max(ZOTERO_CHILD_PAGE_MAX_ROWS),
  })
  .strict()
  .readonly()

/** Wire schema: item-detail request (one ref plus the child kinds to include). */
export const zoteroLibraryItemRequestSchema = z
  .object({
    ref: z.string().min(1),
    include: z.array(z.enum(['notes', 'attachments', 'annotations'])).readonly(),
    childPages: z
      .object({
        notes: childPageSchema.optional(),
        attachments: childPageSchema.optional(),
        annotations: childPageSchema.optional(),
      })
      .strict()
      .readonly()
      .optional(),
  })
  .strict()
  .readonly()

/** Wire schema: one child listing the detail view serves. */
export function childRowsSchema<T>(item: z.ZodType<T>): z.ZodType<ZoteroChildRowsView<T>> {
  return z
    .object({
      total: z.number().int().nonnegative(),
      returned: z.number().int().nonnegative(),
      offset: z.number().int().nonnegative(),
      limit: z.number().int().positive(),
      nextOffset: z.number().int().nonnegative().optional(),
      items: z.array(item).readonly(),
    })
    .strict()
    .readonly()
}

export const zoteroNoteRowSchema = z
  .object({
    ref: z.string(),
    text: z.string(),
    truncated: z.boolean(),
    parentRef: z.string().optional(),
  })
  .strict()
  .readonly()

export const zoteroAnnotationRowSchema = z
  .object({
    ref: z.string(),
    type: z.string(),
    text: z.string(),
    comment: z.string().optional(),
    color: z.string().optional(),
    pageLabel: z.string().optional(),
    parentRef: z.string().optional(),
  })
  .strict()
  .readonly()

export const zoteroAttachmentRowSchema = z
  .object({
    ref: z.string(),
    title: z.string(),
    contentType: z.string(),
  })
  .strict()
  .readonly()

/** Wire schema: one paged child-listing request. */
export const zoteroLibraryChildPageRequestSchema = z
  .object({
    ref: z.string().min(1),
    kind: z.enum(['notes', 'attachments', 'annotations']),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive().max(ZOTERO_CHILD_PAGE_MAX_ROWS),
  })
  .strict()
  .readonly()

/** Wire schema: one child page, discriminated by the kind it carries. */
export const zoteroChildPageSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('notes'), page: childRowsSchema(zoteroNoteRowSchema) })
    .strict()
    .readonly(),
  z
    .object({ kind: z.literal('attachments'), page: childRowsSchema(zoteroAttachmentRowSchema) })
    .strict()
    .readonly(),
  z
    .object({ kind: z.literal('annotations'), page: childRowsSchema(zoteroAnnotationRowSchema) })
    .strict()
    .readonly(),
])

/** Wire schema: the item detail view (panel include set applied, absent sets stay absent). */
export const zoteroItemDetailSchema = z
  .object({
    ref: z.string(),
    itemType: z.string(),
    title: z.string(),
    creators: z
      .array(
        z
          .object({
            creatorType: z.string(),
            name: z.string().optional(),
            firstName: z.string().optional(),
            lastName: z.string().optional(),
          })
          .strict()
          .readonly(),
      )
      .readonly(),
    extra: z.string().optional(),
    date: z.string().optional(),
    year: z.number().optional(),
    venue: z.string().optional(),
    doi: z.string().optional(),
    url: z.string().optional(),
    abstract: z.string().optional(),
    abstractTruncated: z.boolean(),
    noteBody: z.object({ text: z.string(), truncated: z.boolean() }).strict().readonly().optional(),
    tags: z.array(z.string()).readonly(),
    collections: z
      .array(z.object({ ref: z.string(), name: z.string().optional() }).strict().readonly())
      .readonly(),
    children: z.object({ total: z.number().int().nonnegative() }).strict().readonly(),
    bestAttachment: zoteroAttachmentRowSchema.optional(),
    notes: childRowsSchema(zoteroNoteRowSchema).optional(),
    annotations: childRowsSchema(zoteroAnnotationRowSchema).optional(),
    attachments: childRowsSchema(zoteroAttachmentRowSchema).optional(),
  })
  .strict()
  .readonly()

/** Wire schema: the export formats, derived from the domain's one ordered array. */
export const zoteroLibraryExportFormatSchema = z.enum(
  ZOTERO_EXPORT_FORMATS as [ZoteroLibraryExportFormatView, ...ZoteroLibraryExportFormatView[]],
)

/** Wire schema: the translator export formats, derived from the sibling array. */
export const zoteroLibraryTranslatorExportFormatSchema = z.enum(
  ZOTERO_TRANSLATOR_EXPORT_FORMATS as [
    ZoteroTranslatorExportFormat,
    ...ZoteroTranslatorExportFormat[],
  ],
)

/**
 * Wire schema: library export request. The refs bound is Zotero's own
 * `itemKey` per-request cap — the configured `maxExportRefs` gate runs in the
 * host service, where the live config is read.
 */
export const zoteroLibraryExportRequestSchema = z
  .object({
    refs: z.array(z.string().min(1)).min(1).max(ZOTERO_ITEMKEY_BATCH).readonly(),
    format: zoteroLibraryExportFormatSchema,
    style: z.string().min(1).optional(),
    locale: z.string().min(1).optional(),
  })
  .strict()
  .readonly() satisfies z.ZodType<ZoteroLibraryExportRequestView>

/**
 * Wire schema: library export result, discriminated by the exported format.
 * The panel endpoint serves rendered text only, so the translator arm carries
 * no per-document itemization.
 */
export const zoteroLibraryExportResultSchema = z
  .discriminatedUnion('format', [
    z
      .object({
        format: z.literal('citation'),
        style: z.string().optional(),
        locale: z.string().optional(),
        citations: z
          .array(z.object({ ref: z.string(), text: z.string() }).strict().readonly())
          .readonly(),
      })
      .strict()
      .readonly(),
    z
      .object({
        format: z.literal('bibliography'),
        style: z.string().optional(),
        locale: z.string().optional(),
        text: z.string(),
      })
      .strict()
      .readonly(),
    z
      .object({
        format: zoteroLibraryTranslatorExportFormatSchema,
        style: z.string().optional(),
        locale: z.string().optional(),
        text: z.string(),
      })
      .strict()
      .readonly(),
  ])
  .readonly() satisfies z.ZodType<ZoteroLibraryExportResultView>

const writeText = z.string().min(1)
const writeList = z.array(writeText)
const writeFields = z
  .object({
    title: writeText.optional(),
    date: writeText.optional(),
    url: writeText.optional(),
    doi: writeText.optional(),
    abstractNote: writeText.optional(),
    publicationTitle: writeText.optional(),
    extra: writeText.optional(),
  })
  .strict()
const writeCreateItem = z
  .object({
    itemType: writeText,
    title: writeText.optional(),
    url: writeText.optional(),
    date: writeText.optional(),
    doi: writeText.optional(),
    abstractNote: writeText.optional(),
    publicationTitle: writeText.optional(),
    tags: writeList.optional(),
    collections: writeList.optional(),
    creators: z
      .array(
        z
          .object({
            creatorType: writeText,
            name: z.string().optional(),
            firstName: z.string().optional(),
            lastName: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict()
const writeBatchUpdate = z
  .object({
    ref: writeText,
    addTags: writeList.optional(),
    removeTags: writeList.optional(),
    addCollections: writeList.optional(),
    removeCollections: writeList.optional(),
  })
  .strict()
const writeConditions = z.array(
  z.object({ condition: writeText, operator: z.string(), value: z.string() }).strict(),
)
const writeBase = { sessionId: writeText }
const writeArm = <N extends string, S extends z.ZodRawShape>(operation: N, shape: S) =>
  z
    .object({ ...writeBase, operation: z.literal(operation), args: z.object(shape).strict() })
    .strict()

/**
 * Closed panel mutation union. Extra or malformed nested fields are rejected
 * at the gateway. `satisfies` pins the schema's output to the hand-written
 * `ZoteroLibraryWriteRequestView`, so drift between the two fails at compile
 * time.
 */
export const zoteroLibraryWriteRequestSchema = z.discriminatedUnion('operation', [
  writeArm('updateItem', { ref: writeText, set: writeFields }),
  writeArm('updateTags', {
    ref: writeText,
    add: writeList.optional(),
    remove: writeList.optional(),
  }),
  writeArm('updateMembership', {
    ref: writeText,
    add: writeList.optional(),
    remove: writeList.optional(),
  }),
  writeArm('createItem', writeCreateItem.shape),
  writeArm('createNote', {
    markdown: writeText,
    parentItem: writeText.optional(),
    collections: writeList.optional(),
    tags: writeList.optional(),
    sourceRefs: writeList.optional(),
  }),
  writeArm('updateNote', { ref: writeText, markdown: writeText }),
  writeArm('createCollection', { name: writeText, parent: writeText.optional() }),
  writeArm('updateCollection', {
    collection: writeText,
    name: writeText.optional(),
    parent: writeText.optional(),
  }),
  writeArm('deleteCollection', { collection: writeText }),
  writeArm('createSavedSearch', { name: writeText, conditions: writeConditions }),
  writeArm('updateSavedSearch', {
    search: writeText,
    name: writeText.optional(),
    conditions: writeConditions.optional(),
  }),
  writeArm('deleteSavedSearch', { search: writeText }),
  writeArm('trash', { refs: writeList }),
  writeArm('restore', { refs: writeList }),
  writeArm('batch', {
    create: z.array(writeCreateItem).optional(),
    update: z.array(writeBatchUpdate).optional(),
    delete: writeList.optional(),
  }),
]) satisfies z.ZodType<ZoteroLibraryWriteRequestView>
export const zoteroLibraryWriteResultSchema = z
  .object({
    kind: z.enum(['applied', 'declined', 'committed-unverified', 'failed']),
    message: z.string(),
    code: z.string().optional(),
  })
  .strict()
  .readonly()
