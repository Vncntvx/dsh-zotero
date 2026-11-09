/**
 * The literature-trail projection: a pure fold over committed session events
 * that serves the whole trail to the browser without the history window.
 *
 * `apply` records settled Zotero outcomes; `view` replays them through the one
 * workspace builder. `evidenceMatch` is left `unknown` here because the
 * connected Server ID is a client probe fact; the browser materializes it with
 * {@link withEvidenceMatch}.
 * @module dsh-zotero/session-projection/source-ledger
 */

import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
// Type-only: installs the `zoteroSources` entry in the shared projection map.
import type {} from './types.js'
import {
  emptyLedgerState,
  foldLedgerEvent,
  workspaceOf,
  type SourceLedgerProjectionState,
  type SourceLedgerState,
} from '../sources/event-ledger.js'
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

const workspaceCache = new WeakMap<SourceLedgerState, SourceWorkspace>()

function memoizedWorkspaceOf(ledger: SourceLedgerState): SourceWorkspace {
  const cached = workspaceCache.get(ledger)
  if (cached !== undefined) return cached
  const workspace = workspaceOf(ledger)
  workspaceCache.set(ledger, workspace)
  return workspace
}

/**
 * The literature trail as a host projection. Fork-inherited events are folded:
 * a forked session's trail is the history its user can see.
 */
export const sourceLedgerProjection: SourceLedgerProjectionDefinition = {
  key: SOURCE_LEDGER_KEY,
  stateVersion: 1,
  stateSchema,
  init: (_header, inheritedEventCount) => ({
    inheritedEventCount,
    ledger: emptyLedgerState() satisfies SourceLedgerState,
  }),
  apply: (state, event) => {
    const ledger = foldLedgerEvent(state.ledger, event)
    return ledger === state.ledger ? state : { ...state, ledger }
  },
  wire: {
    summary: false,
    viewSchema: sourceWorkspaceSchema,
    view: (state) => memoizedWorkspaceOf(state.ledger),
  },
}
