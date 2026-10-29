// @vitest-environment jsdom
/**
 * The panel's citation-copy path end to end: selecting a library row and
 * pressing "copy citation" sends that row's ref to the panel's export face and
 * writes the returned citation text through the clipboard leaf.
 * @module tests/client/library/library-citation-copy
 */

import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountPanel } from '../helpers/library-panel-harness.tsx'
import { zh } from '../../../src/client/locales.ts'

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  // Fake timers defeat the automatic cleanup scheduling; drop the tree now.
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the inspector copies citations through the panel export face', () => {
  it('sends the selected ref to the export face and copies the returned format', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { face } = mountPanel({
      export: vi.fn(async () => ({
        ok: true,
        value: {
          format: 'bibtex',
          text: '@article{dao2023flashattention,}',
        },
      })),
    })
    const row = await screen.findByText('FlashAttention-2')
    act(() => {
      row.click()
    })
    fireEvent.click(await screen.findByRole('button', { name: zh.libraryCitationMenu }))
    const copy = await screen.findByRole('menuitem', { name: zh.libraryCopyBibtex })
    act(() => {
      copy.click()
    })
    await waitFor(() => {
      expect(face.export).toHaveBeenCalledWith({
        refs: ['zotero://user/0/item/ITEM0001'],
        format: 'bibtex',
      })
      expect(writeText).toHaveBeenCalledWith('@article{dao2023flashattention,}')
    })
  })
})
