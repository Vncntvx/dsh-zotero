// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MatchReferencesToolView } from '../../../src/client/toolviews/MatchReferencesToolView.tsx'
import { createToolViewProps, mockUseDisclosure } from '../helpers/mock-disclosure.ts'
import { running, settled } from '../helpers/blocks.ts'
import { mockT } from '../helpers/mock-translate.ts'

afterEach(cleanup)

describe('MatchReferencesToolView', () => {
  it('renders matched refs and surfaces a citekey conflict for review', () => {
    const block = settled({
      call: {
        name: 'zotero_match_references',
        argsRaw: JSON.stringify({ references: [{ inputId: 'entry-1' }] }),
      },
      meta: {
        items: [
          {
            inputId: 'entry-1',
            status: 'conflict',
            reason: 'Review the citation-key source conflict.',
            candidates: [
              {
                ref: 'zotero://user/0/item/ABCD1234',
                title: 'A Paper',
                citationKey: 'nativeKey',
                exportKey: 'exportKey',
                matchMethod: 'doi',
                confidence: 'high',
                citationKeyConflict: { native: 'nativeKey', extra: 'oldKey' },
              },
            ],
          },
        ],
      },
    })
    render(
      <MatchReferencesToolView
        {...createToolViewProps({
          toolName: 'zotero_match_references',
          block,
          useDisclosure: mockUseDisclosure(true),
          t: mockT,
        })}
      />,
    )
    expect(
      screen.getByText(mockT('toolSummaryMatchReferences', { matched: 0, input: 1 })),
    ).toBeTruthy()
    expect(screen.getByText('entry-1')).toBeTruthy()
    expect(screen.getByText(/citationKey=nativeKey/)).toBeTruthy()
    expect(
      screen.getByText(mockT('toolCitationKeyConflict', { native: 'nativeKey', extra: 'oldKey' })),
    ).toBeTruthy()
    expect(screen.getByText('Review the citation-key source conflict.')).toBeTruthy()
  })

  it('renders selected candidates with optional facts omitted', () => {
    const block = settled({
      call: {
        name: 'zotero_match_references',
        argsRaw: JSON.stringify({}),
      },
      meta: {
        items: [
          {
            inputId: 'entry-2',
            status: 'matched',
            selected: { title: 'Selected paper', matchMethod: 'title' },
          },
          { reason: 'Malformed row without an input id.' },
        ],
      },
      content: [{ type: 'text', text: 'Raw match payload' }],
    })
    render(
      <MatchReferencesToolView
        {...createToolViewProps({
          toolName: 'zotero_match_references',
          block,
          useDisclosure: mockUseDisclosure(true),
          t: mockT,
        })}
      />,
    )
    expect(
      screen.getByText(mockT('toolSummaryMatchReferences', { matched: 1, input: 2 })),
    ).toBeTruthy()
    expect(screen.getByText('entry-2')).toBeTruthy()
    expect(screen.getByText(/Selected paper/)).toBeTruthy()
    expect(screen.getByText('Raw match payload')).toBeTruthy()
    expect(screen.queryByText('Malformed row without an input id.')).toBeNull()
  })

  it('uses the complete matched count when only the first result rows are projected', () => {
    const block = settled({
      call: {
        name: 'zotero_match_references',
        argsRaw: JSON.stringify({
          references: Array.from({ length: 25 }, (_, index) => ({ inputId: `entry-${index}` })),
        }),
      },
      meta: {
        requested: 25,
        matched: 5,
        omitted: 5,
        items: Array.from({ length: 20 }, (_, index) => ({
          inputId: `entry-${index}`,
          status: 'notFound',
        })),
      },
    })
    render(
      <MatchReferencesToolView
        {...createToolViewProps({
          toolName: 'zotero_match_references',
          block,
          useDisclosure: mockUseDisclosure(true),
          t: mockT,
        })}
      />,
    )
    expect(
      screen.getByText(mockT('toolSummaryMatchReferences', { matched: 5, input: 25 })),
    ).toBeTruthy()
  })

  it('shows the empty-result state and raw fallback when no match rows arrive', () => {
    const empty = settled({
      call: { name: 'zotero_match_references', argsRaw: JSON.stringify({ references: [] }) },
      meta: { items: [] },
    })
    const { unmount } = render(
      <MatchReferencesToolView
        {...createToolViewProps({
          toolName: 'zotero_match_references',
          block: empty,
          useDisclosure: mockUseDisclosure(true),
          t: mockT,
        })}
      />,
    )
    expect(screen.getByText(mockT('toolMatchCandidatesEmpty'))).toBeTruthy()
    unmount()

    const raw = settled({
      call: { name: 'zotero_match_references', argsRaw: '{}' },
      content: [{ type: 'text', text: 'Unstructured match result' }],
    })
    render(
      <MatchReferencesToolView
        {...createToolViewProps({
          toolName: 'zotero_match_references',
          block: raw,
          useDisclosure: mockUseDisclosure(true),
          t: mockT,
        })}
      />,
    )
    expect(screen.getByText('Unstructured match result')).toBeTruthy()
  })

  it('shows a running notice while local matching is in progress', () => {
    const block = running({ name: 'zotero_match_references' })
    render(
      <MatchReferencesToolView
        {...createToolViewProps({
          toolName: 'zotero_match_references',
          block,
          useDisclosure: mockUseDisclosure(true),
          t: mockT,
        })}
      />,
    )
    expect(screen.getAllByText(mockT('toolMatchReferencesRunning'))).toHaveLength(2)
  })
})
