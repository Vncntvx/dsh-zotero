// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GetBatchToolView } from '../../../src/client/toolviews/GetBatchToolView.tsx'
import { createToolViewProps, mockUseDisclosure } from '../helpers/mock-disclosure.ts'
import { running, settled } from '../helpers/blocks.ts'
import { mockT } from '../helpers/mock-translate.ts'

afterEach(cleanup)

describe('GetBatchToolView', () => {
  it('renders per-ref successes and failures with the batch summary', () => {
    const block = settled({
      call: {
        name: 'zotero_get_batch',
        argsRaw: JSON.stringify({
          refs: ['zotero://user/0/item/AAAA1111', 'zotero://user/0/item/BBBB2222'],
        }),
      },
      meta: {
        counts: { requested: 2, succeeded: 1, failed: 1 },
        items: [
          {
            ref: 'zotero://user/0/item/AAAA1111',
            status: 'ok',
            title: 'A Paper',
            citationKey: 'paperA',
          },
          {
            ref: 'zotero://user/0/item/BBBB2222',
            status: 'error',
            code: 'ZOTERO_NOT_FOUND',
            message: 'Item not found',
          },
        ],
      },
    })
    render(
      <GetBatchToolView
        {...createToolViewProps({
          toolName: 'zotero_get_batch',
          block,
          useDisclosure: mockUseDisclosure(true),
          t: mockT,
        })}
      />,
    )
    expect(
      screen.getByText(mockT('toolSummaryGetBatchDone', { succeeded: 1, requested: 2, failed: 1 })),
    ).toBeTruthy()
    expect(screen.getByText('A Paper')).toBeTruthy()
    expect(screen.getByText('paperA')).toBeTruthy()
    expect(screen.getByText('Item not found')).toBeTruthy()
  })

  it('fills summary and row fallbacks when metadata is partial', () => {
    const block = settled({
      call: {
        name: 'zotero_get_batch',
        argsRaw: JSON.stringify({
          refs: ['zotero://user/0/item/AAAA1111', 'zotero://user/0/item/BBBB2222'],
        }),
      },
      meta: {
        counts: { succeeded: 1 },
        items: [
          { ref: 'zotero://user/0/item/AAAA1111', status: 'ok', title: 'No citekey' },
          { ref: 'zotero://user/0/item/BBBB2222', title: 'Unknown status' },
          { ref: '', status: 'ok', title: 'Discarded row' },
        ],
      },
    })
    render(
      <GetBatchToolView
        {...createToolViewProps({
          toolName: 'zotero_get_batch',
          block,
          useDisclosure: mockUseDisclosure(true),
          t: mockT,
        })}
      />,
    )
    expect(
      screen.getByText(mockT('toolSummaryGetBatchDone', { succeeded: 1, requested: 2, failed: 0 })),
    ).toBeTruthy()
    expect(screen.getByText(mockT('toolGetBatchRowOk'))).toBeTruthy()
    expect(screen.getByText(mockT('toolGetBatchRowError'))).toBeTruthy()
    expect(screen.queryByText('Discarded row')).toBeNull()
  })

  it('shows raw result text when no structured rows are available', () => {
    const block = settled({
      call: { name: 'zotero_get_batch', argsRaw: '{}' },
      content: [{ type: 'text', text: 'Batch details unavailable' }],
    })
    render(
      <GetBatchToolView
        {...createToolViewProps({
          toolName: 'zotero_get_batch',
          block,
          useDisclosure: mockUseDisclosure(true),
          t: mockT,
        })}
      />,
    )
    expect(screen.getByText('Batch details unavailable')).toBeTruthy()
  })

  it('renders a running notice before the batch returns', () => {
    const block = running({ name: 'zotero_get_batch' })
    render(
      <GetBatchToolView
        {...createToolViewProps({
          toolName: 'zotero_get_batch',
          block,
          useDisclosure: mockUseDisclosure(true),
          t: mockT,
        })}
      />,
    )
    expect(screen.getAllByText(mockT('toolGetBatchRunning'))).toHaveLength(2)
  })
})
