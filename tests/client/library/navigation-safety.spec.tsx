// @vitest-environment jsdom
/** Metadata and resolved attachments keep unsafe navigation out of the browser. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroAttachmentLocationView, ZoteroItemDetailView } from '../../../src/contract.ts'
import { LibraryInspector } from '../../../src/client/components/library/LibraryInspector.tsx'
import { LibraryPreferencesContext } from '../../../src/client/library-preferences.tsx'
import { LIBRARY_DEFAULTS, LIBRARY_SECTIONS } from '../../../src/library-preferences.ts'
import { ITEM_DETAIL } from '../helpers/library-panel-harness.tsx'
import { mockT } from '../helpers/mock-translate.ts'
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
function mountInspector(
  detail: ZoteroItemDetailView,
  resolver?: (ref: string) => Promise<RemoteResult<ZoteroAttachmentLocationView>>,
) {
  return render(
    <LibraryPreferencesContext.Provider
      value={{ preferences: { ...LIBRARY_DEFAULTS, detailExpandedSections: LIBRARY_SECTIONS } }}
    >
      <LibraryInspector
        t={mockT}
        inspector={{ phase: 'ready', detail }}
        retry={vi.fn()}
        pageChild={vi.fn()}
        retryChild={vi.fn()}
        childStates={{}}
        inputActions={undefined}
        openFile={undefined}
        resolveAttachment={resolver}
      />
    </LibraryPreferencesContext.Provider>,
  )
}

it.each([
  'javascript:alert(1)',
  'data:text/html,attack',
  'file:///tmp/secret',
  'https://user:secret@example.org/paper',
])('keeps an unsafe metadata URL copyable but prevents opening it: %s', (url) => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  try {
    mountInspector({ ...ITEM_DETAIL, url })
    expect(screen.getByRole('button', { name: url })).toBeTruthy()
    expect(screen.queryByRole('button', { name: `${url} (${mockT('openInZotero')})` })).toBeNull()
    expect(open).not.toHaveBeenCalled()
  } finally {
    open.mockRestore()
  }
})
it('refuses an executable destination returned by attachment resolution', async () => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  const resolveAttachment = vi
    .fn()
    .mockResolvedValue({ ok: true, value: { kind: 'url', url: 'javascript:alert(1)' } })
  mountInspector(ITEM_DETAIL, resolveAttachment)
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'paper.pdf' }))
  })
  expect(open).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'paper.pdf' }).getAttribute('title')).toBe(
    mockT('readErrorUrlBlocked'),
  )
  open.mockRestore()
})
