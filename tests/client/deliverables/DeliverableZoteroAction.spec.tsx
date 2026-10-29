import { useSyncExternalStore } from 'react'
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConversationViewDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/src/client/conversation/assembler.ts'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session/types'
import { deliverablesDefinition } from '@deepseek-ai/dsh-client-ui-deliverables/src/client/turn-deliverables.ts'
import type { SessionLiveEventEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import {
  DeliverableZoteroAction,
  isBibliographyDeliverable,
  resolveDeliverablePath,
} from '../../../src/client/components/deliverables/DeliverableZoteroAction.tsx'
import { mockT } from '../helpers/mock-translate.ts'

// The published util bundle expects the harness platform loader; use its real
// browser-safe source in this standalone Vitest environment (alpha.2).
vi.mock(
  '@deepseek-ai/dsh-util-workspace-path',
  () => import('@deepseek-ai/dsh-util-workspace-path/src/index.ts'),
)
afterEach(cleanup)

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

it('reads deliveries from real turn projection when nodes are empty', () => {
  const state = snapshot()
  expect(state.nodes.values()).toEqual([])
  expect(resolveDeliverablePath('seq=10&index=0', state)).toBe('/workspace/papers.bib')
  for (const query of [
    'seq=10&index=-1',
    'seq=10&index=0.5',
    'seq=10&index=2',
    'seq=10&index=0&index=1',
    'seq=NaN&index=0',
  ]) {
    expect(resolveDeliverablePath(query, state)).toBeUndefined()
  }
})
it('opens the library for a projected bibliography file', () => {
  const state = snapshot()
  const open = vi.fn()
  render(
    <DeliverableZoteroAction
      actionUrl="seq=10&index=0"
      useChat={(select) => select(state)}
      onOpenLibrary={open}
      t={mockT}
    />,
  )
  fireEvent.click(screen.getByRole('button'))
  expect(open).toHaveBeenCalledOnce()
})
it('does not offer a bibliography action for ordinary JSON', () => {
  expect(isBibliographyDeliverable({ path: 'package.json' })).toBe(false)
  expect(
    isBibliographyDeliverable({ path: 'references.json', description: 'Exported csljson' }),
  ).toBe(true)
  const state = snapshot()
  const { container } = render(
    <DeliverableZoteroAction
      actionUrl="seq=10&index=1"
      useChat={(select) => select(state)}
      t={mockT}
    />,
  )
  expect(container.firstChild).toBeNull()
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
    return () => {
      listeners.delete(listener)
    }
  }
  const useChat = <T,>(select: (snapshot: ChatSnapshot) => T) =>
    select(useSyncExternalStore(subscribe, () => state))
  render(<DeliverableZoteroAction actionUrl="seq=13&index=0" useChat={useChat} t={mockT} />)
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
  expect(resolveDeliverablePath('seq=10&index=0', state)).toBe('/workspace/papers.bib')
  expect(resolveDeliverablePath('seq=13&index=0', state)).toBe('/workspace/late.bib')
})
