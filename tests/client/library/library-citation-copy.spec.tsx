// @vitest-environment jsdom
/**
 * The panel's citation-copy path end to end: selecting a library row and
 * pressing "copy citation" sends that row's ref to the panel's export face and
 * writes the returned citation text through the clipboard leaf.
 * @module tests/client/library/library-citation-copy
 */

import { act, cleanup, screen, waitFor } from '@testing-library/react'
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
  it('sends the selected ref to the export face and copies the returned citation', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { face } = mountPanel({
      export: vi.fn(async () => ({
        ok: true,
        value: {
          format: 'citation',
          citations: [{ ref: 'zotero://user/0/item/ITEM0001', text: 'Dao, T. (2023).' }],
        },
      })),
    })
    const row = await screen.findByText('FlashAttention-2')
    act(() => {
      row.click()
    })
    const copy = await screen.findByRole('button', { name: zh.libraryCopyCitation })
    act(() => {
      copy.click()
    })
    await waitFor(() => {
      expect(face.export).toHaveBeenCalledWith({
        refs: ['zotero://user/0/item/ITEM0001'],
        format: 'citation',
      })
      expect(writeText).toHaveBeenCalledWith('Dao, T. (2023).')
    })
  })
})
