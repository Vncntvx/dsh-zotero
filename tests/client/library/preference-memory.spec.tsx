// @vitest-environment jsdom
/** Session positions persist real scroll/child-page state and expose storage failures. */
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  LibraryPreferencesContext,
  libraryViewMemory,
  clearLibraryViewMemory,
  useLibraryScroll,
} from '../../../src/client/library-preferences.tsx'
import { LIBRARY_DEFAULTS } from '../../../src/library-preferences.ts'
import { useLibraryFeed } from '../../../src/client/components/library/useLibraryFeed.ts'
import {
  readLibraryState,
  writeLibraryState,
  clearLibraryConversationState,
  libraryStorageKey,
} from '../../../src/client/components/library/library-storage.ts'
import { setupLibraryFeed } from '../helpers/library-feed-harness.ts'
import { ITEM_DETAIL } from '../helpers/library-panel-harness.tsx'

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
function controlledScrollScheduler() {
  let queued: (() => void) | undefined
  let schedules = 0
  const schedule = (callback: () => void, _delayMs: number) => {
    schedules += 1
    queued = callback
    return () => {
      if (queued === callback) queued = undefined
    }
  }
  const run = () => {
    const callback = queued
    queued = undefined
    callback?.()
  }
  return {
    schedule,
    hasPending: () => queued !== undefined,
    schedules: () => schedules,
    run,
  }
}

it('restores each content scroll position and saves user scrolling through the owning memory', () => {
  const signal = new AbortController()
  const scheduler = controlledScrollScheduler()
  const memory = libraryViewMemory(signal.signal, 'S1', 's1', scheduler.schedule)
  memory.scroll = { list: 180, other: 40 }
  memory.saveScroll = vi.fn()
  function Scroller({ id }: { id: string }) {
    const scroll = useLibraryScroll(id, true)
    return <div data-testid="scroll" {...scroll} />
  }
  const view = render(
    <LibraryPreferencesContext.Provider value={{ preferences: LIBRARY_DEFAULTS, memory }}>
      <Scroller id="list" />
    </LibraryPreferencesContext.Provider>,
  )
  expect(screen.getByTestId('scroll').scrollTop).toBe(180)
  fireEvent.scroll(screen.getByTestId('scroll'), { target: { scrollTop: 210 } })
  fireEvent.scroll(screen.getByTestId('scroll'), { target: { scrollTop: 230 } })
  expect(memory.scroll.list).toBe(230)
  expect(memory.saveScroll).not.toHaveBeenCalled()
  expect(scheduler.schedules()).toBe(2)
  expect(scheduler.hasPending()).toBe(true)
  act(scheduler.run)
  expect(memory.saveScroll).toHaveBeenCalledTimes(1)
  expect(memory.saveScroll).toHaveBeenLastCalledWith(false)
  view.rerender(
    <LibraryPreferencesContext.Provider value={{ preferences: LIBRARY_DEFAULTS, memory }}>
      <Scroller id="other" />
    </LibraryPreferencesContext.Provider>,
  )
  expect(screen.getByTestId('scroll').scrollTop).toBe(40)
  signal.abort()
})
it('isolates memories by session even when the tab signal is shared', () => {
  const signal = new AbortController()
  const one = libraryViewMemory(signal.signal, 'S1', 's1')
  const two = libraryViewMemory(signal.signal, 'S1', 's2')
  one.scroll.list = 100
  expect(two.scroll).toEqual({})
  one.childPages = { ref: 'ref', offsets: { notes: 20 } }
  clearLibraryViewMemory('S1', 's1')
  expect(one.childPages).toBeUndefined()
  expect(one.resetPending).toBe(true)
  expect(two.resetPending).toBeUndefined()
  signal.abort()
})
it('clears the active view, selected child page and durable browsing position together', async () => {
  const memory = libraryViewMemory(new AbortController().signal, 'S1', 'session-1')
  const initial = setupLibraryFeed()
  const face = initial.face
  initial.unmount()
  const { result } = renderHook(() =>
    useLibraryFeed(face, 'S1', true, 'session-1', LIBRARY_DEFAULTS, memory),
  )
  await waitFor(() => expect(result.current.list.phase).toBe('ready'))
  act(() => result.current.selectItem(ITEM_DETAIL.ref))
  await waitFor(() => expect(result.current.inspector?.phase).toBe('ready'))
  act(() => result.current.pageChild('notes', 20))
  await waitFor(() => expect(memory.childPages?.offsets.notes).toBe(20))
  memory.scroll.list = 88
  act(() => result.current.clearPosition())
  await waitFor(() => expect(result.current.selectedRef).toBeUndefined())
  expect(result.current.q).toBe('')
  expect(result.current.sort).toBe('dateModified')
  expect(result.current.filters).toEqual({})
  expect(memory.scroll).toEqual({})
  expect(memory.childPages).toBeUndefined()
  expect(readLibraryState('S1', 'session-1')?.selectedRef).toBeUndefined()
})
it('restores selected child pagination after a new browser tab occurrence', async () => {
  const first = setupLibraryFeed()
  const face = first.face
  first.unmount()
  writeLibraryState('S1', 'session-1', {
    version: 3,
    prefixes: {},
    library: { type: 'user', id: 0 },
    selection: { kind: 'library' },
    q: '',
    mode: 'metadata',
    sort: 'dateModified',
    direction: 'desc',
    offset: 0,
    expanded: [],
    filters: {},
    selectedRef: ITEM_DETAIL.ref,
    childPages: { notes: 20 },
    scroll: { list: 50 },
  })
  const memory = libraryViewMemory(new AbortController().signal, 'S1', 'session-1')
  const { result } = renderHook(() =>
    useLibraryFeed(face, 'S1', true, 'session-1', LIBRARY_DEFAULTS, memory),
  )
  await waitFor(() => expect(result.current.inspector?.phase).toBe('ready'))
  expect(face.item).toHaveBeenLastCalledWith(
    expect.objectContaining({
      childPages: expect.objectContaining({ notes: { offset: 20, limit: 20 } }),
    }),
  )
  expect(memory.scroll.list).toBe(50)
})
it('shows a corrupt stored position until the user explicitly resets it', async () => {
  localStorage.setItem(libraryStorageKey('S1', 'session-1'), '{broken')
  const { result } = setupLibraryFeed()
  await waitFor(() => expect(result.current.storageError).toBeTruthy())
  expect(localStorage.getItem(libraryStorageKey('S1', 'session-1'))).toBe('{broken')
  act(() => result.current.clearPosition())
  await waitFor(() => expect(result.current.storageError).toBeUndefined())
  expect(readLibraryState('S1', 'session-1')?.q).toBe('')
})
it('reports browser write failure instead of claiming that the position was saved', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota exhausted')
  })
  const { result } = setupLibraryFeed()
  await waitFor(() => expect(result.current.storageError).toBe('quota exhausted'))
  act(() => result.current.clearPosition())
  await waitFor(() => expect(result.current.storageError).toBe('quota exhausted'))
})
it('removes positions for one conversation across servers and preserves other conversations', () => {
  localStorage.setItem(libraryStorageKey('S1', 's1'), 'one')
  localStorage.setItem(libraryStorageKey('S2', 's1'), 'two')
  localStorage.setItem(libraryStorageKey('S1', 's2'), 'three')
  clearLibraryConversationState('s1')
  expect(localStorage.getItem(libraryStorageKey('S1', 's1'))).toBeNull()
  expect(localStorage.getItem(libraryStorageKey('S2', 's1'))).toBeNull()
  expect(localStorage.getItem(libraryStorageKey('S1', 's2'))).toBe('three')
})

it('flushes queued scroll persistence when the tab occurrence aborts', async () => {
  const first = setupLibraryFeed()
  const face = first.face
  first.unmount()
  const signal = new AbortController()
  const scheduler = controlledScrollScheduler()
  const memory = libraryViewMemory(signal.signal, 'S1', 'session-1', scheduler.schedule)
  const { result, unmount } = renderHook(() =>
    useLibraryFeed(face, 'S1', true, 'session-1', LIBRARY_DEFAULTS, memory),
  )
  await waitFor(() => expect(result.current.list.phase).toBe('ready'))
  memory.scroll.list = 145
  act(() => memory.scheduleScrollSave())
  expect(scheduler.hasPending()).toBe(true)
  act(() => signal.abort())
  expect(scheduler.hasPending()).toBe(false)
  expect(readLibraryState('S1', 'session-1')?.scroll?.list).toBe(145)
  unmount()
})

it('does not persist a memory under a different feed server/session', async () => {
  const first = setupLibraryFeed()
  const face = first.face
  first.unmount()
  localStorage.removeItem(libraryStorageKey('S1', 'session-1'))
  const signal = new AbortController()
  const scheduler = controlledScrollScheduler()
  const memory = libraryViewMemory(signal.signal, 'S1', 'session-1', scheduler.schedule)
  const { result } = renderHook(() =>
    useLibraryFeed(face, 'S2', true, 'session-2', LIBRARY_DEFAULTS, memory),
  )
  await waitFor(() => expect(result.current.list.phase).toBe('ready'))
  memory.scroll.list = 160
  act(() => memory.scheduleScrollSave())
  expect(scheduler.hasPending()).toBe(true)
  act(() => signal.abort())
  expect(scheduler.hasPending()).toBe(false)
  expect(localStorage.getItem(libraryStorageKey('S1', 'session-1'))).toBeNull()
  expect(localStorage.getItem(libraryStorageKey('S2', 'session-2'))).toBeNull()
})

it('flushes queued scroll persistence when the feed unmounts', async () => {
  const first = setupLibraryFeed()
  const face = first.face
  first.unmount()
  const signal = new AbortController()
  const scheduler = controlledScrollScheduler()
  const memory = libraryViewMemory(signal.signal, 'S1', 'session-1', scheduler.schedule)
  const { result, unmount } = renderHook(() =>
    useLibraryFeed(face, 'S1', true, 'session-1', LIBRARY_DEFAULTS, memory),
  )
  await waitFor(() => expect(result.current.list.phase).toBe('ready'))
  memory.scroll.list = 170
  act(() => memory.scheduleScrollSave())
  act(unmount)
  expect(scheduler.hasPending()).toBe(false)
  expect(readLibraryState('S1', 'session-1')?.scroll?.list).toBe(170)
  signal.abort()
})

it('flushes queued scroll persistence on pagehide', async () => {
  const first = setupLibraryFeed()
  const face = first.face
  first.unmount()
  const signal = new AbortController()
  const scheduler = controlledScrollScheduler()
  const memory = libraryViewMemory(signal.signal, 'S1', 'session-1', scheduler.schedule)
  const { result } = renderHook(() =>
    useLibraryFeed(face, 'S1', true, 'session-1', LIBRARY_DEFAULTS, memory),
  )
  await waitFor(() => expect(result.current.list.phase).toBe('ready'))
  memory.scroll.list = 175
  act(() => memory.scheduleScrollSave())
  memory.scroll.list = 185
  act(() => memory.scheduleScrollSave())
  const writes = vi.spyOn(Storage.prototype, 'setItem')
  act(() => window.dispatchEvent(new Event('pagehide')))
  expect(scheduler.schedules()).toBe(2)
  expect(writes).toHaveBeenCalledTimes(1)
  expect(scheduler.hasPending()).toBe(false)
  expect(readLibraryState('S1', 'session-1')?.scroll?.list).toBe(185)
  signal.abort()
})

it('cancels queued position writes when the user resets the browsing position', async () => {
  const first = setupLibraryFeed()
  const face = first.face
  first.unmount()
  const signal = new AbortController()
  const scheduler = controlledScrollScheduler()
  const memory = libraryViewMemory(signal.signal, 'S1', 'session-1', scheduler.schedule)
  const { result } = renderHook(() =>
    useLibraryFeed(face, 'S1', true, 'session-1', LIBRARY_DEFAULTS, memory),
  )
  await waitFor(() => expect(result.current.list.phase).toBe('ready'))
  memory.scroll.list = 190
  act(() => memory.scheduleScrollSave())
  act(() => result.current.clearPosition())
  expect(scheduler.hasPending()).toBe(false)
  act(scheduler.run)
  expect(readLibraryState('S1', 'session-1')?.scroll).toEqual({})
  signal.abort()
})

it('writes scrolled positions on the scheduled frame and reports a later quota failure', async () => {
  const first = setupLibraryFeed()
  const face = first.face
  first.unmount()
  const signal = new AbortController()
  const scheduler = controlledScrollScheduler()
  const memory = libraryViewMemory(signal.signal, 'S1', 'session-1', scheduler.schedule)
  const { result } = renderHook(() =>
    useLibraryFeed(face, 'S1', true, 'session-1', LIBRARY_DEFAULTS, memory),
  )
  await waitFor(() => expect(result.current.list.phase).toBe('ready'))
  memory.scroll.list = 125
  act(() => memory.scheduleScrollSave())
  expect(readLibraryState('S1', 'session-1')?.scroll?.list).not.toBe(125)
  expect(scheduler.hasPending()).toBe(true)
  act(scheduler.run)
  expect(readLibraryState('S1', 'session-1')?.scroll?.list).toBe(125)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('scroll quota')
  })
  act(() => memory.scheduleScrollSave())
  act(scheduler.run)
  expect(result.current.storageError).toBe('scroll quota')
  signal.abort()
})

it('schedules and cancels scroll saves with the default timer scheduler', () => {
  vi.useFakeTimers()
  try {
    const signal = new AbortController()
    const memory = libraryViewMemory(signal.signal, 'S-default', 'session-default')
    let saved = false
    memory.saveScroll = () => {
      saved = true
    }
    memory.scheduleScrollSave()
    expect(saved).toBe(false)
    act(() => {
      vi.advanceTimersByTime(120)
    })
    expect(saved).toBe(true)

    saved = false
    memory.scheduleScrollSave()
    memory.cancelScrollSave()
    act(() => {
      vi.advanceTimersByTime(120)
    })
    expect(saved).toBe(false)
    signal.abort()
  } finally {
    vi.useRealTimers()
  }
})
