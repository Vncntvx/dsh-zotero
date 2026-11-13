import {
  zoteroReadUrlPdfInvocation,
  zoteroReleaseUrlPdfInvocation,
  type ZoteroUrlPdfView,
} from './contract.js'
import { refFieldsOf } from './ref-grammar.js'
import { sourceWorkspaceSchema } from './sources/workspace-schema.js'
import { ENRICHMENT_OUTPUT_DIR_PATTERN } from './enrichment-preferences.js'
import { SEMANTIC_DOWNLOAD_SOURCES, SEMANTIC_MODEL_KEYS } from './enrichment-model-catalog.js'
import type {
  ZoteroSourcePageRequestView,
  ZoteroSourcePageResultView,
  ZoteroStartDocumentParseRequestView,
  ZoteroStartDocumentParseResultView,
  ZoteroDocumentArtifactRequestView,
  ZoteroDocumentArtifactResultView,
  ZoteroDocumentParseReceiptRequestView,
  ZoteroDocumentParseReceiptResultView,
  ZoteroParseReceiptView,
} from './contract.js'
import {
  zoteroDocumentParseInvocation,
  ZOTERO_ARTIFACT_IMAGE_BYTES,
  ZOTERO_ARTIFACT_PAGE_CHARS,
  ZOTERO_START_DOCUMENT_PARSE_METHOD,
  ZOTERO_DOCUMENT_ARTIFACT_METHOD,
  ZOTERO_DOCUMENT_PARSE_RECEIPT_METHOD,
} from './contract.js'
import {
  ZOTERO_SOURCE_PAGE_REQUEST_TYPE_SYMBOL,
  ZOTERO_SOURCE_PAGE_RESULT_TYPE_SYMBOL,
  zoteroSourcePageInvocation,
  type ZoteroSemanticModelStatusRequestView,
  type ZoteroSemanticModelStatusResultView,
  type ZoteroSemanticModelDownloadRequestView,
  type ZoteroSemanticModelDownloadResultView,
  type ZoteroSemanticModelCancelRequestView,
  type ZoteroSemanticModelCancelResultView,
  type ZoteroSemanticModelDeleteRequestView,
  type ZoteroSemanticModelDeleteResultView,
  ZOTERO_SEMANTIC_MODEL_STATUS_REQUEST_TYPE_SYMBOL,
  ZOTERO_SEMANTIC_MODEL_STATUS_RESULT_TYPE_SYMBOL,
  ZOTERO_SEMANTIC_MODEL_DOWNLOAD_REQUEST_TYPE_SYMBOL,
  ZOTERO_SEMANTIC_MODEL_DOWNLOAD_RESULT_TYPE_SYMBOL,
  ZOTERO_SEMANTIC_MODEL_CANCEL_REQUEST_TYPE_SYMBOL,
  ZOTERO_SEMANTIC_MODEL_CANCEL_RESULT_TYPE_SYMBOL,
  ZOTERO_SEMANTIC_MODEL_DELETE_REQUEST_TYPE_SYMBOL,
  ZOTERO_SEMANTIC_MODEL_DELETE_RESULT_TYPE_SYMBOL,
  ZOTERO_SEMANTIC_MODEL_VERIFY_REQUEST_TYPE_SYMBOL,
  ZOTERO_SEMANTIC_MODEL_VERIFY_RESULT_TYPE_SYMBOL,
  zoteroSemanticModelStatusInvocation,
  zoteroSemanticModelDownloadInvocation,
  zoteroSemanticModelCancelInvocation,
  zoteroSemanticModelDeleteInvocation,
  zoteroSemanticModelVerifyInvocation,
  type ZoteroSemanticModelVerifyRequestView,
} from './contract.js'
/**
 * The wire boundary's single source: every zod schema the `zotero` namespace
 * validates with, and the one shared invocation list both halves register.
 * `ZOTERO_COMMON_INVOCATIONS` materializes each schema once through
 * `strictCodec()`; the host manifest aliases it in `src/status-codec.ts` and
 * the browser face aliases it in `src/client/status-codec.ts`. Neither half
 * imports the other's module or builds its own descriptor list, so the two
 * sides cannot disagree about a boundary.
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
import type { InvocationDescriptor, TypertCodec } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ZoteroChildRowsView,
  ZoteroLibraryExportFormatView,
  ZoteroLibraryExportRequestView,
  ZoteroLibraryExportResultView,
  ZoteroLibrarySortField,
  ZoteroLibraryWriteRequestView,
} from './contract.js'
import type { ZoteroItemizedExportFormat } from './types.js'
import {
  ZOTERO_CLIENT_ERROR_REPORT_TYPE_SYMBOL,
  ZOTERO_COLLECTION_PATH_REQUEST_TYPE_SYMBOL,
  ZOTERO_COLLECTION_PATH_RESULT_TYPE_SYMBOL,
  ZOTERO_DIAGNOSTICS_TYPE_SYMBOL,
  ZOTERO_LIBRARY_BROWSE_REQUEST_TYPE_SYMBOL,
  ZOTERO_LIBRARY_BROWSE_RESULT_TYPE_SYMBOL,
  ZOTERO_LIBRARY_CHILD_PAGE_REQUEST_TYPE_SYMBOL,
  ZOTERO_LIBRARY_CHILD_PAGE_RESULT_TYPE_SYMBOL,
  ZOTERO_LIBRARY_EXPORT_REQUEST_TYPE_SYMBOL,
  ZOTERO_LIBRARY_EXPORT_RESULT_TYPE_SYMBOL,
  ZOTERO_LIBRARY_ITEM_REQUEST_TYPE_SYMBOL,
  ZOTERO_LIBRARY_ITEM_RESULT_TYPE_SYMBOL,
  ZOTERO_LIBRARY_SEARCH_REQUEST_TYPE_SYMBOL,
  ZOTERO_LIBRARY_SEARCH_RESULT_TYPE_SYMBOL,
  ZOTERO_LIBRARY_WRITE_REQUEST_TYPE_SYMBOL,
  ZOTERO_LIBRARY_WRITE_RESULT_TYPE_SYMBOL,
  ZOTERO_OPEN_PROTOCOL_PARAM_TYPE_SYMBOL,
  ZOTERO_OPEN_PROTOCOL_RESULT_TYPE_SYMBOL,
  ZOTERO_REF_PARAM_TYPE_SYMBOL,
  ZOTERO_REPORT_RESULT_TYPE_SYMBOL,
  ZOTERO_RESOLVE_ATTACHMENT_TYPE_SYMBOL,
  ZOTERO_SOURCE_PROJECTION_FAILED,
  ZOTERO_STATUS_TYPE_SYMBOL,
  ZOTERO_WRITE_GRANT_REVOKE_TYPE_SYMBOL,
  zoteroCollectionPathInvocation,
  zoteroDiagnosticsInvocation,
  zoteroLibraryBrowseInvocation,
  zoteroLibraryChildPageInvocation,
  zoteroLibraryExportInvocation,
  zoteroLibraryItemInvocation,
  zoteroLibrarySearchInvocation,
  zoteroLibraryWriteInvocation,
  zoteroOpenProtocolInvocation,
  zoteroReportClientErrorInvocation,
  zoteroResolveAttachmentInvocation,
  zoteroRevokeWriteGrantInvocation,
  zoteroStatusInvocation,
} from './contract.js'
import {
  ZOTERO_CHILD_PAGE_MAX_ROWS,
  ZOTERO_SOURCE_WORKSPACE_MAX_SOURCES,
  ZOTERO_SOURCE_WORKSPACE_MAX_ITEM_ROWS,
  ZOTERO_EXPORT_FORMATS,
  ZOTERO_ITEMKEY_BATCH,
  ZOTERO_SORT_FIELDS,
  ZOTERO_ITEMIZED_EXPORT_FORMATS,
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
export function strictCodec(
  typeSymbol: string,
  schema: z.ZodType,
): Extract<TypertCodec, { mode: 'strict' }> {
  return { mode: 'strict', typeSymbol, create: () => schema }
}

/** Wire schema: one status view (strict; absent optional facts stay absent). */
export const zoteroStatusSchema = z
  .object({
    providerId: z.string(),
    sourceProjection: z.discriminatedUnion('state', [
      z.object({ state: z.literal('not-composed') }).strict(),
      z.object({ state: z.literal('pending') }).strict(),
      z.object({ state: z.literal('ready') }).strict(),
      z
        .object({
          state: z.literal('failed'),
          code: z.literal(ZOTERO_SOURCE_PROJECTION_FAILED),
        })
        .strict(),
    ]),
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

/** Wire schema: the write-grant revocation result (strict). */
export const zoteroWriteGrantRevokeSchema = z.object({ removed: z.boolean() }).strict()

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

/** Wire schema: openProtocol parameter (a string starting with zotero://). */
export const zoteroProtocolUrlSchema = z.string().startsWith('zotero://')

/** Wire schema: openProtocol result. */
export const zoteroOpenProtocolResultSchema = z
  .object({
    success: z.literal(true),
  })
  .strict()
  .readonly()

export const zoteroSourcePageTargetSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('sources'),
      filter: z.enum(['all', 'pdf', 'retrieved', 'evidence', 'exported', 'issues']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('source'),
      key: z.string().min(1),
      rows: z.enum(['searches', 'evidence', 'exports']),
    })
    .strict(),
  z.object({ kind: z.literal('session'), rows: z.literal('exports') }).strict(),
])

export const zoteroSourcePageRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    target: zoteroSourcePageTargetSchema,
    currentServerId: z.string().min(1).max(128).optional(),
    limit: z.number().int().positive().max(ZOTERO_SOURCE_WORKSPACE_MAX_SOURCES).optional(),
    offset: z.number().int().nonnegative().optional(),
    revision: z.number().int().min(-1).optional(),
  })
  .strict()
  .refine(
    (request) =>
      request.offset === undefined || request.offset === 0 || request.revision !== undefined,
    {
      message: 'A continuation requires its revision.',
    },
  ) satisfies z.ZodType<ZoteroSourcePageRequestView>

export const zoteroSourcePageResultSchema = z
  .object({
    sessionId: z.string().min(1),
    target: zoteroSourcePageTargetSchema,
    revision: z.number().int().min(-1),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive().max(ZOTERO_SOURCE_WORKSPACE_MAX_SOURCES),
    total: z.number().int().nonnegative(),
    workspace: sourceWorkspaceSchema,
  })
  .strict()
  .refine(
    (result) =>
      result.workspace.sources.length <= ZOTERO_SOURCE_WORKSPACE_MAX_SOURCES &&
      result.workspace.exports.length <= ZOTERO_SOURCE_WORKSPACE_MAX_ITEM_ROWS &&
      result.workspace.sources.every(
        (item) =>
          item.searches.length <= ZOTERO_SOURCE_WORKSPACE_MAX_ITEM_ROWS &&
          item.evidence.length <= ZOTERO_SOURCE_WORKSPACE_MAX_ITEM_ROWS &&
          item.exports.length <= ZOTERO_SOURCE_WORKSPACE_MAX_ITEM_ROWS,
      ),
    { message: 'Source pages must remain bounded.' },
  ) satisfies z.ZodType<ZoteroSourcePageResultView>

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

/** Wire schema: one collection row, shared by browse listings and path breadcrumbs. */
export const zoteroCollectionRowSchema = z
  .object({
    kind: z.literal('collection'),
    ref: z.string(),
    name: z.string(),
    parentRef: z.string().optional(),
    path: z.array(z.string()).readonly(),
    depth: z.number().int().nonnegative(),
    childCount: z.number().int().nonnegative().optional(),
    itemCount: z.number().int().nonnegative().optional(),
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
  zoteroCollectionRowSchema,
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
    libraryVersion: z.number().int().nonnegative().optional(),
    kind: z.enum(['libraries', 'collections', 'savedSearches', 'tags', 'itemTypes']),
    items: z.array(zoteroLibraryBrowseItemSchema).readonly(),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    nextOffset: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine(
    (value) =>
      !['collections', 'savedSearches'].includes(value.kind) || value.libraryVersion !== undefined,
    { message: 'Navigation results require a library version.' },
  )
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
export const zoteroLibraryItemizedExportFormatSchema = z.enum(
  ZOTERO_ITEMIZED_EXPORT_FORMATS as [ZoteroItemizedExportFormat, ...ZoteroItemizedExportFormat[]],
)

/**
 * Wire schema: library export request. The refs bound is Zotero's own
 * `itemKey` per-request cap: the configured `maxExportRefs` gate runs in the
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
        format: zoteroLibraryItemizedExportFormatSchema,
        style: z.string().optional(),
        locale: z.string().optional(),
        text: z.string(),
      })
      .strict()
      .readonly(),
    z
      .object({
        format: z.literal('csv'),
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

export const zoteroCollectionPathRequestSchema = z
  .object({
    library: zoteroLibrarySchema,
    ref: z.string().min(1),
    libraryVersion: z.number().int().nonnegative(),
  })
  .strict()
  .readonly()
export const zoteroCollectionPathResultSchema = z
  .object({
    library: zoteroLibrarySchema,
    libraryVersion: z.number().int().nonnegative(),
    path: z.array(zoteroCollectionRowSchema).readonly(),
  })
  .strict()
  .readonly()

export const ZOTERO_STATUS_RESULT_CODEC = strictCodec(ZOTERO_STATUS_TYPE_SYMBOL, zoteroStatusSchema)

export const zoteroReadUrlPdfRequestSchema = z
  .object({
    ref: z.string().refine((ref) => {
      const fields = refFieldsOf(ref)
      return (
        fields?.kind === 'attachment' &&
        fields.serverId !== undefined &&
        (fields.libraryType === 'group' || fields.libraryId === '0')
      )
    }, 'Expected a qualified local attachment ref'),
  })
  .strict()
export const zoteroUrlPdfSchema = z
  .object({
    ref: z.string(),
    title: z.string(),
    contentType: z.literal('application/pdf'),
    path: z.string().min(1),
    lease: z.uuid(),
  })
  .strict() satisfies z.ZodType<ZoteroUrlPdfView>
export const ZOTERO_URL_PDF_CODEC = strictCodec('dsh-zotero#ZoteroUrlPdfView', zoteroUrlPdfSchema)
export const zoteroReleaseUrlPdfSchema = z.object({ lease: z.uuid() }).strict()

// The directory reaches the filesystem, so the wire carries the same shape
// rule the settings schema enforces: absolute, `~/...`, a drive, or a UNC path.
const semanticModelDirSchema = z
  .string()
  .regex(ENRICHMENT_OUTPUT_DIR_PATTERN, 'expected an absolute directory or a ~ path')
const semanticModelEnum = z.enum([...SEMANTIC_MODEL_KEYS] as [string, ...string[]])
const semanticSourceEnum = z.enum([...SEMANTIC_DOWNLOAD_SOURCES] as [string, ...string[]])

export const zoteroSemanticModelStatusRequestSchema = z
  .object({
    model: semanticModelEnum.optional(),
    modelDir: semanticModelDirSchema.optional(),
  })
  .strict() satisfies z.ZodType<ZoteroSemanticModelStatusRequestView>

export const zoteroSemanticModelStatusResultSchema = z
  .object({
    model: z.string(),
    ready: z.boolean(),
    downloading: z.boolean(),
    path: z.string(),
    downloadedBytes: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    percent: z.number().int().min(0).max(100),
    currentFile: z.string().optional(),
    error: z.string().optional(),
    warning: z.string().optional(),
  })
  .strict() satisfies z.ZodType<ZoteroSemanticModelStatusResultView>

export const zoteroSemanticModelDownloadRequestSchema = z
  .object({
    model: semanticModelEnum.optional(),
    source: semanticSourceEnum.optional(),
    modelDir: semanticModelDirSchema.optional(),
    force: z.boolean().optional(),
  })
  .strict() satisfies z.ZodType<ZoteroSemanticModelDownloadRequestView>

export const zoteroSemanticModelDownloadResultSchema = z
  .object({
    success: z.boolean(),
    model: z.string(),
    status: z.union([z.literal('started'), z.literal('already-ready'), z.literal('downloading')]),
    path: z.string(),
  })
  .strict() satisfies z.ZodType<ZoteroSemanticModelDownloadResultView>

export const zoteroSemanticModelCancelRequestSchema = z
  .object({
    model: semanticModelEnum.optional(),
    modelDir: semanticModelDirSchema.optional(),
  })
  .strict() satisfies z.ZodType<ZoteroSemanticModelCancelRequestView>

export const zoteroSemanticModelCancelResultSchema = z
  .object({
    cancelled: z.boolean(),
  })
  .strict() satisfies z.ZodType<ZoteroSemanticModelCancelResultView>

export const zoteroSemanticModelDeleteRequestSchema = z
  .object({
    model: semanticModelEnum.optional(),
    modelDir: semanticModelDirSchema.optional(),
  })
  .strict() satisfies z.ZodType<ZoteroSemanticModelDeleteRequestView>

export const zoteroSemanticModelDeleteResultSchema = z
  .object({
    success: z.boolean(),
    model: z.string(),
    path: z.string(),
    removed: z.boolean(),
    removedFiles: z.number().int().nonnegative(),
    removedBytes: z.number().int().nonnegative(),
  })
  .strict() satisfies z.ZodType<ZoteroSemanticModelDeleteResultView>

export const zoteroSemanticModelVerifyRequestSchema = z
  .object({
    model: semanticModelEnum.optional(),
    modelDir: semanticModelDirSchema.optional(),
  })
  .strict() satisfies z.ZodType<ZoteroSemanticModelVerifyRequestView>

export const zoteroParseTargetSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('attachment'),
      ref: z
        .string()
        .max(1024)
        .refine((value) => {
          const ref = refFieldsOf(value)
          return ref?.kind === 'attachment'
        }, 'expected a Zotero attachment reference'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('url'),
      url: z
        .string()
        .max(8192)
        .url()
        .refine((value) => {
          try {
            const url = new URL(value)
            return (
              (url.protocol === 'https:' || url.protocol === 'http:') &&
              !url.username &&
              !url.password
            )
          } catch {
            return false
          }
        }, 'expected an HTTP(S) URL without credentials'),
    })
    .strict(),
])

export const zoteroStartDocumentParseRequestSchema = z
  .object({
    sessionId: z.string().min(1).max(256),
    operationId: z.uuid(),
    target: zoteroParseTargetSchema,
    action: z.enum(['parse', 'reparse', 'retry']),
  })
  .strict() satisfies z.ZodType<ZoteroStartDocumentParseRequestView>

export const zoteroParseReceiptSchema = z
  .object({
    operationId: z.uuid(),
    generation: z.uuid(),
    sourceId: z.string().regex(/^[a-f0-9]{64}$/),
    targetLabel: z.string().min(1).max(2048),
    mode: z.enum(['free', 'pro']),
    cached: z.boolean(),
    artifactId: z.string().regex(/^[a-f0-9]{64}$/),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    format: z.literal('markdown'),
    characterCount: z.number().int().nonnegative(),
    preview: z.string().max(4096),
    pageCount: z.number().int().positive().optional(),
  })
  .strict() satisfies z.ZodType<ZoteroParseReceiptView>

export const zoteroStartDocumentParseResultSchema = z
  .object({
    operationId: z.uuid(),
    generation: z.uuid(),
    jobId: z.string().min(1).max(256),
    status: z.enum(['started', 'joined', 'completed']),
    receipt: zoteroParseReceiptSchema.optional(),
  })
  .strict() satisfies z.ZodType<ZoteroStartDocumentParseResultView>

export const zoteroDocumentArtifactRequestSchema = z
  .object({
    sessionId: z.string().min(1).max(256),
    target: zoteroParseTargetSchema,
    read: z
      .object({
        offset: z
          .number()
          .int()
          .nonnegative()
          .max(2 ** 31 - 1),
      })
      .strict()
      .optional(),
    image: z
      .object({
        // The canonical reference `full.md` carries, `images/<file>`.
        name: z
          .string()
          .regex(/^images\/[A-Za-z0-9][A-Za-z0-9._-]{0,110}\.(?:png|jpe?g|gif|webp|bmp)$/),
      })
      .strict()
      .optional(),
  })
  .strict() satisfies z.ZodType<ZoteroDocumentArtifactRequestView>

export const zoteroDocumentArtifactResultSchema = z.union([
  z.object({ kind: z.enum(['missing', 'expired']) }).strict(),
  z.object({ kind: z.literal('image-missing') }).strict(),
  z
    .object({
      kind: z.literal('image'),
      name: z
        .string()
        .regex(/^images\/[A-Za-z0-9][A-Za-z0-9._-]{0,110}\.(?:png|jpe?g|gif|webp|bmp)$/),
      mediaType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']),
      base64: z.string().max(Math.ceil(ZOTERO_ARTIFACT_IMAGE_BYTES / 3) * 4),
    })
    .strict(),
  z
    .object({
      kind: z.literal('ready'),
      sourceId: z.string().regex(/^[a-f0-9]{64}$/),
      targetLabel: z.string().min(1).max(2048),
      mode: z.enum(['free', 'pro']),
      artifactId: z.string().regex(/^[a-f0-9]{64}$/),
      fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      characterCount: z.number().int().nonnegative(),
      pageCount: z.number().int().positive().optional(),
      page: z
        .object({
          offset: z.number().int().nonnegative(),
          text: z.string().max(ZOTERO_ARTIFACT_PAGE_CHARS),
          totalChars: z.number().int().nonnegative(),
        })
        .strict()
        .optional(),
    })
    .strict(),
]) satisfies z.ZodType<ZoteroDocumentArtifactResultView>

export const zoteroDocumentParseReceiptRequestSchema = z
  .object({
    sessionId: z.string().min(1).max(256),
    operationId: z.uuid(),
  })
  .strict() satisfies z.ZodType<ZoteroDocumentParseReceiptRequestView>

export const zoteroDocumentParseReceiptResultSchema = z.union([
  z
    .object({ kind: z.literal('pending'), jobId: z.string().min(1).max(256), generation: z.uuid() })
    .strict(),
  z.object({ kind: z.literal('completed'), receipt: zoteroParseReceiptSchema }).strict(),
  z
    .object({
      kind: z.enum(['failed', 'cancelled']),
      code: z.string().min(1),
      message: z.string().max(2048),
    })
    .strict(),
]) satisfies z.ZodType<ZoteroDocumentParseReceiptResultView>

export const ZOTERO_COMMON_INVOCATIONS: readonly InvocationDescriptor[] = Object.freeze([
  zoteroDocumentParseInvocation(
    ZOTERO_START_DOCUMENT_PARSE_METHOD,
    strictCodec(
      'dsh-zotero#ZoteroStartDocumentParseRequestView',
      zoteroStartDocumentParseRequestSchema,
    ),
    strictCodec(
      'dsh-zotero#ZoteroStartDocumentParseResultView',
      zoteroStartDocumentParseResultSchema,
    ),
  ),
  zoteroDocumentParseInvocation(
    ZOTERO_DOCUMENT_ARTIFACT_METHOD,
    strictCodec(
      'dsh-zotero#ZoteroDocumentArtifactRequestView',
      zoteroDocumentArtifactRequestSchema,
    ),
    strictCodec('dsh-zotero#ZoteroDocumentArtifactResultView', zoteroDocumentArtifactResultSchema),
  ),
  zoteroDocumentParseInvocation(
    ZOTERO_DOCUMENT_PARSE_RECEIPT_METHOD,
    strictCodec(
      'dsh-zotero#ZoteroDocumentParseReceiptRequestView',
      zoteroDocumentParseReceiptRequestSchema,
    ),
    strictCodec(
      'dsh-zotero#ZoteroDocumentParseReceiptResultView',
      zoteroDocumentParseReceiptResultSchema,
    ),
  ),
  zoteroSemanticModelStatusInvocation(
    strictCodec(
      ZOTERO_SEMANTIC_MODEL_STATUS_REQUEST_TYPE_SYMBOL,
      zoteroSemanticModelStatusRequestSchema,
    ),
    strictCodec(
      ZOTERO_SEMANTIC_MODEL_STATUS_RESULT_TYPE_SYMBOL,
      zoteroSemanticModelStatusResultSchema,
    ),
  ),
  zoteroSemanticModelDownloadInvocation(
    strictCodec(
      ZOTERO_SEMANTIC_MODEL_DOWNLOAD_REQUEST_TYPE_SYMBOL,
      zoteroSemanticModelDownloadRequestSchema,
    ),
    strictCodec(
      ZOTERO_SEMANTIC_MODEL_DOWNLOAD_RESULT_TYPE_SYMBOL,
      zoteroSemanticModelDownloadResultSchema,
    ),
  ),
  zoteroSemanticModelCancelInvocation(
    strictCodec(
      ZOTERO_SEMANTIC_MODEL_CANCEL_REQUEST_TYPE_SYMBOL,
      zoteroSemanticModelCancelRequestSchema,
    ),
    strictCodec(
      ZOTERO_SEMANTIC_MODEL_CANCEL_RESULT_TYPE_SYMBOL,
      zoteroSemanticModelCancelResultSchema,
    ),
  ),
  zoteroSemanticModelDeleteInvocation(
    strictCodec(
      ZOTERO_SEMANTIC_MODEL_DELETE_REQUEST_TYPE_SYMBOL,
      zoteroSemanticModelDeleteRequestSchema,
    ),
    strictCodec(
      ZOTERO_SEMANTIC_MODEL_DELETE_RESULT_TYPE_SYMBOL,
      zoteroSemanticModelDeleteResultSchema,
    ),
  ),
  zoteroSemanticModelVerifyInvocation(
    strictCodec(
      ZOTERO_SEMANTIC_MODEL_VERIFY_REQUEST_TYPE_SYMBOL,
      zoteroSemanticModelVerifyRequestSchema,
    ),
    strictCodec(
      ZOTERO_SEMANTIC_MODEL_VERIFY_RESULT_TYPE_SYMBOL,
      zoteroSemanticModelStatusResultSchema,
    ),
  ),
  zoteroSourcePageInvocation(
    strictCodec(ZOTERO_SOURCE_PAGE_REQUEST_TYPE_SYMBOL, zoteroSourcePageRequestSchema),
    strictCodec(ZOTERO_SOURCE_PAGE_RESULT_TYPE_SYMBOL, zoteroSourcePageResultSchema),
  ),
  zoteroReleaseUrlPdfInvocation(
    strictCodec('dsh-zotero#ReleaseUrlPdfRequest', zoteroReleaseUrlPdfSchema),
    strictCodec('dsh-zotero#PdfReleaseResult', z.object({ released: z.literal(true) }).strict()),
  ),
  zoteroReadUrlPdfInvocation(
    strictCodec('dsh-zotero#ReadUrlPdfRequest', zoteroReadUrlPdfRequestSchema),
    ZOTERO_URL_PDF_CODEC,
  ),
  zoteroStatusInvocation(ZOTERO_STATUS_RESULT_CODEC),
  zoteroResolveAttachmentInvocation(
    strictCodec(ZOTERO_REF_PARAM_TYPE_SYMBOL, zoteroRefSchema),
    strictCodec(ZOTERO_RESOLVE_ATTACHMENT_TYPE_SYMBOL, zoteroAttachmentLocationSchema),
  ),
  zoteroDiagnosticsInvocation(strictCodec(ZOTERO_DIAGNOSTICS_TYPE_SYMBOL, zoteroDiagnosticsSchema)),
  zoteroReportClientErrorInvocation(
    strictCodec(ZOTERO_CLIENT_ERROR_REPORT_TYPE_SYMBOL, zoteroClientErrorReportSchema),
    strictCodec(ZOTERO_REPORT_RESULT_TYPE_SYMBOL, zoteroReportResultSchema),
  ),
  zoteroOpenProtocolInvocation(
    strictCodec(ZOTERO_OPEN_PROTOCOL_PARAM_TYPE_SYMBOL, zoteroProtocolUrlSchema),
    strictCodec(ZOTERO_OPEN_PROTOCOL_RESULT_TYPE_SYMBOL, zoteroOpenProtocolResultSchema),
  ),
  zoteroRevokeWriteGrantInvocation(
    strictCodec(ZOTERO_WRITE_GRANT_REVOKE_TYPE_SYMBOL, zoteroWriteGrantRevokeSchema),
  ),
  zoteroCollectionPathInvocation(
    strictCodec(ZOTERO_COLLECTION_PATH_REQUEST_TYPE_SYMBOL, zoteroCollectionPathRequestSchema),
    strictCodec(ZOTERO_COLLECTION_PATH_RESULT_TYPE_SYMBOL, zoteroCollectionPathResultSchema),
  ),
  zoteroLibraryBrowseInvocation(
    strictCodec(ZOTERO_LIBRARY_BROWSE_REQUEST_TYPE_SYMBOL, zoteroLibraryBrowseRequestSchema),
    strictCodec(ZOTERO_LIBRARY_BROWSE_RESULT_TYPE_SYMBOL, zoteroLibraryBrowseResultSchema),
  ),
  zoteroLibrarySearchInvocation(
    strictCodec(ZOTERO_LIBRARY_SEARCH_REQUEST_TYPE_SYMBOL, zoteroLibrarySearchRequestSchema),
    strictCodec(ZOTERO_LIBRARY_SEARCH_RESULT_TYPE_SYMBOL, zoteroSearchResultSchema),
  ),
  zoteroLibraryItemInvocation(
    strictCodec(ZOTERO_LIBRARY_ITEM_REQUEST_TYPE_SYMBOL, zoteroLibraryItemRequestSchema),
    strictCodec(ZOTERO_LIBRARY_ITEM_RESULT_TYPE_SYMBOL, zoteroItemDetailSchema),
  ),
  zoteroLibraryChildPageInvocation(
    strictCodec(ZOTERO_LIBRARY_CHILD_PAGE_REQUEST_TYPE_SYMBOL, zoteroLibraryChildPageRequestSchema),
    strictCodec(ZOTERO_LIBRARY_CHILD_PAGE_RESULT_TYPE_SYMBOL, zoteroChildPageSchema),
  ),
  zoteroLibraryExportInvocation(
    strictCodec(ZOTERO_LIBRARY_EXPORT_REQUEST_TYPE_SYMBOL, zoteroLibraryExportRequestSchema),
    strictCodec(ZOTERO_LIBRARY_EXPORT_RESULT_TYPE_SYMBOL, zoteroLibraryExportResultSchema),
  ),
  zoteroLibraryWriteInvocation(
    strictCodec(ZOTERO_LIBRARY_WRITE_REQUEST_TYPE_SYMBOL, zoteroLibraryWriteRequestSchema),
    strictCodec(ZOTERO_LIBRARY_WRITE_RESULT_TYPE_SYMBOL, zoteroLibraryWriteResultSchema),
  ),
])
