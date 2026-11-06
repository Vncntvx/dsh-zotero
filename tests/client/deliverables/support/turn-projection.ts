/**
 * Typed `ChatSnapshot` projection for the deliverables turn-data specs.
 *
 * The upstream `@deepseek-ai/dsh-client-ui-deliverables` plugin publishes the
 * `deliverables` key through `ConversationNodeAssembler` and its private
 * `deliverablesDefinition`. Neither reaches the client lane in a registry-only
 * install: the public `/client` runtime entry is a shell loader bundle, and
 * the `/src/` subtree is not in the published tarball. Building the snapshot
 * here, from the public `ChatSnapshot` / `TurnLocation` /
 * `ConversationTurnDataMap` types, lets the specs exercise the real reader in
 * `DeliverableZoteroAction` against the real published shape without depending
 * on a sibling checkout.
 *
 * The fixture owns no production algorithm. It applies the three durable event
 * forms the reader cares about to an immutable turn timeline, and publishes a
 * new snapshot on `flush()` so `useSyncExternalStore` observers see the append
 * path the upstream engine uses for late deliveries.
 * `turn-data-contract.spec.ts` pins the resulting data shape to the local
 * augmentation, so a change on either side fails typecheck and the spec.
 *
 * @module tests/client/deliverables/support/turn-projection
 */

import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {
  ConversationLocationDataStore,
  ConversationTimelineSnapshot,
  ConversationTurnDataMap,
  TurnLocation,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { PresentedFile } from '@deepseek-ai/dsh-tool-present/types'

type DeliverablesTurnData = ConversationTurnDataMap['deliverables']
type PresentedPath = NonNullable<DeliverablesTurnData['presented']>[number]

/** One durable event the projection applies to its turn timeline. */
export type TurnProjectionEvent =
  | { readonly type: 'turn/start'; readonly seq: number; readonly turn: number }
  | { readonly type: 'turn/end'; readonly seq: number; readonly turn: number }
  | {
      readonly type: 'deliverables/presented'
      readonly seq: number
      readonly turn: number
      readonly files: readonly PresentedFile[]
    }

/** An observable turn timeline that advances only when `flush()` publishes. */
export interface TurnProjection {
  /** Queue one durable event; it becomes visible on the next `flush()`. */
  readonly append: (event: TurnProjectionEvent) => void
  /** Publish the queued events, notify subscribers, and return the new snapshot. */
  readonly flush: () => ChatSnapshot
  /** The latest published snapshot; identity-stable between flushes. */
  readonly snapshot: () => ChatSnapshot
  /** Observe publications; returns the unsubscribe function. */
  readonly subscribe: (listener: () => void) => () => void
}

interface TurnState {
  start: SessionEvent<'turn/start'> | undefined
  end: SessionEvent<'turn/end'> | undefined
  presented: PresentedPath[]
}

/** The empty Chat view the real builder starts from: no nodes, no navigation. */
const EMPTY_SNAPSHOT: ChatSnapshot = {
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

/**
 * One turn's Location-data reader, keyed by the declaration-merged map so the
 * fixture cannot publish a value the production reader's `get` would reject.
 */
function turnLocationOf(turn: number, state: TurnState): TurnLocation {
  const value: DeliverablesTurnData = {
    produced: [],
    ...(state.presented.length > 0 ? { presented: [...state.presented] } : {}),
  }
  const values: {
    [Key in keyof ConversationTurnDataMap]?: Readonly<ConversationTurnDataMap[Key]>
  } = { deliverables: value }
  const data: ConversationLocationDataStore<ConversationTurnDataMap> = {
    get: (key) => values[key],
    source: (key) => {
      const current = values[key]
      return { getSnapshot: () => current, subscribe: () => () => {} }
    },
  }
  return {
    turn,
    start: state.start,
    end: state.end,
    status: state.end !== undefined ? 'closed' : state.start !== undefined ? 'open' : 'unknown',
    steps: [],
    data,
  }
}

function timelineOf(turns: ReadonlyMap<number, TurnState>): ConversationTimelineSnapshot {
  return {
    turnOrder: [...turns.keys()],
    turns: new Map([...turns].map(([turn, state]) => [turn, turnLocationOf(turn, state)])),
  }
}

/**
 * Create a projection seeded with `initial` events, already published.
 * @param initial - the loaded event window, in ascending seq order.
 */
export function turnProjection(initial: readonly TurnProjectionEvent[] = []): TurnProjection {
  const turns = new Map<number, TurnState>()
  const listeners = new Set<() => void>()
  let current: ChatSnapshot = EMPTY_SNAPSHOT

  const stateFor = (turn: number): TurnState => {
    const found = turns.get(turn)
    if (found !== undefined) return found
    const state: TurnState = { start: undefined, end: undefined, presented: [] }
    turns.set(turn, state)
    return state
  }

  const apply = (event: TurnProjectionEvent): void => {
    if (event.type === 'turn/start') {
      stateFor(event.turn).start = {
        seq: SessionSeq(event.seq),
        time: event.seq,
        type: 'turn/start',
        data: { turn: event.turn },
      }
      return
    }
    if (event.type === 'turn/end') {
      stateFor(event.turn).end = {
        seq: SessionSeq(event.seq),
        time: event.seq,
        type: 'turn/end',
        data: { turn: event.turn, reason: { kind: 'completed' } },
      }
      return
    }
    const state = stateFor(event.turn)
    for (const [index, file] of event.files.entries()) {
      state.presented.push({ ...file, seq: event.seq, index })
    }
  }

  const flush = (): ChatSnapshot => {
    current = { ...EMPTY_SNAPSHOT, timeline: timelineOf(turns) }
    for (const listener of [...listeners]) listener()
    return current
  }

  for (const event of initial) apply(event)
  flush()

  return {
    append: apply,
    flush,
    snapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
