import type {
  ZoteroCollectionPathRequestView,
  ZoteroCollectionPathResultView,
} from '../../../contract.ts'
/**
 * The library feed's shared vocabulary: the feed wire face, the panel's full
 * wire face the data plane wraps, and the child-listing shapes the feed and
 * its child hook both speak. They live apart from the feed hook so the child
 * hook can name them without importing the hook that calls it.
 * @module dsh-zotero/client/components/library/library-feed-types
 */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ZoteroChildListingKind,
  ZoteroChildPageView,
  ZoteroItemDetailView,
  ZoteroLibraryBrowseRequestView,
  ZoteroLibraryBrowseResultView,
  ZoteroLibraryChildPageRequestView,
  ZoteroLibraryExportRequestView,
  ZoteroLibraryExportResultView,
  ZoteroLibraryItemRequestView,
  ZoteroLibrarySearchRequestView,
  ZoteroSearchResultView,
} from '../../../contract.ts'

/** The wire face the panel calls; injected so specs can stub it wholesale. */
export interface LibraryFeedFace {
  readonly collectionPath: (
    request: ZoteroCollectionPathRequestView,
  ) => Promise<RemoteResult<ZoteroCollectionPathResultView>>
  readonly browse: (
    request: ZoteroLibraryBrowseRequestView,
  ) => Promise<RemoteResult<ZoteroLibraryBrowseResultView>>
  readonly search: (
    request: ZoteroLibrarySearchRequestView,
  ) => Promise<RemoteResult<ZoteroSearchResultView>>
  readonly item: (
    request: ZoteroLibraryItemRequestView,
  ) => Promise<RemoteResult<ZoteroItemDetailView>>
  readonly childPage: (
    request: ZoteroLibraryChildPageRequestView,
  ) => Promise<RemoteResult<ZoteroChildPageView>>
  /**
   * Drops the shared data plane's cached reads. Present when the face is the
   * panel's shared plane; a bare spec stub may omit it.
   */
  readonly invalidate?: () => void
  /**
   * Pins the shared plane's cache to one Zotero instance. Present when the
   * face is the panel's shared plane; a bare spec stub may omit it, in which
   * case the feed falls back to {@link LibraryFeedFace.invalidate}.
   */
  readonly setInstance?: (serverId: string | undefined) => void
}

/** The one-item export call the panel runs for a wire format. */
export type LibraryExportItem = (
  request: ZoteroLibraryExportRequestView,
) => Promise<RemoteResult<ZoteroLibraryExportResultView>>

/**
 * The panel's complete wire face: the feed reads plus the export read. The
 * data plane is constructed with this face and serves it back wrapped, so
 * every member the panel calls goes through the same dedupe/cache path.
 */
export interface LibraryPanelWireFace extends LibraryFeedFace {
  readonly export: LibraryExportItem
}

export type ChildKind = ZoteroChildListingKind
export type ChildLoadState = { phase: 'loading' } | { phase: 'error'; message: string }
