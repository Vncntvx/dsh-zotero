/**
 * Client-side strict codecs for Zotero Typert remotes.
 *
 * Each codec carries the `{ mode, typeSymbol, create }` shape the typert
 * generator emits; `create()` returns the shared zod schema from
 * `../wire-schemas.ts`, the same object the host arm registers.
 *
 * These wrappers do not validate in the browser. Client Gateway decodes a
 * unary result only through `descriptor.result.decode`, which the generator
 * emits for byte-carrying boundaries; a pure-JSON result reaches the caller as
 * `RemoteResult.value`, and `create()` is not invoked at runtime. The wrappers
 * are the structural counterpart and the fixture the parity tests read. `zod`
 * is the external platform module the shell serves (`PLATFORM_MODULES`).
 * @module dsh-zotero/client/status-codec
 */

import {
  ZOTERO_COLLECTION_PATH_REQUEST_TYPE_SYMBOL,
  ZOTERO_COLLECTION_PATH_RESULT_TYPE_SYMBOL,
  zoteroCollectionPathInvocation,
} from '../contract.ts'
import {
  zoteroCollectionPathRequestSchema,
  zoteroCollectionPathResultSchema,
} from '../wire-schemas.ts'
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
  ZOTERO_OPEN_PROTOCOL_PARAM_TYPE_SYMBOL,
  ZOTERO_OPEN_PROTOCOL_RESULT_TYPE_SYMBOL,
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
  zoteroOpenProtocolInvocation,
  zoteroReportClientErrorInvocation,
  zoteroResolveAttachmentInvocation,
  zoteroStatusInvocation,
} from '../contract.ts'
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
  zoteroOpenProtocolResultSchema,
  zoteroProtocolUrlSchema,
  zoteroRefSchema,
  zoteroReportResultSchema,
  zoteroSearchResultSchema,
  zoteroStatusSchema,
  zoteroChildPageSchema,
} from '../wire-schemas.ts'

export const ZOTERO_STATUS_CLIENT_RESULT_CODEC = strictCodec(
  ZOTERO_STATUS_TYPE_SYMBOL,
  zoteroStatusSchema,
)

const ZOTERO_REF_CLIENT_PARAM_CODEC = strictCodec(ZOTERO_REF_PARAM_TYPE_SYMBOL, zoteroRefSchema)

const ZOTERO_RESOLVE_ATTACHMENT_CLIENT_RESULT_CODEC = strictCodec(
  ZOTERO_RESOLVE_ATTACHMENT_TYPE_SYMBOL,
  zoteroAttachmentLocationSchema,
)

const ZOTERO_DIAGNOSTICS_CLIENT_RESULT_CODEC = strictCodec(
  ZOTERO_DIAGNOSTICS_TYPE_SYMBOL,
  zoteroDiagnosticsSchema,
)

const ZOTERO_CLIENT_ERROR_REPORT_CLIENT_PARAM_CODEC = strictCodec(
  ZOTERO_CLIENT_ERROR_REPORT_TYPE_SYMBOL,
  zoteroClientErrorReportSchema,
)

const ZOTERO_REPORT_RESULT_CLIENT_RESULT_CODEC = strictCodec(
  ZOTERO_REPORT_RESULT_TYPE_SYMBOL,
  zoteroReportResultSchema,
)

const ZOTERO_OPEN_PROTOCOL_CLIENT_PARAM_CODEC = strictCodec(
  ZOTERO_OPEN_PROTOCOL_PARAM_TYPE_SYMBOL,
  zoteroProtocolUrlSchema,
)

const ZOTERO_OPEN_PROTOCOL_CLIENT_RESULT_CODEC = strictCodec(
  ZOTERO_OPEN_PROTOCOL_RESULT_TYPE_SYMBOL,
  zoteroOpenProtocolResultSchema,
)

// ── Library panel endpoints ────────────────────────────────────────────────

const ZOTERO_LIBRARY_BROWSE_CLIENT_PARAM_CODEC = strictCodec(
  ZOTERO_LIBRARY_BROWSE_REQUEST_TYPE_SYMBOL,
  zoteroLibraryBrowseRequestSchema,
)

const ZOTERO_LIBRARY_BROWSE_CLIENT_RESULT_CODEC = strictCodec(
  ZOTERO_LIBRARY_BROWSE_RESULT_TYPE_SYMBOL,
  zoteroLibraryBrowseResultSchema,
)

const ZOTERO_LIBRARY_SEARCH_CLIENT_PARAM_CODEC = strictCodec(
  ZOTERO_LIBRARY_SEARCH_REQUEST_TYPE_SYMBOL,
  zoteroLibrarySearchRequestSchema,
)

const ZOTERO_LIBRARY_SEARCH_CLIENT_RESULT_CODEC = strictCodec(
  ZOTERO_LIBRARY_SEARCH_RESULT_TYPE_SYMBOL,
  zoteroSearchResultSchema,
)

const ZOTERO_LIBRARY_ITEM_CLIENT_PARAM_CODEC = strictCodec(
  ZOTERO_LIBRARY_ITEM_REQUEST_TYPE_SYMBOL,
  zoteroLibraryItemRequestSchema,
)

const ZOTERO_LIBRARY_ITEM_CLIENT_RESULT_CODEC = strictCodec(
  ZOTERO_LIBRARY_ITEM_RESULT_TYPE_SYMBOL,
  zoteroItemDetailSchema,
)

const ZOTERO_LIBRARY_CHILD_PAGE_CLIENT_PARAM_CODEC = strictCodec(
  ZOTERO_LIBRARY_CHILD_PAGE_REQUEST_TYPE_SYMBOL,
  zoteroLibraryChildPageRequestSchema,
)

const ZOTERO_LIBRARY_CHILD_PAGE_CLIENT_RESULT_CODEC = strictCodec(
  ZOTERO_LIBRARY_CHILD_PAGE_RESULT_TYPE_SYMBOL,
  zoteroChildPageSchema,
)

const ZOTERO_LIBRARY_EXPORT_CLIENT_PARAM_CODEC = strictCodec(
  ZOTERO_LIBRARY_EXPORT_REQUEST_TYPE_SYMBOL,
  zoteroLibraryExportRequestSchema,
)

const ZOTERO_LIBRARY_EXPORT_CLIENT_RESULT_CODEC = strictCodec(
  ZOTERO_LIBRARY_EXPORT_RESULT_TYPE_SYMBOL,
  zoteroLibraryExportResultSchema,
)

const zoteroLibraryWriteRequestCodec = strictCodec(
  ZOTERO_LIBRARY_WRITE_REQUEST_TYPE_SYMBOL,
  zoteroLibraryWriteRequestSchema,
)

const zoteroLibraryWriteResultCodec = strictCodec(
  ZOTERO_LIBRARY_WRITE_RESULT_TYPE_SYMBOL,
  zoteroLibraryWriteResultSchema,
)

/** The client contribution's invocations, in the manifest's endpoint order. */
export const ZOTERO_CLIENT_INVOCATIONS: readonly InvocationDescriptor[] = Object.freeze([
  zoteroStatusInvocation(ZOTERO_STATUS_CLIENT_RESULT_CODEC),
  zoteroResolveAttachmentInvocation(
    ZOTERO_REF_CLIENT_PARAM_CODEC,
    ZOTERO_RESOLVE_ATTACHMENT_CLIENT_RESULT_CODEC,
  ),
  zoteroDiagnosticsInvocation(ZOTERO_DIAGNOSTICS_CLIENT_RESULT_CODEC),
  zoteroReportClientErrorInvocation(
    ZOTERO_CLIENT_ERROR_REPORT_CLIENT_PARAM_CODEC,
    ZOTERO_REPORT_RESULT_CLIENT_RESULT_CODEC,
  ),
  zoteroOpenProtocolInvocation(
    ZOTERO_OPEN_PROTOCOL_CLIENT_PARAM_CODEC,
    ZOTERO_OPEN_PROTOCOL_CLIENT_RESULT_CODEC,
  ),
  zoteroCollectionPathInvocation(
    strictCodec(ZOTERO_COLLECTION_PATH_REQUEST_TYPE_SYMBOL, zoteroCollectionPathRequestSchema),
    strictCodec(ZOTERO_COLLECTION_PATH_RESULT_TYPE_SYMBOL, zoteroCollectionPathResultSchema),
  ),
  zoteroLibraryBrowseInvocation(
    ZOTERO_LIBRARY_BROWSE_CLIENT_PARAM_CODEC,
    ZOTERO_LIBRARY_BROWSE_CLIENT_RESULT_CODEC,
  ),
  zoteroLibrarySearchInvocation(
    ZOTERO_LIBRARY_SEARCH_CLIENT_PARAM_CODEC,
    ZOTERO_LIBRARY_SEARCH_CLIENT_RESULT_CODEC,
  ),
  zoteroLibraryItemInvocation(
    ZOTERO_LIBRARY_ITEM_CLIENT_PARAM_CODEC,
    ZOTERO_LIBRARY_ITEM_CLIENT_RESULT_CODEC,
  ),
  zoteroLibraryChildPageInvocation(
    ZOTERO_LIBRARY_CHILD_PAGE_CLIENT_PARAM_CODEC,
    ZOTERO_LIBRARY_CHILD_PAGE_CLIENT_RESULT_CODEC,
  ),
  zoteroLibraryExportInvocation(
    ZOTERO_LIBRARY_EXPORT_CLIENT_PARAM_CODEC,
    ZOTERO_LIBRARY_EXPORT_CLIENT_RESULT_CODEC,
  ),
  zoteroLibraryWriteInvocation(zoteroLibraryWriteRequestCodec, zoteroLibraryWriteResultCodec),
])
