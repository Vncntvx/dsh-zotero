// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LibraryInspector } from '../../../src/client/components/library/LibraryInspector.tsx'
import { LibraryPreferencesContext } from '../../../src/client/library-preferences.tsx'
import { LIBRARY_DEFAULTS, LIBRARY_SECTIONS } from '../../../src/library-preferences.ts'
import { deferred } from '../../helpers/sync.ts'
import { ITEM_DETAIL } from '../helpers/library-panel-harness.tsx'
import { mockT } from '../helpers/mock-translate.ts'

afterEach(cleanup)

function mountNote(openNote: NonNullable<Parameters<typeof LibraryInspector>[0]['openNote']>) {
  return render(
    <LibraryPreferencesContext.Provider
      value={{ preferences: { ...LIBRARY_DEFAULTS, detailExpandedSections: LIBRARY_SECTIONS } }}
    >
      <LibraryInspector
        t={mockT}
        inspector={{ phase: 'ready', detail: ITEM_DETAIL }}
        retry={vi.fn()}
        pageChild={vi.fn()}
        childStates={{}}
        retryChild={vi.fn()}
        inputActions={undefined}
        locale={{ getSnapshot: () => ({ active: 'en' }) }}
        openFile={undefined}
        resolveAttachment={undefined}
        openNote={openNote}
      />
    </LibraryPreferencesContext.Provider>,
  )
}

it('reports a note open refusal and lets the user retry the exact note', async () => {
  const pending = deferred<boolean>()
  const open = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(true)
  mountNote(open)
  const button = screen.getByRole('button', { name: mockT('libraryOpenNoteReader') })
  fireEvent.click(button)
  expect(open).toHaveBeenCalledExactlyOnceWith(
    ITEM_DETAIL.notes!.items[0]!.ref,
    mockT('libraryMetaNote'),
    expect.any(AbortSignal),
  )
  expect((button as HTMLButtonElement).disabled).toBe(true)
  await act(async () => pending.resolve(false))
  expect(screen.getByText(mockT('libraryOpenNoteReaderFailed'))).toBeTruthy()
  await act(async () => fireEvent.click(button))
  expect(screen.queryByText(mockT('libraryOpenNoteReaderFailed'))).toBeNull()
})

it('cancels a note open request when the inspector closes', async () => {
  const pending = deferred<boolean>()
  const open = vi.fn().mockReturnValue(pending.promise)
  const view = mountNote(open)
  fireEvent.click(screen.getByRole('button', { name: mockT('libraryOpenNoteReader') }))
  const signal: AbortSignal = open.mock.calls[0]![2]
  expect(signal.aborted).toBe(false)
  view.unmount()
  expect(signal.aborted).toBe(true)
  await act(async () => pending.reject(new Error('transport ended')))
})
