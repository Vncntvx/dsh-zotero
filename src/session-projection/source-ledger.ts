/**
 * The literature-trail projection: a pure fold over committed session events
 * that serves the whole trail to the browser without the history window.
 *
 * `apply` records settled Zotero outcomes; `view` freezes the workspace the
 * event fold accumulates. The fold is incremental and its cache is owned by
 * this instance: `apply` extends one {@link SourceWorkspaceIndex} per session
 * state chain, and `view` costs the blocks folded since the last read instead
 * of the whole log. A module-level memo would outlive the registration, so the
 * factory hands back a `dispose` and the service calls it on unload.
 *
 * `evidenceMatch` is left `unknown` here because the connected Server ID is a
 * client probe fact; the browser materializes it with {@link withEvidenceMatch}.
 * @module dsh-zotero/session-projection/source-ledger
 */

import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
// Type-only: installs the `zoteroSources` entry in the shared projection map.
import type {} from './types.js'
import {
  emptyLedgerState,
  foldLedgerEvent,
  pendingBlocksOf,
  settledBlockOf,
  type SourceLedgerProjectionState,
  type SourceLedgerState,
} from '../sources/event-ledger.js'
import { SourceWorkspaceIndex } from '../sources/ledger.js'
import type { SourceWorkspace } from '../sources/model.js'
import { sourceWorkspaceSchema } from '../sources/workspace-schema.js'

/** The projection key the browser reads. */
export const SOURCE_LEDGER_KEY = 'zoteroSources'

const blockFactSchema = z
  .object({
    callId: z.string().min(1),
    seq: z.number().int().nonnegative(),
    time: z.number(),
    name: z.string().min(1),
    argsRaw: z.string(),
    callTime: z.number(),
    content: z.array(z.json()),
    isError: z.boolean(),
    error: z
      .object({ name: z.string(), code: z.string(), reason: z.string().optional() })
      .strict()
      .optional(),
    meta: z.json().optional(),
  })
  .strict()

const pendingCallSchema = z
  .object({
    callId: z.string().min(1),
    name: z.string().min(1),
    argsRaw: z.string(),
    seq: z.number().int().nonnegative(),
    time: z.number(),
  })
  .strict()

const ledgerStateSchema = z
  .object({
    blocks: z.array(blockFactSchema),
    pending: z.record(z.string(), pendingCallSchema),
    // The recorded callIds the fold dedupes against; see SourceLedgerState.
    recorded: z.record(z.string(), z.literal(true)),
  })
  .strict()

const stateSchema = z
  .object({
    inheritedEventCount: z.number().int().nonnegative(),
    ledger: ledgerStateSchema,
  })
  .strict()

type SourceLedgerProjectionDefinition = Omit<
  ProjectionDefinition<typeof SOURCE_LEDGER_KEY, SourceLedgerProjectionState>,
  'wire'
> & {
  readonly wire: {
    readonly viewSchema: typeof sourceWorkspaceSchema
    readonly view: (state: SourceLedgerProjectionState) => SourceWorkspace
    readonly summary: false
  }
}

/** One session's incremental fold and the number of folded blocks it covers. */
interface LedgerChain {
  readonly index: SourceWorkspaceIndex
  readonly applied: number
}

/** The literature-trail projection together with the fold cache it owns. */
export interface SourceLedgerProjection {
  readonly definition: SourceLedgerProjectionDefinition
  /**
   * The complete (unwindowed) workspace at one state, shared with the wire
   * view: two reads of the same state return the same object.
   * @param state - the projection state to read.
   * @param currentServerId - the connected instance's Server ID, when known.
   * @returns the aggregated workspace over the full fold.
   */
  fullWorkspaceOf(state: SourceLedgerProjectionState, currentServerId?: string): SourceWorkspace
  /**
   * Drop every cached fold and view. The definition stays usable: the next
   * read rebuilds once from the state it is handed.
   */
  dispose(): void
}

/**
 * Create the literature-trail projection and the fold cache it owns.
 *
 * Fork-inherited events are folded like any other: a forked session's trail is
 * the history its user can see. `stateVersion` stays 1 because the fold cache
 * is not part of the state — the persisted shape and every fold rule are
 * unchanged.
 * @returns the definition to register, plus the full-view reader and the disposer.
 */
export function createSourceLedgerProjection(): SourceLedgerProjection {
  /**
   * The fold cache: one chain per state the harness handed back. A state that
   * this instance never folded (a restored checkpoint, or one whose index
   * moved past it) is rebuilt from its own blocks once, then keeps folding, so
   * a cold or interleaved read is linear instead of wrong.
   */
  let chains = new WeakMap<SourceLedgerProjectionState, LedgerChain>()

  const currentChain = (state: SourceLedgerProjectionState): LedgerChain | undefined => {
    const chain = chains.get(state)
    if (chain === undefined) return undefined
    if (chain.applied !== state.ledger.blocks.length) return undefined
    if (chain.index.applied !== chain.applied) return undefined
    return chain
  }

  const chainOf = (state: SourceLedgerProjectionState): LedgerChain => {
    const current = currentChain(state)
    if (current !== undefined) return current
    const index = new SourceWorkspaceIndex()
    for (const fact of state.ledger.blocks) index.apply(settledBlockOf(fact))
    const rebuilt: LedgerChain = { index, applied: index.applied }
    chains.set(state, rebuilt)
    return rebuilt
  }

  const read = (
    state: SourceLedgerProjectionState,
    currentServerId: string | undefined,
    windowed: boolean,
  ): SourceWorkspace =>
    chainOf(state).index.workspace(pendingBlocksOf(state.ledger), {
      ...(currentServerId === undefined ? {} : { currentServerId }),
      windowed,
    })

  const definition: SourceLedgerProjectionDefinition = {
    key: SOURCE_LEDGER_KEY,
    stateVersion: 1,
    stateSchema,
    init: (_header, inheritedEventCount) => {
      const state: SourceLedgerProjectionState = {
        inheritedEventCount,
        ledger: emptyLedgerState() satisfies SourceLedgerState,
      }
      chains.set(state, { index: new SourceWorkspaceIndex(), applied: 0 })
      return state
    },
    apply: (state, event) => {
      const ledger = foldLedgerEvent(state.ledger, event)
      if (ledger === state.ledger) return state
      const next = { ...state, ledger }
      const chain = currentChain(state)
      if (chain !== undefined) {
        for (let index = chain.applied; index < ledger.blocks.length; index += 1) {
          chain.index.apply(settledBlockOf(ledger.blocks[index]!))
        }
        chains.set(next, { index: chain.index, applied: ledger.blocks.length })
      }
      return next
    },
    wire: {
      summary: false,
      viewSchema: sourceWorkspaceSchema,
      view: (state) => read(state, undefined, true),
    },
  }

  return {
    definition,
    fullWorkspaceOf: (state, currentServerId) => read(state, currentServerId, false),
    dispose: () => {
      chains = new WeakMap()
    },
  }
}
