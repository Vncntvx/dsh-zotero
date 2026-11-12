/**
 * The library feed's shared vocabulary: the feed wire face, the panel's full
 * wire face the data plane wraps, and the child-listing shapes the feed and
 * its child hook both speak. They live apart from the feed hook so the child
 * hook can name them without importing the hook that calls it.
 * @module dsh-zotero/client/components/library/library-feed-types
 */

import type {
  ZoteroCollectionPathRequestView,
  ZoteroCollectionPathResultView,
} from '../../../contract.ts'
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

/**
 * The wire face the panel calls; injected so specs can stub it wholesale.
 *
 * Every read takes the caller's abort signal. The panel re-issues a read on
 * each toolbar change, so without one an abandoned listing keeps a request
 * open on the host for as long as the host needs to answer it — the sequence
 * ticket only drops the answer after it arrives. The data plane decides when
 * the shared wire call itself may abort (see `joinFlight`): a request another
 * caller still waits for is never cancelled by one caller's cleanup.
 */
export interface LibraryFeedFace {
  readonly collectionPath: (
    request: ZoteroCollectionPathRequestView,
    signal?: AbortSignal,
  ) => Promise<RemoteResult<ZoteroCollectionPathResultView>>
  readonly browse: (
    request: ZoteroLibraryBrowseRequestView,
    signal?: AbortSignal,
  ) => Promise<RemoteResult<ZoteroLibraryBrowseResultView>>
  readonly search: (
    request: ZoteroLibrarySearchRequestView,
    signal?: AbortSignal,
  ) => Promise<RemoteResult<ZoteroSearchResultView>>
  readonly item: (
    request: ZoteroLibraryItemRequestView,
    signal?: AbortSignal,
  ) => Promise<RemoteResult<ZoteroItemDetailView>>
  readonly childPage: (
    request: ZoteroLibraryChildPageRequestView,
    signal?: AbortSignal,
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

/** A listing's in-flight or failed state; `undefined` renders neither row. */
export type ListingStatus = { phase: 'loading' } | { phase: 'error'; message: string }

export type ChildKind = ZoteroChildListingKind
/** Child listings report the same loading/error shapes as every other listing. */
export type ChildLoadState = ListingStatus
