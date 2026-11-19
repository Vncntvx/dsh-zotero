// @vitest-environment jsdom
/**
 * The wide layout opens its third column for a selected row.
 * @module tests/client/library/library-panel-columns
 */
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONNECTED, mountPanel } from '../helpers/library-panel-harness.tsx'
import { zh } from '../../../src/client/locales.ts'

beforeEach(() => localStorage.clear())
afterEach(cleanup)

const detailClosed = (container: HTMLElement): boolean =>
  (container.querySelector('[class*="_columns_"]')?.className ?? '').includes(
    'columnsWithoutDetail',
  )

describe('the detail column follows the selection', () => {
  it('keeps the column closed until a row is selected', async () => {
    const { view } = mountPanel()
    await screen.findByText('FlashAttention-2')
    expect(detailClosed(view.container)).toBe(true)
  })

  it('opens the column for the selected row', async () => {
    const { view } = mountPanel()
    fireEvent.click(await screen.findByText('FlashAttention-2'))
    expect(await screen.findByRole('heading', { name: /FlashAttention-2/ })).toBeDefined()
    expect(detailClosed(view.container)).toBe(false)
  })

  it('keeps the column open while the write drawer applies to the scope', async () => {
    const { view } = mountPanel({
      status: vi.fn(async () => ({
        ok: true,
        value: { ...CONNECTED, write: { enabled: true, alwaysAllow: false } },
      })),
    })
    await screen.findByRole('button', { name: zh.libraryWriteActions })
    expect(detailClosed(view.container)).toBe(false)
  })
})
