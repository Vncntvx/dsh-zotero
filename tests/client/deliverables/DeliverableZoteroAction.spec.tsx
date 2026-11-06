// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ChatSnapshot, UseChat } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConversationViewDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
// Dev-only source imports: the published packages expose neither the assembler
// nor the deliverable Definition through their public entries.
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/src/client/conversation/assembler.ts'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session/types'
import { deliverablesDefinition } from '@deepseek-ai/dsh-client-ui-deliverables/src/client/turn-deliverables.ts'
import type { SessionLiveEventEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import { isBibliographyDeliverable } from '../../../src/client/bibliography.ts'
import {
  DeliverableZoteroAction,
  type DeliverableZoteroActionProps,
  resolveDeliverablePath,
} from '../../../src/client/components/deliverables/DeliverableZoteroAction.tsx'

import { mockT } from '../helpers/mock-translate.ts'

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

const empty: ChatSnapshot = {
  order: [],
  nodes: {
    get: () => undefined,
    values: () => [],
    source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }),
    bottomSource: () => ({ getSnapshot: () => false, subscribe: () => () => {} }),
    processSource: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }),
    turnDataSource: () => ({ getSnapshot: () => [], subscribe: () => () => {} }),
  },
  locations: { getTurn: () => [], getStep: () => [] },
  navigation: { items: () => [] },
  timeline: { turnOrder: [], turns: new Map() },
  legacy: {
    nodes: [],
    turnTimings: new Map(),
    turnEnds: new Map(),
    partial: null,
    runningCalls: [],
  },
}

function projection() {
  const view: ConversationViewDefinition<never, ChatSnapshot> = {
    target: 'test',
    create: () => ({
      empty: empty,
      replace: ({ timeline }) => ({ ...empty, timeline }),
      apply: ({ timeline }) => ({ ...empty, timeline }),
    }),
  }
  const assembler = new ConversationNodeAssembler(
    { entries: () => [deliverablesDefinition], fallbackEntry: () => undefined },
    { entries: () => [view] },
  )
  const event = (seq: number, type: string, data: unknown): SessionLiveEventEntry => ({
    type: 'event',
    event: { seq: SessionSeq(seq), time: seq, type, data } as SessionEvent,
  })
  assembler.replaceWindow(
    [
      event(1, 'turn/start', { turn: 1 }),
      event(10, 'deliverables/presented', {
        turn: 1,
        callId: 'export',
        files: [{ path: '/workspace/papers.bib' }, { path: '/workspace/package.json' }],
      }),
    ],
    false,
  )
  assembler.activateTarget('test')
  return { assembler, event }
}
function snapshot() {
  return projection().assembler.snapshot('test') as ChatSnapshot
}

it('reads deliveries from the real turn projection when nodes are empty', () => {
  const state = snapshot()
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
  // The mirror in plugin-slots.d.ts must stay structurally compatible with
  // the shape the real deliverable Definition publishes.
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
  const { assembler, event } = projection()
  assembler.append(event(11, 'turn/end', { turn: 1 }))
  assembler.append(event(12, 'turn/start', { turn: 2 }))
  assembler.flush()
  let state = assembler.snapshot('test') as ChatSnapshot
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  const useChat = <T,>(select: (snapshot: ChatSnapshot) => T) =>
    select(useSyncExternalStore(subscribe, () => state))

  renderAction({ actionUrl: 'seq=13&index=0', useChat })
  expect(screen.queryByRole('button')).toBeNull()

  act(() => {
    assembler.append(
      event(13, 'deliverables/presented', {
        turn: 1,
        callId: 'background-export',
        files: [{ path: '/workspace/late.bib' }],
      }),
    )
    assembler.flush()
    state = assembler.snapshot('test') as ChatSnapshot
    listeners.forEach((listener) => listener())
  })
  expect(screen.getByRole('button')).toBeTruthy()
})

/** A `useChat`-shaped reader over one fixed snapshot. */
function useChatOf(state: ChatSnapshot) {
  return <T,>(select: (snapshot: ChatSnapshot) => T) => select(state)
}
