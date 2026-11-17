// @vitest-environment jsdom
/** Composite receipts show completed, failed and unverified counts in both card states. */
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { WriteToolView } from '../../../src/client/toolviews/WriteToolView.tsx'
import { createToolViewProps, mockUseDisclosure } from '../helpers/mock-disclosure.ts'
import { settled } from '../helpers/blocks.ts'
import { zh } from '../../../src/client/locales.ts'

afterEach(cleanup)

it.each([
  { kind: 'applied', created: 2, failed: 0, unverified: 0, tone: 'success' },
  { kind: 'partial', created: 1, failed: 2, unverified: 1, tone: 'warning' },
  { kind: 'failed', created: 0, failed: 5, unverified: 0, tone: 'danger' },
  { kind: 'partial', created: 0, failed: 0, unverified: 3, tone: 'warning' },
])(
  'reports a $kind batch from actual receipt counts',
  ({ kind, created, failed, unverified, tone }) => {
    const block = settled({
      call: {
        name: 'zotero_batch_items',
        argsRaw: JSON.stringify({ create: Array(9).fill({ title: 'Requested' }) }),
      },
      meta: {
        kind,
        createdCount: created,
        updatedCount: 0,
        deletedCount: 0,
        failedCount: failed,
        unverifiedCount: unverified,
      },
      content: [{ type: 'text', text: 'Per-item receipts' }],
    })
    const view = render(
      <WriteToolView
        {...createToolViewProps({
          toolName: 'zotero_batch_items',
          block,
          useDisclosure: mockUseDisclosure(false),
        })}
      />,
    )
    expect(view.container.textContent).toContain(`已新建 ${created} 项`)
    expect(view.container.textContent).toContain(`失败 ${failed} 项`)
    expect(view.container.textContent).toContain(`未核验 ${unverified} 项`)
    view.rerender(
      <WriteToolView {...createToolViewProps({ toolName: 'zotero_batch_items', block })} />,
    )
    expect(view.container.querySelector(`[data-tone="${tone}"]`)).not.toBeNull()
    if (tone !== 'success') expect(view.container.querySelector('[data-tone="success"]')).toBeNull()
  },
)

it.each([
  { kind: 'restored', restored: 1, failed: 0, unverified: 0, alreadyPresent: 0, tone: 'success' },
  { kind: 'partial', restored: 1, failed: 1, unverified: 0, alreadyPresent: 0, tone: 'warning' },
  { kind: 'partial', restored: 0, failed: 0, unverified: 1, alreadyPresent: 0, tone: 'warning' },
  { kind: 'failed', restored: 0, failed: 2, unverified: 0, alreadyPresent: 0, tone: 'danger' },
  { kind: 'restored', restored: 0, failed: 0, unverified: 0, alreadyPresent: 2, tone: 'info' },
])(
  'preserves a $kind restore receipt and distinguishes already-live items',
  ({ kind, restored, failed, unverified, alreadyPresent, tone }) => {
    const block = settled({
      call: { name: 'zotero_restore_items', argsRaw: '{}' },
      meta: {
        kind,
        restoredCount: restored,
        failedCount: failed,
        unverifiedCount: unverified,
        alreadyPresentCount: alreadyPresent,
      },
      content: [{ type: 'text', text: 'Per-item restore receipts' }],
    })
    const { container } = render(
      <WriteToolView {...createToolViewProps({ toolName: 'zotero_restore_items', block })} />,
    )
    expect(container.querySelector(`[data-tone="${tone}"]`)).not.toBeNull()
    expect(container.textContent).toContain(`原本正常 ${alreadyPresent} 项`)
    if (alreadyPresent > 0) expect(container.textContent).toContain(zh.badgeNoOp)
  },
)
