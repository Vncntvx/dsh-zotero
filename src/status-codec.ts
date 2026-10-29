/**
 * Host-only strict boundary codecs for the `zotero` wire namespace.
 *
 * Typert host registration (`ctx.typert.register`) materializes schemas
 * through `create()` (upstream `perf(typert): materialize generated schemas
 * on first use`). Structural endpoint identity comes from `./contract.js`;
 * the strict schemas are the shared definitions in `./wire-schemas.js`, the
 * same objects the client arm carries.
 * @module dsh-zotero/status-codec
 */

import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'
import {
  ZOTERO_CLIENT_ERROR_REPORT_TYPE_SYMBOL,
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
  ZOTERO_REF_PARAM_TYPE_SYMBOL,
  ZOTERO_REPORT_RESULT_TYPE_SYMBOL,
  ZOTERO_RESOLVE_ATTACHMENT_TYPE_SYMBOL,
  ZOTERO_STATUS_TYPE_SYMBOL,
  zoteroDiagnosticsInvocation,
  zoteroLibraryBrowseInvocation,
  zoteroLibraryChildPageInvocation,
  zoteroLibraryExportInvocation,
  zoteroLibraryItemInvocation,
  zoteroLibrarySearchInvocation,
  zoteroLibraryWriteInvocation,
  zoteroReportClientErrorInvocation,
  zoteroResolveAttachmentInvocation,
  zoteroStatusInvocation,
} from './contract.js'
import {
  strictCodec,
  zoteroAttachmentLocationSchema,
  zoteroClientErrorReportSchema,
  zoteroDiagnosticsSchema,
  zoteroItemDetailSchema,
  zoteroLibraryBrowseRequestSchema,
  zoteroLibraryBrowseResultSchema,
  zoteroLibraryChildPageRequestSchema,
  zoteroLibraryExportRequestSchema,
  zoteroLibraryExportResultSchema,
  zoteroLibraryItemRequestSchema,
  zoteroLibrarySearchRequestSchema,
  zoteroLibraryWriteRequestSchema,
  zoteroLibraryWriteResultSchema,
  zoteroRefSchema,
  zoteroReportResultSchema,
  zoteroSearchResultSchema,
  zoteroStatusSchema,
  zoteroChildPageSchema,
} from './wire-schemas.js'

const ZOTERO_STATUS_CODEC = strictCodec(ZOTERO_STATUS_TYPE_SYMBOL, zoteroStatusSchema)

const ZOTERO_REF_PARAM_CODEC = strictCodec(ZOTERO_REF_PARAM_TYPE_SYMBOL, zoteroRefSchema)

const ZOTERO_ATTACHMENT_LOCATION_CODEC = strictCodec(
  ZOTERO_RESOLVE_ATTACHMENT_TYPE_SYMBOL,
  zoteroAttachmentLocationSchema,
)

const ZOTERO_DIAGNOSTICS_CODEC = strictCodec(
  ZOTERO_DIAGNOSTICS_TYPE_SYMBOL,
  zoteroDiagnosticsSchema,
)

const ZOTERO_CLIENT_ERROR_REPORT_CODEC = strictCodec(
  ZOTERO_CLIENT_ERROR_REPORT_TYPE_SYMBOL,
  zoteroClientErrorReportSchema,
)

const ZOTERO_REPORT_RESULT_CODEC = strictCodec(
  ZOTERO_REPORT_RESULT_TYPE_SYMBOL,
  zoteroReportResultSchema,
)

// ── Library panel endpoints ────────────────────────────────────────────────

const ZOTERO_LIBRARY_BROWSE_REQUEST_CODEC = strictCodec(
  ZOTERO_LIBRARY_BROWSE_REQUEST_TYPE_SYMBOL,
  zoteroLibraryBrowseRequestSchema,
)

const ZOTERO_LIBRARY_BROWSE_RESULT_CODEC = strictCodec(
  ZOTERO_LIBRARY_BROWSE_RESULT_TYPE_SYMBOL,
  zoteroLibraryBrowseResultSchema,
)

const ZOTERO_LIBRARY_SEARCH_REQUEST_CODEC = strictCodec(
  ZOTERO_LIBRARY_SEARCH_REQUEST_TYPE_SYMBOL,
  zoteroLibrarySearchRequestSchema,
)

const ZOTERO_SEARCH_RESULT_CODEC = strictCodec(
  ZOTERO_LIBRARY_SEARCH_RESULT_TYPE_SYMBOL,
  zoteroSearchResultSchema,
)

const ZOTERO_LIBRARY_ITEM_REQUEST_CODEC = strictCodec(
  ZOTERO_LIBRARY_ITEM_REQUEST_TYPE_SYMBOL,
  zoteroLibraryItemRequestSchema,
)

const ZOTERO_ITEM_DETAIL_CODEC = strictCodec(
  ZOTERO_LIBRARY_ITEM_RESULT_TYPE_SYMBOL,
  zoteroItemDetailSchema,
)

const ZOTERO_LIBRARY_CHILD_PAGE_REQUEST_CODEC = strictCodec(
  ZOTERO_LIBRARY_CHILD_PAGE_REQUEST_TYPE_SYMBOL,
  zoteroLibraryChildPageRequestSchema,
)

const ZOTERO_CHILD_PAGE_CODEC = strictCodec(
  ZOTERO_LIBRARY_CHILD_PAGE_RESULT_TYPE_SYMBOL,
  zoteroChildPageSchema,
)

const ZOTERO_LIBRARY_EXPORT_REQUEST_CODEC = strictCodec(
  ZOTERO_LIBRARY_EXPORT_REQUEST_TYPE_SYMBOL,
  zoteroLibraryExportRequestSchema,
)

const ZOTERO_LIBRARY_EXPORT_RESULT_CODEC = strictCodec(
  ZOTERO_LIBRARY_EXPORT_RESULT_TYPE_SYMBOL,
  zoteroLibraryExportResultSchema,
)

const ZOTERO_LIBRARY_WRITE_REQUEST_CODEC = strictCodec(
  ZOTERO_LIBRARY_WRITE_REQUEST_TYPE_SYMBOL,
  zoteroLibraryWriteRequestSchema,
)

const ZOTERO_LIBRARY_WRITE_RESULT_CODEC = strictCodec(
  ZOTERO_LIBRARY_WRITE_RESULT_TYPE_SYMBOL,
  zoteroLibraryWriteResultSchema,
)

/** Host Typert manifest invocations (real zod factory). */
export const ZOTERO_INVOCATIONS: readonly InvocationDescriptor[] = [
  zoteroStatusInvocation(ZOTERO_STATUS_CODEC),
  zoteroResolveAttachmentInvocation(ZOTERO_REF_PARAM_CODEC, ZOTERO_ATTACHMENT_LOCATION_CODEC),
  zoteroDiagnosticsInvocation(ZOTERO_DIAGNOSTICS_CODEC),
  zoteroReportClientErrorInvocation(ZOTERO_CLIENT_ERROR_REPORT_CODEC, ZOTERO_REPORT_RESULT_CODEC),
  zoteroLibraryBrowseInvocation(
    ZOTERO_LIBRARY_BROWSE_REQUEST_CODEC,
    ZOTERO_LIBRARY_BROWSE_RESULT_CODEC,
  ),
  zoteroLibrarySearchInvocation(ZOTERO_LIBRARY_SEARCH_REQUEST_CODEC, ZOTERO_SEARCH_RESULT_CODEC),
  zoteroLibraryItemInvocation(ZOTERO_LIBRARY_ITEM_REQUEST_CODEC, ZOTERO_ITEM_DETAIL_CODEC),
  zoteroLibraryChildPageInvocation(
    ZOTERO_LIBRARY_CHILD_PAGE_REQUEST_CODEC,
    ZOTERO_CHILD_PAGE_CODEC,
  ),
  zoteroLibraryExportInvocation(
    ZOTERO_LIBRARY_EXPORT_REQUEST_CODEC,
    ZOTERO_LIBRARY_EXPORT_RESULT_CODEC,
  ),
  zoteroLibraryWriteInvocation(
    ZOTERO_LIBRARY_WRITE_REQUEST_CODEC,
    ZOTERO_LIBRARY_WRITE_RESULT_CODEC,
  ),
]
