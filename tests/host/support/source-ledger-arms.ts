/**
 * Shared fixtures for the literature-trail arm specs: the ref builder, the
 * settled and running block factories, the one-row search projection, the
 * one-search index, and the raw-event fold the event-ledger defensive cases
 * read. Only the two `source-*-arms` specs use them.
 * @module tests/host/support/source-ledger-arms
 */

import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import type { RunningToolBlock, SettledToolBlock } from '../../../src/sources/block-types.js'
import {
  emptyLedgerState,
  foldLedgerEvent,
  type SourceLedgerState,
} from '../../../src/sources/event-ledger.js'
import { SourceWorkspaceIndex } from '../../../src/sources/ledger.js'

/** One item ref in the specs' spelling. */
export const REF = (key: string, serverId?: string): string =>
  `zotero://user/0/item/${key}${serverId === undefined ? '' : `?server=${serverId}`}`

/** One attachment ref the PDF and best-attachment arms attribute. */
export const ATTACHMENT_REF = 'zotero://user/0/attachment/ATTACH01'

/** The search projection one settled `zotero_search` carries for these rows. */
export function searchMetaOf(
  rows: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    returned: rows.length,
    total: rows.length,
    displayed: rows.length,
    omitted: 0,
    items: rows.map((row) => ({ title: 'Paper', creatorSummary: 'Creator', year: 2020, ...row })),
  }
}

/** One settled block with JSON arguments and an optional presentation projection. */
export function settledBlock(
  callId: string,
  name: string,
  args: Record<string, unknown>,
  meta: unknown,
  seq: number,
  content: SettledToolBlock['content'] = [],
): SettledToolBlock {
  const argsRaw = JSON.stringify(args)
  return {
    kind: 'tool-result',
    seq,
    time: seq * 1000,
    callId,
    name,
    args: PartialArguments.fromText(argsRaw),
    call: { name, argsRaw },
    callTime: seq * 1000,
    content,
    isError: false,
    meta,
    subCalls: [],
  }
}

/** One dispatched call whose result has not landed. */
export function runningBlock(
  callId: string,
  name: string,
  args: Record<string, unknown>,
): RunningToolBlock {
  return {
    phase: 'start',
    callId,
    name,
    args: PartialArguments.fromText(JSON.stringify(args)),
    subCalls: [],
  }
}

/** One index over a settled search for the given rows. */
export function searchIndex(rows: ReadonlyArray<Record<string, unknown>>): SourceWorkspaceIndex {
  const index = new SourceWorkspaceIndex()
  index.apply(settledBlock('s1', 'zotero_search', { query: 'attention' }, searchMetaOf(rows), 1))
  return index
}

/** Fold raw event-shaped records; malformed records are the subject of some cases. */
export function foldEvents(
  events: readonly unknown[],
  state: SourceLedgerState = emptyLedgerState(),
): SourceLedgerState {
  return events.reduce<SourceLedgerState>(
    (current, entry) => foldLedgerEvent(current, entry as never),
    state,
  )
}
