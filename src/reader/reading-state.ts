/** Attachment-scoped Reader position and view preferences. */
import type { ReaderDocumentRef } from './identity.js'
import { documentIdentityKey } from './identity.js'

export type ReaderFitMode = 'free' | 'width' | 'page'

export interface ReaderPanelLayout {
  readonly pinned?: boolean
  readonly width?: number
  readonly x?: number
  readonly y?: number
}

export interface ReaderPanelState {
  readonly outline: boolean
  readonly info: boolean
  readonly infoTab?: 'annotations' | 'details'
  readonly outlineLayout?: ReaderPanelLayout
  readonly infoLayout?: ReaderPanelLayout
}

export interface ReadingState {
  readonly pageIndex: number
  readonly pageOffset: number
  readonly zoom: number
  readonly fitMode: ReaderFitMode
  readonly rotation: 0 | 90 | 180 | 270
  readonly attachmentRef: string
  readonly sectionPath?: readonly string[]
  readonly panels: ReaderPanelState
  readonly readingSeconds: number
  readonly lastVisitedAt: number
}

export const DEFAULT_READING_STATE: Omit<ReadingState, 'attachmentRef' | 'lastVisitedAt'> = {
  pageIndex: 0,
  pageOffset: 0,
  zoom: 1,
  fitMode: 'width',
  rotation: 0,
  panels: { outline: false, info: false },
  readingSeconds: 0,
}

export function readingStateStorageKeyOf(ref: ReaderDocumentRef): string {
  return `dsh-zotero:reader:state:${documentIdentityKey(ref)}`
}

export function normalizeReadingState(state: ReadingState): ReadingState {
  return {
    ...state,
    pageIndex: Number.isInteger(state.pageIndex) && state.pageIndex >= 0 ? state.pageIndex : 0,
    pageOffset: Number.isFinite(state.pageOffset) && state.pageOffset >= 0 ? state.pageOffset : 0,
    zoom: Number.isFinite(state.zoom) && state.zoom > 0 ? Math.min(state.zoom, 8) : 1,
    readingSeconds:
      Number.isFinite(state.readingSeconds) && state.readingSeconds >= 0 ? state.readingSeconds : 0,
    lastVisitedAt:
      Number.isFinite(state.lastVisitedAt) && state.lastVisitedAt >= 0 ? state.lastVisitedAt : 0,
  }
}
