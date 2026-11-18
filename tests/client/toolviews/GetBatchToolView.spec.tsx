// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GetBatchToolView } from '../../../src/client/toolviews/GetBatchToolView.tsx'
import { createToolViewProps, mockUseDisclosure } from '../helpers/mock-disclosure.ts'
import { running, settled } from '../helpers/blocks.ts'
import { mockT } from '../helpers/mock-translate.ts'
import { projectGetBatchMeta } from '../../../src/presentation-meta.ts'

afterEach(cleanup)

describe('GetBatchToolView', () => {
  it('shows the omitted rows and keeps the canonical result available after projection', () => {
    const items = Array.from({ length: 25 }, (_, index) => ({
      ref: `zotero://user/0/item/TEST${String(index).padStart(4, '0')}`,
      status: 'error' as const,
      code: 'ZOTERO_NOT_FOUND',
      message: 'Not found',
    }))
    const block = settled({
      call: {
        name: 'zotero_get_batch',
        argsRaw: JSON.stringify({ refs: items.map(({ ref }) => ref) }),
      },
      meta: projectGetBatchMeta({ counts: { requested: 25, succeeded: 0, failed: 25 }, items }),
      content: [{ type: 'text', text: 'Full batch result' }],
    })
    const { container } = render(
      <GetBatchToolView
        {...createToolViewProps({
          toolName: 'zotero_get_batch',
          block,
          useDisclosure: mockUseDisclosure(true),
          t: mockT,
        })}
      />,
    )
    expect(container.querySelectorAll('[data-batch-row]')).toHaveLength(20)
    expect(screen.getByText(mockT('omittedRowsNote', { count: 5 }))).toBeTruthy()
    expect(screen.getByText('Full batch result')).toBeTruthy()
  })

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
    expect(screen.getByText(mockT('toolSummaryGetBatch', { requested: 2 }))).toBeTruthy()
    expect(screen.getAllByText(mockT('toolGetBatchRowOk'))).toHaveLength(1)
    expect(screen.queryByText(mockT('toolGetBatchRowError'))).toBeNull()
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
