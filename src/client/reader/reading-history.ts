import type { ResolvedReaderConfig } from '../../reader/config.ts'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ReaderPanelLayout, ReadingState } from '../../reader/reading-state.ts'
import { refFieldsOf } from '../../ref-grammar.ts'

export const READING_HISTORY_KEY = 'dsh-zotero:reader:history:v1'
const MAX_READING_HISTORY_CHARS = 1_000_000

export interface HistoryEntry extends ReadingState {
  readonly fingerprint: string
  readonly itemRef?: string
  readonly title?: string
}

export type ReadingVisits = Pick<
  SnapshotStore<readonly HistoryEntry[]>,
  'getSnapshot' | 'subscribe'
>
const noVisits: readonly HistoryEntry[] = []
export const emptyVisits: ReadingVisits = {
  getSnapshot: () => noVisits,
  subscribe: () => () => {},
}

export function sameReadingLibrary(left: string, right: string): boolean {
  const a = refFieldsOf(left)
  const b = refFieldsOf(right)
  return (
    a !== undefined &&
    b !== undefined &&
    a.serverId !== undefined &&
    a.serverId === b.serverId &&
    a.libraryType === b.libraryType &&
    a.libraryId === b.libraryId
  )
}

function isPanelLayout(layout: unknown): boolean {
  if (layout === undefined) return true
  if (layout === null || typeof layout !== 'object') return false
  const { pinned, width, x, y } = layout as ReaderPanelLayout
  return (
    (pinned === undefined || typeof pinned === 'boolean') &&
    (width === undefined || (Number.isFinite(width) && width >= 160 && width <= 560)) &&
    [x, y].every(
      (offset) => offset === undefined || (Number.isFinite(offset) && offset >= 0 && offset <= 1),
    )
  )
}

function isHistoryEntry(entry: unknown): entry is HistoryEntry {
  if (typeof entry !== 'object' || entry === null) return false
  const value = entry as Partial<HistoryEntry>
  return (
    typeof value.attachmentRef === 'string' &&
    refFieldsOf(value.attachmentRef)?.kind === 'attachment' &&
    refFieldsOf(value.attachmentRef)?.serverId !== undefined &&
    (value.itemRef === undefined ||
      (typeof value.itemRef === 'string' &&
        refFieldsOf(value.itemRef)?.kind === 'item' &&
        sameReadingLibrary(value.attachmentRef, value.itemRef))) &&
    (value.title === undefined || (typeof value.title === 'string' && value.title.length <= 500)) &&
    typeof value.fingerprint === 'string' &&
    value.fingerprint.length <= 128 &&
    typeof value.pageIndex === 'number' &&
    Number.isSafeInteger(value.pageIndex) &&
    value.pageIndex >= 0 &&
    typeof value.pageOffset === 'number' &&
    value.pageOffset >= 0 &&
    value.pageOffset <= 1 &&
    typeof value.zoom === 'number' &&
    value.zoom >= 0.1 &&
    value.zoom <= 10 &&
    (value.fitMode === 'free' || value.fitMode === 'width' || value.fitMode === 'page') &&
    (value.rotation === 0 ||
      value.rotation === 90 ||
      value.rotation === 180 ||
      value.rotation === 270) &&
    typeof value.panels?.outline === 'boolean' &&
    typeof value.panels.info === 'boolean' &&
    isPanelLayout(value.panels.outlineLayout) &&
    isPanelLayout(value.panels.infoLayout) &&
    (value.panels.infoTab === undefined ||
      value.panels.infoTab === 'annotations' ||
      value.panels.infoTab === 'details') &&
    typeof value.readingSeconds === 'number' &&
    Number.isFinite(value.readingSeconds) &&
    value.readingSeconds >= 0 &&
    typeof value.lastVisitedAt === 'number' &&
    Number.isFinite(value.lastVisitedAt) &&
    value.lastVisitedAt >= 0 &&
    value.lastVisitedAt <= 8.64e15
  )
}

export function createReadingHistory(
  config: () => Pick<ResolvedReaderConfig, 'historyLimit' | 'persistReadingState'>,
  visits = createSnapshotStore<readonly HistoryEntry[]>([]),
) {
  let memory: HistoryEntry[] = []
  function read() {
    try {
      const raw = globalThis.localStorage.getItem(READING_HISTORY_KEY) ?? '[]'
      if (raw.length > MAX_READING_HISTORY_CHARS) return []
      const stored: unknown = JSON.parse(raw)
      if (Array.isArray(stored)) return stored.filter(isHistoryEntry)
    } catch {
      // Private browsing and restricted profiles can keep state in this client session.
    }
    return []
  }
  function recent() {
    const { persistReadingState, historyLimit } = config()
    if (!persistReadingState) return []
    const entries = new Map<string, HistoryEntry>()
    for (const point of [...memory, ...read()]) {
      const previous = entries.get(point.attachmentRef)
      if (!previous || point.lastVisitedAt > previous.lastVisitedAt)
        entries.set(point.attachmentRef, point)
    }
    return [...entries.values()]
      .sort((left, right) => right.lastVisitedAt - left.lastVisitedAt)
      .slice(0, historyLimit)
  }
  return {
    visits,
    refresh: () => visits.set(recent()),
    restore(ref: string, fingerprint: string) {
      if (!config().persistReadingState || !fingerprint) return undefined
      return recent().find(
        (entry) => entry.attachmentRef === ref && entry.fingerprint === fingerprint,
      )
    },
    save(entry: HistoryEntry) {
      const { persistReadingState } = config()
      if (
        !persistReadingState ||
        !isHistoryEntry(entry) ||
        !entry.fingerprint ||
        refFieldsOf(entry.attachmentRef)?.serverId === undefined ||
        (entry.itemRef !== undefined && !sameReadingLibrary(entry.attachmentRef, entry.itemRef))
      )
        return
      memory = [entry, ...memory]
      const entries = recent()
      try {
        globalThis.localStorage.setItem(READING_HISTORY_KEY, JSON.stringify(entries))
        memory = []
      } catch {
        // The current client still has a bounded history when persistence is unavailable.
        memory = memory.filter((point) => entries.includes(point))
      }
      visits.set(entries)
    },
  }
}
