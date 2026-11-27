// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { ReaderTabLoader, ReaderTurnCitationLoader } from '../../../src/client/reader/load-tab.tsx'
import { readerEn, readerZh } from '../../../src/client/reader/locales.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'

const load = vi.fn<ComponentProps<typeof ReaderTabLoader>['loadUi']>()
const props = { loadUi: load, shellText: makeTranslate(readerEn) } as ComponentProps<
  typeof ReaderTabLoader
>

afterEach(() => {
  cleanup()
  load.mockReset()
})

it('loads a restored Reader tab through the package-local Harness loader', async () => {
  load.mockResolvedValue({
    ReaderTab: () => <p>Restored PDF</p>,
    ReaderNoteMutation: () => <form />,
    ReaderTurnCitations: () => <details />,
    readerEn,
    readerZh,
  })

  render(<ReaderTabLoader {...props} />)

  expect(screen.getByRole('status').textContent).toBe(readerEn.loading)
  expect(await screen.findByText('Restored PDF')).toBeTruthy()
  expect(load).toHaveBeenCalledTimes(1)
})

it.each([
  () => undefined,
  async () => ({}),
  async () => Promise.reject(new Error('Chunk unavailable')),
])('shows the unavailable state when the restored chunk cannot load (%#)', async (loader) => {
  load.mockImplementation(loader as typeof load)

  render(<ReaderTabLoader {...props} />)

  expect(await screen.findByText(readerEn.unavailable)).toBeTruthy()
})

it('loads the turn-citation chunk only when the selected turn has citations', async () => {
  type Props = ComponentProps<typeof ReaderTurnCitationLoader>
  const loadCitations = vi.fn<Props['loadUi']>().mockResolvedValue({
    ReaderTurnCitations: () => <p>Historical citation</p>,
  } as unknown as Awaited<ReturnType<Props['loadUi']>>)
  const useChat = (() => true) as unknown as Props['useChat']
  const props = {
    loadUi: loadCitations,
    turn: { turn: 1 } as Props['turn'],
    seq: 1,
    sessionId: SessionId('session-1'),
    useChat,
    useRemoteAccess: () => true,
    useAccess: () => true,
    t: makeTranslate(readerEn),
    openFile: vi.fn(),
    openCitation: vi.fn(),
  } as unknown as Props
  render(<ReaderTurnCitationLoader {...props} />)

  expect(await screen.findByText('Historical citation')).toBeTruthy()
  expect(loadCitations).toHaveBeenCalledTimes(1)
})

it('does not load the turn-citation chunk for an empty turn', async () => {
  type Props = ComponentProps<typeof ReaderTurnCitationLoader>
  const loadCitations = vi.fn<Props['loadUi']>()
  const useChat = (() => false) as unknown as Props['useChat']
  const props = {
    loadUi: loadCitations,
    turn: { turn: 1 } as Props['turn'],
    seq: 1,
    sessionId: SessionId('session-1'),
    useChat,
    useRemoteAccess: () => true,
    useAccess: () => true,
    t: makeTranslate(readerEn),
    openFile: vi.fn(),
    openCitation: vi.fn(),
  } as unknown as Props
  render(<ReaderTurnCitationLoader {...props} />)

  await Promise.resolve()
  expect(loadCitations).not.toHaveBeenCalled()
  expect(screen.queryByText('Historical citation')).toBeNull()
})
