// @vitest-environment jsdom
/** Host Menu interaction over a snapshot of the user's passage. */
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { documentRead, parsedRuntime, composer } from './support/parsed-document.tsx'
import { mockT } from '../helpers/mock-translate.ts'
import { clipboardWrites } from '../setup.ts'

const owned: ReturnType<typeof parsedRuntime>[] = []
beforeEach(() => {
  vi.stubGlobal('Range', Range)
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 12, bottom: 30 }),
  })
})
afterEach(async () => {
  cleanup()
  for (const runtime of owned.splice(0)) await runtime.dispose()
  vi.restoreAllMocks()
})
function select() {
  const range = document.createRange()
  range.selectNodeContents(screen.getByText('Selected passage'))
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
  act(() => {
    document.dispatchEvent(new Event('selectionchange'))
  })
}
async function mount() {
  const actions = composer()
  const runtime = parsedRuntime(documentRead('Selected passage'))
  owned.push(runtime)
  runtime.mount({ actions })
  await act(async () => {})
  return actions
}

describe('parsed passage menu', () => {
  it('copies the saved passage after DOM selection is gone', async () => {
    await mount()
    select()
    window.getSelection()!.removeAllRanges()
    fireEvent.click(screen.getByRole('menuitem', { name: mockT('parsedCopySelection') }))
    await act(async () => {})
    expect(clipboardWrites).toHaveBeenCalledWith('Selected passage')
  })

  it('inserts the explanation and persists the draft', async () => {
    const actions = await mount()
    select()
    window.getSelection()!.removeAllRanges()
    fireEvent.click(screen.getByRole('menuitem', { name: mockT('parsedExplain') }))
    await act(async () => {})
    expect(actions.insertQuote).toHaveBeenCalledWith(
      `${mockT('parsedExplainPrompt')}\n\nSelected passage\n\nPaper`,
    )
    expect(actions.persistDraft).toHaveBeenCalledOnce()
  })

  it('dismisses on Escape from the focused host menu', async () => {
    await mount()
    select()
    const item = screen.getByRole('menuitem', { name: mockT('parsedExplain') })
    item.focus()
    fireEvent.keyDown(item, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('keeps rejected insertion visible without sending a message', async () => {
    const actions = await mount()
    actions.insertQuote.mockReturnValue(false)
    select()
    fireEvent.click(screen.getByRole('menuitem', { name: mockT('parsedExplain') }))
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toBe(mockT('libraryInsertFailed'))
    expect(actions.persistDraft).not.toHaveBeenCalled()
  })
})
