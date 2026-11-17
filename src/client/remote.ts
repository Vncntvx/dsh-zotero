/** Shared strict Remote descriptors and typed namespace contribution. */
import type {
  TypertRemoteContribution,
  TypertRemoteNamespace,
} from '@deepseek-ai/dsh-typert-protocol'
import { ZOTERO_REMOTE_PACKAGE, type ZoteroRemoteEndpointMap } from '../contract.ts'
import { ZOTERO_COMMON_INVOCATIONS } from '../wire-schemas.ts'
export type {
  ZoteroDiagnosticsView,
  ZoteroItemDetailView,
  ZoteroLibraryBrowseRequestView,
  ZoteroLibraryBrowseResultView,
  ZoteroLibraryItemRequestView,
  ZoteroLibrarySearchRequestView,
  ZoteroSearchResultView,
  ZoteroStatusView,
} from '../contract.ts'
export const ZOTERO_REMOTE: TypertRemoteContribution = {
  package: ZOTERO_REMOTE_PACKAGE,
  descriptors: ZOTERO_COMMON_INVOCATIONS,
}
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap extends ZoteroRemoteEndpointMap {}
  interface TypertRemoteNamespaceMap {
    zotero: TypertRemoteNamespace<'zotero'>
  }
}
