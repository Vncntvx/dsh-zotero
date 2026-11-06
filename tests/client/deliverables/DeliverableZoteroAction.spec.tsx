// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ChatSnapshot, UseChat } from '@deepseek-ai/dsh-client-ui-chat/client'
import { isBibliographyDeliverable } from '../../../src/client/bibliography.ts'
import {
  DeliverableZoteroAction,
  type DeliverableZoteroActionProps,
  resolveDeliverablePath,
} from '../../../src/client/components/deliverables/DeliverableZoteroAction.tsx'
import { mockT } from '../helpers/mock-translate.ts'
import { turnProjection, type TurnProjectionEvent } from './support/turn-projection.ts'

afterEach(cleanup)

function renderAction(props: {
  readonly actionUrl: string
  readonly useChat: UseChat
  readonly onOpenLibrary?: () => void
}) {
  const full = {
    ...props,
    t: mockT,
    available: true,
    pending: false,
    onAction: vi.fn(),
  } as unknown as DeliverableZoteroActionProps
  return render(<DeliverableZoteroAction {...full} />)
}

/** The loaded window: one open turn with two declared files at seq 10. */
const loadedWindow: readonly TurnProjectionEvent[] = [
  { type: 'turn/start', seq: 1, turn: 1 },
  {
    type: 'deliverables/presented',
    seq: 10,
    turn: 1,
    files: [{ path: '/workspace/papers.bib' }, { path: '/workspace/package.json' }],
  },
]

function snapshot(): ChatSnapshot {
  return turnProjection(loadedWindow).snapshot()
}

it('reads deliveries from a typed turn projection when nodes are empty', () => {
  const state = snapshot()
  expect(state.order).toEqual([])
  expect(resolveDeliverablePath('seq=10&index=0', state)).toBe('/workspace/papers.bib')
  expect(resolveDeliverablePath('seq=10&index=1', state)).toBe('/workspace/package.json')
  expect(resolveDeliverablePath('seq=10&index=2', state)).toBeUndefined()
  for (const query of [
    'seq=10',
    'index=0',
    'seq=10&index=0&seq=10',
    'seq=10&index=0&index=1',
    'seq=-1&index=0',
    'seq=10&index=-1',
  ]) {
    expect(resolveDeliverablePath(query, state)).toBeUndefined()
  }
  // The local augmentation in src/client/deliverables-turn-data.d.ts must stay
  // structurally compatible with the turn data the projection publishes;
  // turn-data-contract.spec.ts pins that shape at the type level.
  const data = state.timeline.turns.get(1)?.data.get('deliverables')
  expect(data?.presented?.[0]).toMatchObject({ path: '/workspace/papers.bib', seq: 10, index: 0 })
})

it('opens the library for a projected bibliography file', () => {
  const state = snapshot()
  const open = vi.fn()
  renderAction({
    actionUrl: 'seq=10&index=0',
    useChat: useChatOf(state),
    onOpenLibrary: open,
  })
  fireEvent.click(screen.getByRole('button'))
  expect(open).toHaveBeenCalledOnce()
})

it('does not offer a bibliography action for ordinary JSON', () => {
  expect(isBibliographyDeliverable({ path: 'package.json' })).toBe(false)
  expect(
    isBibliographyDeliverable({ path: 'citations.json', description: 'exported CSL JSON' }),
  ).toBe(true)
  const state = snapshot()
  renderAction({ actionUrl: 'seq=10&index=1', useChat: useChatOf(state) })
  expect(screen.queryByRole('button')).toBeNull()
})

it('shows a subscribed delivery appended after its original turn ends', () => {
  const projection = turnProjection([
    ...loadedWindow,
    { type: 'turn/end', seq: 11, turn: 1 },
    { type: 'turn/start', seq: 12, turn: 2 },
  ])
  const useChat = <T,>(select: (state: ChatSnapshot) => T) =>
    select(useSyncExternalStore(projection.subscribe, projection.snapshot))

  renderAction({ actionUrl: 'seq=13&index=0', useChat })
  expect(screen.queryByRole('button')).toBeNull()

  act(() => {
    projection.append({
      type: 'deliverables/presented',
      seq: 13,
      turn: 1,
      files: [{ path: '/workspace/late.bib' }],
    })
    projection.flush()
  })
  expect(screen.getByRole('button')).toBeTruthy()
})

/** A `useChat`-shaped reader over one fixed snapshot. */
function useChatOf(state: ChatSnapshot) {
  return <T,>(select: (snapshot: ChatSnapshot) => T) => select(state)
}
