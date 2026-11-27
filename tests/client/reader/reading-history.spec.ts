// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  createReadingHistory,
  READING_HISTORY_KEY,
  type HistoryEntry,
} from '../../../src/client/reader/reading-history.ts'
import type { ReadingState } from '../../../src/reader/reading-state.ts'

const REF = 'zotero://user/0/attachment/ABCD1234?server=instance-a'
const OTHER_REF = 'zotero://user/0/attachment/ABCD1234?server=instance-b'
const entry = {
  fingerprint: 'document-a',
  attachmentRef: REF,
  pageIndex: 4,
  pageOffset: 0.3,
  zoom: 1.5,
  fitMode: 'free',
  rotation: 90,
  panels: { outline: true, info: false },
  readingSeconds: 18,
  lastVisitedAt: 1234,
} satisfies ReadingState & { fingerprint: string }

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

it('restores the persisted page, scale, rotation and panels only for the same copy of a PDF', () => {
  const config = () => ({ historyLimit: 10, persistReadingState: true })
  createReadingHistory(config).save(entry)
  const reloaded = createReadingHistory(config)

  expect(reloaded.restore(REF, entry.fingerprint)).toEqual(entry)
  expect(reloaded.restore(REF, 'replacement')).toBeUndefined()
  expect(reloaded.restore(OTHER_REF, entry.fingerprint)).toBeUndefined()
  expect(reloaded.restore(REF, '')).toBeUndefined()
})

it('keeps the newest attachment in the configured history window', () => {
  const config = () => ({ historyLimit: 1, persistReadingState: true })
  const history = createReadingHistory(config)
  history.save(entry)
  const newer = { ...entry, attachmentRef: OTHER_REF, lastVisitedAt: 1235 }
  history.save(newer)

  expect(createReadingHistory(config).restore(OTHER_REF, entry.fingerprint)).toEqual(newer)
  expect(history.restore(REF, entry.fingerprint)).toBeUndefined()
})

it('publishes recent visits in bounded order, preferring the latest save on timestamp ties', () => {
  const history = createReadingHistory(() => ({ historyLimit: 2, persistReadingState: true }))
  const other = { ...entry, attachmentRef: OTHER_REF }
  history.save(entry)
  history.save(other)
  const revisited = { ...entry, pageIndex: 5 }
  history.save(revisited)
  history.save({ ...entry, lastVisitedAt: 1233 })

  expect(history.visits.getSnapshot()).toEqual([revisited, other])
})

it('drops persisted visits when storage is cleared in another window', () => {
  const history = createReadingHistory(() => ({ historyLimit: 2, persistReadingState: true }))
  history.save(entry)
  localStorage.clear()
  history.refresh()

  expect(history.visits.getSnapshot()).toEqual([])
  expect(history.restore(REF, entry.fingerprint)).toBeUndefined()
})

it('keeps a session position in memory when browser storage is unavailable', () => {
  const unavailable = () => {
    throw new Error('Storage unavailable')
  }
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(unavailable)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(unavailable)
  const history = createReadingHistory(() => ({ historyLimit: 2, persistReadingState: true }))

  history.save(entry)

  expect(history.restore(REF, entry.fingerprint)).toEqual(entry)
})

it('ignores invalid persisted reading positions', () => {
  const invalid = { ...entry, pageOffset: 2 }
  vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(JSON.stringify([invalid, null, entry]))
  const history = createReadingHistory(() => ({ historyLimit: 2, persistReadingState: true }))

  expect(history.restore(REF, entry.fingerprint)).toEqual(entry)
})

it('skips parsing a reading-history record above the storage size bound', () => {
  localStorage.setItem(READING_HISTORY_KEY, ' '.repeat(1_000_001))
  const parse = vi.spyOn(JSON, 'parse')
  const history = createReadingHistory(() => ({ historyLimit: 2, persistReadingState: true }))

  history.refresh()
  expect(history.visits.getSnapshot()).toEqual([])
  expect(history.restore(REF, entry.fingerprint)).toBeUndefined()
  expect(parse).not.toHaveBeenCalled()
})

it('does not store an invalid history entry', () => {
  const persist = vi.spyOn(Storage.prototype, 'setItem')
  const history = createReadingHistory(() => ({ historyLimit: 2, persistReadingState: true }))

  history.save({ ...entry, title: 'x'.repeat(501) })

  expect(persist).not.toHaveBeenCalled()
  expect(history.visits.getSnapshot()).toEqual([])
})

it('restores independently saved panel positions, including the bounds of the Reader viewport', () => {
  const saved = {
    ...entry,
    itemRef: 'zotero://user/0/item/ABCD1234?server=instance-a',
    title: 'Study',
    fitMode: 'page',
    rotation: 270,
    panels: {
      outline: true,
      info: true,
      infoTab: 'details',
      outlineLayout: { pinned: false, width: 160, x: 0, y: 1 },
      infoLayout: { pinned: true, width: 560 },
    },
  } satisfies HistoryEntry
  const config = () => ({ historyLimit: 2, persistReadingState: true })
  createReadingHistory(config).save(saved)

  expect(createReadingHistory(config).restore(REF, entry.fingerprint)).toEqual(saved)
})

it.each([
  ['null layout', null],
  ['non-object layout', 'floating'],
  ['non-boolean pin', { pinned: 1 }],
  ['non-numeric width', { width: '300' }],
  ['too narrow', { width: 159 }],
  ['too wide', { width: 561 }],
  ['negative x', { x: -0.01 }],
  ['y outside the viewport', { y: 1.01 }],
  ['non-numeric offset', { y: '0.5' }],
])('ignores a saved entry with %s', (_, outlineLayout) => {
  localStorage.setItem(
    READING_HISTORY_KEY,
    JSON.stringify([{ ...entry, panels: { ...entry.panels, outlineLayout } }]),
  )
  const history = createReadingHistory(() => ({ historyLimit: 2, persistReadingState: true }))
  history.refresh()

  expect(history.visits.getSnapshot()).toEqual([])
})

it('ignores stored positions and makes no storage writes when persistence is disabled', () => {
  const persist = vi.spyOn(Storage.prototype, 'setItem')
  const history = createReadingHistory(() => ({ historyLimit: 2, persistReadingState: false }))

  history.save(entry)

  expect(history.restore(REF, entry.fingerprint)).toBeUndefined()
  expect(persist).not.toHaveBeenCalled()
})

it('does not persist or restore reading positions without a Zotero instance identity', () => {
  const persist = vi.spyOn(Storage.prototype, 'setItem')
  const history = createReadingHistory(() => ({ historyLimit: 2, persistReadingState: true }))
  const legacyRef = 'zotero://user/0/attachment/ABCD1234'

  history.save({ ...entry, attachmentRef: legacyRef })

  expect(persist).not.toHaveBeenCalled()
  expect(history.restore(legacyRef, entry.fingerprint)).toBeUndefined()
  localStorage.setItem(
    READING_HISTORY_KEY,
    JSON.stringify([{ ...entry, attachmentRef: legacyRef }]),
  )
  history.refresh()
  expect(history.visits.getSnapshot()).toEqual([])
})

it.each([
  ['another instance', 'zotero://user/0/item/ABCD1234?server=instance-b'],
  ['another library', 'zotero://group/42/item/ABCD1234?server=instance-a'],
])('rejects a history entry whose parent ref belongs to %s', (_, foreignParent) => {
  const persist = vi.spyOn(Storage.prototype, 'setItem')
  localStorage.setItem(READING_HISTORY_KEY, JSON.stringify([{ ...entry, itemRef: foreignParent }]))
  const history = createReadingHistory(() => ({ historyLimit: 2, persistReadingState: true }))

  history.refresh()
  expect(history.visits.getSnapshot()).toEqual([])
  expect(history.restore(REF, entry.fingerprint)).toBeUndefined()
  persist.mockClear()
  history.save({ ...entry, itemRef: foreignParent })
  expect(persist).not.toHaveBeenCalled()
})
