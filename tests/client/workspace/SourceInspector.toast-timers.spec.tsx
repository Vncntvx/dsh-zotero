// @vitest-environment jsdom
/**
 * Toast completion in the source inspector and the PDF read button: both clear
 * their transient banner when the primitive's hold-and-fade window elapses.
 * Timers are faked from the start and every query is synchronous so the clock
 * stays under the test's control.
 * @module tests/client/workspace/SourceInspector.toast-timers
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourceInspector } from '../../../src/client/components/workspace/SourceInspector.tsx'
import { PdfReadButton } from '../../../src/client/components/open/PdfReadButton.tsx'
import { sourceOf, workspaceOf } from '../helpers/source-fixtures.ts'
import { mockT } from '../helpers/mock-translate.ts'
import { clipboardWrites } from '../setup.ts'

const t = mockT
const SOURCE_REF = 'zotero://user/0/item/TOAST0001'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('transient notice completion', () => {
  it('clears the inspector copy toast after its window', async () => {
    vi.useFakeTimers()
    vi.mocked(clipboardWrites).mockResolvedValue(undefined as never)
    const item = sourceOf({ key: SOURCE_REF, ref: SOURCE_REF, title: 'Toast paper' })
    render(
      <SourceInspector
        workspace={workspaceOf([item])}
        selectedKey={SOURCE_REF}
        selectionHidden={false}
        setMobilePane={vi.fn()}
        setDraft={vi.fn()}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: t('moreActions') }))
    fireEvent.click(screen.getByRole('menuitem', { name: t('locateItem') }))
    fireEvent.click(screen.getByRole('menuitem', { name: t('copyTitle') }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.queryByRole('alert')).not.toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4200)
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('clears the PDF read-error toast after its window', async () => {
    vi.useFakeTimers()
    const onOpenFile = vi.fn(() => {
      throw new Error('open failed')
    })
    render(<PdfReadButton filePath="/storage/missing.pdf" onOpenFile={onOpenFile} t={t} />)
    const button = screen.getByRole('button', { name: t('readPdf') })
    fireEvent.click(button)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.queryByRole('alert')).not.toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4200)
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
