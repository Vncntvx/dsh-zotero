// @vitest-environment jsdom
/** Inspector headings retain their document role and copy controls name their action. */
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LibraryInspector } from '../../../src/client/components/library/LibraryInspector.tsx'
import { ITEM_DETAIL } from '../helpers/library-panel-harness.tsx'
import { mockT } from '../helpers/mock-translate.ts'
import { zh } from '../../../src/client/locales.ts'

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
afterEach(() => {
  cleanup()
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
  else Reflect.deleteProperty(navigator, 'clipboard')
})
function inspector() {
  return render(
    <LibraryInspector
      t={mockT}
      inspector={{
        phase: 'ready',
        detail: { ...ITEM_DETAIL, doi: '10.1234/probe', url: 'https://example.org/paper' },
      }}
      retry={vi.fn()}
      pageChild={vi.fn()}
      childStates={{}}
      retryChild={vi.fn()}
      inputActions={undefined}
      openFile={undefined}
      resolveAttachment={undefined}
      openProtocol={vi.fn(async () => true)}
    />,
  )
}

it('exposes fourth-level headings with operable disclosure buttons', () => {
  const view = inspector()
  expect(view.container.querySelector('button h4')).toBeNull()
  for (const title of [
    zh.libraryMetaAbstract,
    mockT('libraryNotesTitle', { count: ITEM_DETAIL.notes!.total }),
  ]) {
    const heading = screen.getByRole('heading', {
      level: 4,
      name: new RegExp(title.replace(/[()（）]/g, '\\$&')),
    })
    const button = within(heading).getByRole('button')
    const initial = button.getAttribute('aria-expanded')
    expect(['true', 'false']).toContain(initial)
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe(initial === 'true' ? 'false' : 'true')
    expect(heading.tagName).toBe('H4')
  }
})

it('names the copy action and field, then reports success while preserving the raw value as a hint', async () => {
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  inspector()
  const copy = screen.getByRole('button', { name: `${zh.copy} DOI` })
  expect(copy.getAttribute('title')).toContain('10.1234/probe')
  fireEvent.click(copy)
  await waitFor(() => expect(screen.getByRole('button', { name: `${zh.copied} DOI` })).toBe(copy))
  expect(writeText).toHaveBeenCalledWith('10.1234/probe')
  expect(screen.getByRole('button', { name: `${zh.copy} ${zh.libraryMetaUrl}` })).toBeTruthy()
})
