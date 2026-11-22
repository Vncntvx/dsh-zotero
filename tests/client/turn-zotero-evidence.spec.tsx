// @vitest-environment jsdom
import type { ChatConversationViewNode, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import {
  TurnZoteroEvidence,
  turnZoteroEvidence,
} from '../../src/client/components/TurnZoteroEvidence.tsx'
import { running, settled } from './helpers/blocks.ts'
import { mockT } from './helpers/mock-translate.ts'
import { chatOf, toolRow } from './helpers/sources-tab-harness.tsx'

const base = 'zotero://user/0/item/PAPER001'
const one = base + '?server=S1'
const two = base + '?server=S2'
const three = 'zotero://group/42/attachment/PDF00001?server=S1'
const urlArtifact = 'b'.repeat(64)
const missed = 'zotero://user/0/item/OTHER001'
const refusal = 'zotero://user/0/item/DENIED01'

function snapshot(answer?: string): ChatSnapshot {
  const rows = [
    toolRow(running({ callId: 'running', name: 'zotero_retrieve' })),
    toolRow(settled({ callId: 'search', meta: { evidenceRefs: [missed] } })),
    toolRow(
      settled({
        callId: 'ptc',
        name: 'run_code',
        subCalls: [
          settled({
            callId: 'search-parsed',
            name: 'zotero_search_parsed',
            meta: { evidenceRefs: [one, two, three, urlArtifact, {}, 'bad'] },
          }),
        ],
      }),
    ),
    toolRow(
      settled({
        callId: 'error',
        name: 'zotero_search_parsed',
        isError: true,
        meta: { evidenceRefs: [refusal] },
      }),
    ),
    toolRow(
      settled({
        callId: 'no-meta',
        name: 'zotero_retrieve',
      }),
    ),
    toolRow(
      settled({
        callId: 'retrieve',
        call: { name: 'zotero_retrieve', argsRaw: JSON.stringify({ ref: missed }) },
        meta: {
          items: [
            { source: 'note', sourceRef: missed, preview: 'Evidence' },
            { source: 'annotation', sourceRef: three, preview: 'Evidence' },
          ],
        },
      }),
    ),
    {
      key: 'tail',
      kind: 'turn-tail',
      data: {
        closing:
          answer === undefined
            ? undefined
            : {
                blocks: [
                  { kind: 'thinking', text: missed },
                  { kind: 'text', text: answer },
                ],
              },
      },
    } as ChatConversationViewNode,
  ]
  const state = chatOf(rows)
  return {
    ...state,
    locations: { getTurn: (turn) => (turn === 1 ? state.order : []), getStep: () => [] },
  }
}

afterEach(cleanup)

it('separates explicit references from retrieval and preserves provider identity', () => {
  const listed = turnZoteroEvidence(
    snapshot(`[${base}] [${three.split('?')[0]}] ${urlArtifact}`),
    1,
  )
  expect(listed).toEqual([
    { ref: one, referenced: false },
    { ref: two, referenced: false },
    { ref: three, referenced: true },
    { ref: urlArtifact, artifactId: urlArtifact, referenced: true },
    { ref: missed, referenced: false },
  ])
  expect(turnZoteroEvidence(snapshot(one), 1)[0]).toEqual({ ref: one, referenced: true })
  expect(turnZoteroEvidence(snapshot(), 1).every((row) => !row.referenced)).toBe(true)
  expect(turnZoteroEvidence(snapshot(one), 2)).toEqual([])
})

it('opens verified targets with permission and renders labels read-only after revocation', () => {
  type Props = Parameters<typeof TurnZoteroEvidence>[0]
  const state = snapshot(one)
  const openRef = vi.fn()
  const openParsed = vi.fn()
  const props = {
    openRef,
    openParsed,
    useChat: ((select, equal) => {
      const value = select(state)
      if (equal && Array.isArray(value) && value.length > 0) {
        expect(equal(value, select(state))).toBe(true)
        expect(equal(value, select(snapshot()))).toBe(false)
        expect(equal(value, select(snapshot(missed)))).toBe(false)
      }
      return value
    }) as Props['useChat'],
    t: mockT,
    turn: { turn: 1 } as Props['turn'],
    sessionId: 's',
    useAccess: () => true,
  } as Props
  const { rerender } = render(<TurnZoteroEvidence {...props} useAccess={() => true} />)
  fireEvent.click(screen.getAllByRole('button', { name: 'PAPER001', hidden: true })[0]!)
  fireEvent.click(screen.getByRole('button', { name: urlArtifact.slice(0, 12), hidden: true }))
  expect(openRef).toHaveBeenCalledWith(one)
  expect(openParsed).toHaveBeenCalledWith('s', urlArtifact, urlArtifact.slice(0, 12))
  rerender(<TurnZoteroEvidence {...props} useAccess={() => false} />)
  expect(screen.queryAllByRole('button', { hidden: true })).toEqual([])
  expect(screen.getByText(urlArtifact.slice(0, 12))).toBeTruthy()
  rerender(<TurnZoteroEvidence {...props} openParsed={undefined} useAccess={() => true} />)
  expect(screen.queryByRole('button', { name: urlArtifact.slice(0, 12), hidden: true })).toBeNull()
  rerender(<TurnZoteroEvidence {...props} turn={{ turn: 2 } as Props['turn']} />)
  expect(screen.queryByText(/turnZoteroEvidence/)).toBeNull()
})

it('uses fulltext targets and ignores an unreadable or empty result', () => {
  const result = (callId: string, facts: unknown) =>
    toolRow(
      settled({ callId, name: 'zotero_retrieve', meta: { mode: 'fulltext', fulltextRead: facts } }),
    )
  const generic = {
    sourceKind: 'attachment',
    textFormat: 'markdown',
    sourceLabel: 'Synthetic paper',
    totalChars: 100,
    start: 0,
    end: 100,
    inputTruncated: false,
    isTruncated: false,
  }
  const rows = [
    result('parent', {
      ...generic,
      item: { ref: one, title: 'Paper', creatorSummary: '' },
      attachmentRef: three,
    }),
    result('attachment-only', { ...generic, attachmentRef: three }),
    result('missing', generic),
    result('invalid', {}),
    result('url', {
      ...generic,
      sourceKind: 'url',
      artifact: {
        artifactId: urlArtifact,
        parser: 'mineru',
        mode: 'free',
        fingerprint: 'a'.repeat(64),
        sourceId: 'c'.repeat(64),
        generation: '11111111-1111-4111-8111-111111111111',
      },
    }),
  ]
  const state = chatOf(rows)
  expect(
    turnZoteroEvidence(
      { ...state, locations: { getTurn: () => state.order, getStep: () => [] } },
      1,
    ),
  ).toEqual([
    { ref: one, referenced: false },
    { ref: three, referenced: false },
    { ref: urlArtifact, artifactId: urlArtifact, referenced: false },
  ])
})

it('recovers attachment and artifact identities from retained passage records', () => {
  const rows = [
    toolRow(settled({ callId: 'empty', name: 'zotero_retrieve', meta: { items: [] } })),
    toolRow(
      settled({
        callId: 'retained',
        name: 'zotero_search_parsed',
        meta: {
          items: [
            {
              source: 'annotation',
              sourceRef: 'note identifier',
              preview: 'Evidence',
              attachmentRef: three,
            },
            {
              source: 'annotation',
              sourceRef: 'unresolved identifier',
              preview: 'Unlinked passage',
            },
            {
              source: 'fulltext',
              sourceRef: 'https://example.com/paper.pdf',
              preview: 'Evidence',
              textFormat: 'markdown',
              artifact: {
                artifactId: urlArtifact,
                parser: 'mineru',
                mode: 'free',
                fingerprint: 'a'.repeat(64),
                sourceId: 'c'.repeat(64),
                generation: '11111111-1111-4111-8111-111111111111',
              },
            },
          ],
        },
      }),
    ),
  ]
  const state = chatOf(rows)
  expect(
    turnZoteroEvidence(
      { ...state, locations: { getTurn: () => state.order, getStep: () => [] } },
      1,
    ),
  ).toEqual([
    { ref: three, referenced: false },
    { ref: urlArtifact, artifactId: urlArtifact, referenced: false },
  ])
})
