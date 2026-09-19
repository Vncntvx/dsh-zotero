/**
 * The SourcesTab specs' shared fixtures and mount: the two status views the
 * connectivity strip renders, the chat-row and session builders the collectors
 * read, the settled tool results the source workspace is built from, and
 * `mountTab` — the tab mounted with stubbed session/chat hooks and a scripted
 * status face. `SourcesTab.helpers`, `.states` and `.interaction` share this
 * one copy instead of carrying three drifting sets.
 * @module tests/client/helpers/sources-tab-harness
 */

import { render } from '@testing-library/react'
import type { ChatConversationViewNode, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import { vi, type Mock } from 'vitest'
import type { ZoteroStatusView } from '../../../src/client/remote.ts'
import { SourcesTab, type SourcesTabProps } from '../../../src/client/components/SourcesTab.tsx'
import { settled } from './blocks.ts'
import { mockT } from './mock-translate.ts'

/** A connected probe result: the note plus the facts the diagnostic menu shows. */
export const CONNECTED: ZoteroStatusView = {
  providerId: 'local',
  connected: true,
  apiVersion: '3',
  schemaVersion: '37',
  serverId: 'sPMHtLD6HHBd',
  diagnosis: 'ok',
}

/** The refused probe: a diagnosis line, no instance facts. */
export const UNAVAILABLE: ZoteroStatusView = {
  providerId: 'local',
  connected: false,
  diagnosis: 'connection refused',
}

/** The probe face the specs script; loose, so a test spy stays assignable. */
export type StatusProbe = () => Promise<{ ok: boolean; value?: unknown; error?: unknown }>

/**
 * A probe answering the connected status. Tests that re-probe chain
 * `mockResolvedValueOnce` on the returned spy, and tests that assert on the
 * probe's call count read it back from the same spy.
 */
export function connectedProbe(): Mock<StatusProbe> {
  return vi.fn<StatusProbe>(async () => ({ ok: true, value: CONNECTED }))
}

/** A chat tool-call row carrying one root block; the collectors read kind/visibility/data.root. */
export function toolRow(
  root: ToolCallBlock,
  visibility: 'visible' | 'hidden' = 'visible',
): ChatConversationViewNode {
  return {
    id: `tool:${root.callId}`,
    key: `tool:${root.callId}`,
    target: 'chat',
    anchorSeq: 0,
    location: {} as never,
    visibility,
    kind: 'tool-call',
    data: { root },
  } as ChatConversationViewNode
}

/**
 * A chat snapshot whose node store carries the given rows; the other faces
 * stay opaque. Implements both `order` (presentation order) and `get`, the
 * two faces the collectors read. `values` mirrors the same rows for store
 * shape completeness (the harness `ChatNodeStore` always provides it); the
 * production collector never reads it, and the order-vs-values test above
 * locks that in.
 */
export function chatOf(rows: ChatConversationViewNode[] = []): ChatSnapshot {
  const keys = rows.map((row, index) => (row.key ?? `row-${index}`) as string)
  const byKey = new Map<string, ChatConversationViewNode>()
  rows.forEach((row, index) => {
    byKey.set(keys[index]!, row)
  })
  const nodes = {
    get: (key: string) => byKey.get(key),
    values: () => rows,
  } as unknown as ChatSnapshot['nodes']
  return {
    order: keys,
    nodes,
    locations: {} as ChatSnapshot['locations'],
    navigation: {} as ChatSnapshot['navigation'],
    timeline: {} as ChatSnapshot['timeline'],
    legacy: {} as ChatSnapshot['legacy'],
  }
}

/** A lifecycle session snapshot with neutral defaults; carry sessionId here. */
export function sessionOf(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    sessionId: 's1' as unknown as SessionSnapshot['sessionId'],
    pendingSubmissions: [],
    running: false,
    subagent: null,
    removed: false,
    openState: 'open',
    openError: null,
    hasMore: false,
    loadingOlder: false,
    promptError: null,
    blank: false,
    lastAgentError: null,
    promptAttempted: false,
    awaitingFirstTurn: false,
    ...overrides,
  }
}

/** A settled zotero_search result carrying one row. */
export function searchResult(overrides: Partial<ToolResultNode> = {}): ToolResultNode {
  return settled({
    seq: 3,
    callId: 'r1',
    call: { name: 'zotero_search', argsRaw: '{"query":"attention"}' },
    meta: {
      returned: 1,
      total: 1,
      displayed: 1,
      omitted: 0,
      items: [
        {
          ref: 'zotero://user/0/item/AAAAAAA1',
          title: 'FlashAttention-2',
          creatorSummary: 'Dao',
          year: 2023,
          itemType: 'conferencePaper',
        },
      ],
    },
    ...overrides,
  })
}

/** A settled zotero_retrieve on the standard item ref, carrying one passage. */
export function retrieveOf(): ToolResultNode {
  return settled({
    seq: 4,
    callId: 'rv1',
    call: { name: 'zotero_retrieve', argsRaw: '{"ref":"zotero://user/0/item/AAAAAAA1"}' },
    meta: {
      count: 1,
      sources: ['annotation'],
      truncated: false,
      sourcesSkipped: [],
      items: [
        {
          source: 'annotation',
          sourceRef: 'zotero://user/0/annotation/ANN1',
          preview: 'claim',
          previewTruncated: false,
          pageLabel: '7',
        },
      ],
    },
  })
}

/** A settled zotero_export of the standard ref as bibtex. */
export function exportOf(): ToolResultNode {
  return settled({
    seq: 4,
    callId: 'e1',
    call: {
      name: 'zotero_export',
      argsRaw: '{"refs":["zotero://user/0/item/AAAAAAA1"],"format":"bibtex"}',
    },
    meta: {
      format: 'bibtex',
      requested: 1,
      refs: ['zotero://user/0/item/AAAAAAA1'],
      refsOmitted: 0,
    },
    content: [{ type: 'text', text: '@book{x}' }],
  })
}

/** Render the tab with stubbed session/chat hooks and the status face. */
export function mountTab(
  chat: ChatSnapshot | undefined,
  status: StatusProbe,
  inputActions?: { setDraft: (text: string) => void },
  session: SessionSnapshot | undefined = sessionOf(),
): { view: ReturnType<typeof render> } {
  const props = {
    t: mockT,
    status,
    useSession: (sel: (snap: SessionSnapshot) => unknown) =>
      session === undefined ? undefined : sel(session),
    useChat: (sel: (snap: ChatSnapshot) => unknown) => (chat === undefined ? undefined : sel(chat)),
    ...(inputActions === undefined ? {} : { inputActions }),
  } as unknown as SourcesTabProps
  const view = render(<SourcesTab {...props} />)
  return { view }
}
