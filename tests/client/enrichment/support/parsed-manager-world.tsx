/**
 * Shared world for the parsed-document manager specs: one committed attachment
 * artifact, one stubbed management transport, and the props a tab entry needs.
 * @module tests/client/enrichment/support/parsed-manager-world
 */

import { render, screen } from '@testing-library/react'
import { expect, vi } from 'vitest'
import {
  ParsedManagerTab,
  type ParsedManagerTabProps,
} from '../../../../src/client/enrichment/ParsedManagerTab.tsx'
import { parsedManagerTabAddress } from '../../../../src/client/parsed-manager-tab.ts'
import { en } from '../../../../src/client/locales.ts'
import type {
  ZoteroDiscardParsedDocumentResultView,
  ZoteroListParsedDocumentsResultView,
  ZoteroParsedDocumentRowView,
} from '../../../../src/contract.ts'
import { makeTranslate } from '../../helpers/mock-translate.ts'

export const SESSION = 's1'
export const ID = 'a'.repeat(64)
export const SECOND_ID = 'b'.repeat(64)
export const TITLE = 'Attention Is All You Need'
export const SECOND_TITLE = 'Attention Sinks'

export const row: ZoteroParsedDocumentRowView = {
  artifactId: ID,
  state: 'indexed',
  sourceKind: 'attachment',
  title: TITLE,
  targetLabel: 'zotero://user/0/item/ABC/attachment/DEF',
  mode: 'free',
  generation: '11111111-1111-4111-8111-111111111111',
  fingerprint: 'f'.repeat(64),
  characterCount: 1200,
  pageCount: 7,
  images: [{ name: 'images/f.png', mediaType: 'image/png', bytes: 10 }],
  markdownBytes: 1200,
  committedAt: 1_700_000_000_000,
  aliases: [ID],
  actionable: true,
}

export const secondRow: ZoteroParsedDocumentRowView = {
  ...row,
  artifactId: SECOND_ID,
  title: SECOND_TITLE,
  aliases: [SECOND_ID],
}

export type ListResult =
  { ok: true; value: ZoteroListParsedDocumentsResultView } | { ok: false; error: Error }
export type DiscardResult =
  { ok: true; value: ZoteroDiscardParsedDocumentResultView } | { ok: false; error: Error }

export const DISCARDED: DiscardResult = {
  ok: true,
  value: { kind: 'discarded', removedAliases: 1, removedReceipts: 0 },
}
export const MISSING: DiscardResult = { ok: true, value: { kind: 'missing' } }

export function listOf(
  rows: readonly ZoteroParsedDocumentRowView[],
  total = rows.length,
): ListResult {
  return { ok: true, value: { rows, total } }
}

export interface WorldOptions {
  readonly list?: ListResult
  /** A first page the spec settles itself, for the loading state. */
  readonly pendingList?: () => Promise<ListResult>
  readonly discard?: DiscardResult
  /** Discard answers consumed in order; the last one repeats. */
  readonly discards?: readonly DiscardResult[]
  readonly mounted?: boolean
  readonly listAllowed?: boolean
  /** List answers consumed in order; the last one repeats. */
  readonly lists?: readonly ListResult[]
  /** A discard the spec settles itself, for the abort paths. */
  readonly discardImpl?: (
    request: { readonly sessionId: string; readonly artifactId: string },
    signal?: AbortSignal,
  ) => Promise<DiscardResult>
}

/** Render the tab over a stubbed transport and return the handles specs assert on. */
export function world(options: WorldOptions = {}) {
  let listIndex = 0
  let discardIndex = 0
  const management = {
    listParsedDocuments: vi.fn(async () => {
      if (options.lists !== undefined) {
        const answer = options.lists[Math.min(listIndex, options.lists.length - 1)]
        listIndex += 1
        return answer ?? listOf([row])
      }
      return options.pendingList === undefined
        ? (options.list ?? listOf([row]))
        : await options.pendingList()
    }),
    discardParsedDocument: vi.fn(
      async (
        request: { readonly sessionId: string; readonly artifactId: string },
        signal?: AbortSignal,
      ) => {
        if (options.discardImpl !== undefined) return await options.discardImpl(request, signal)
        const answers = options.discards
        if (answers === undefined) return options.discard ?? DISCARDED
        const answer = answers[Math.min(discardIndex, answers.length - 1)] ?? DISCARDED
        discardIndex += 1
        return answer
      },
    ),
  }
  const deployment = { mounted: options.mounted ?? true }
  const parse = {
    deployment: { subscribe: () => () => {}, getSnapshot: () => deployment },
    remote: {},
    jobs: {},
    recall: () => undefined,
    recentUrl: () => undefined,
    clearSession: () => {},
  }
  const openParsed = vi.fn()
  const discarded = vi.fn()
  const props = {
    t: makeTranslate(en),
    useAccess: (method: string) =>
      options.listAllowed === false ? method !== 'zotero/listParsedDocuments' : true,
    useSession: () => false,
    useTabInfo: () => ({
      tab: { navigation: { address: parsedManagerTabAddress({ sessionId: SESSION }), params: {} } },
    }),
    management,
    parse,
    openParsed,
    discarded,
  } as unknown as ParsedManagerTabProps
  const rendered = render(<ParsedManagerTab {...props} />)
  return { management, openParsed, discarded, unmount: rendered.unmount }
}

/**
 * Wait until the surface is no longer busy: every control that a request locks
 * unlocks together, and the refresh control is the cheapest one to read.
 */
export async function waitForIdle(): Promise<void> {
  await vi.waitFor(() => {
    const refresh = screen.getByRole('button', {
      name: en.parsedManagerRefresh,
    }) as HTMLButtonElement
    expect(refresh.disabled).toBe(false)
  })
}

/** The rendered inventory list, scoped away from the filter control's labels. */
export function listRegion(): HTMLElement {
  return screen.getByRole('list')
}
