// @vitest-environment jsdom
/**
 * A report a parsed surface raised outlives the surface.
 *
 * The manager used to keep its notices in its own `useState`, so closing the
 * tab dropped the report of what it had just done. The notice now leaves
 * through the shell overlay: this spec takes the tab away and still renders
 * the notice from the face the overlay reads.
 * @module tests/client/enrichment/parsed-manager-notice
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ZoteroSurfaceNotice } from '../../../src/client/actions/client-face.ts'
import { ZoteroSurfaceToast } from '../../../src/client/components/ZoteroToast.tsx'
import { en } from '../../../src/client/locales.ts'
import { TITLE, world } from './support/parsed-manager-world.tsx'

afterEach(cleanup)

describe('a parsed-surface notice in the shell overlay', () => {
  it('keeps the discard report after the manager tab is unmounted', async () => {
    let notice: ZoteroSurfaceNotice | null = null
    const w = world({
      notify: (text, tone) => {
        notice = { seq: 1, text, ...(tone === undefined ? {} : { tone }) }
      },
    })
    await screen.findByText(TITLE)
    fireEvent.click(screen.getAllByRole('button', { name: en.parsedManagerDelete })[0]!)
    fireEvent.click(screen.getAllByRole('button', { name: en.parsedManagerDeleteConfirm }).at(-1)!)
    await vi.waitFor(() => expect(notice).not.toBeNull())

    w.unmount()

    // The overlay entry is a separate root: it renders what the face holds,
    // and the panel that raised the notice is gone.
    const read = notice as ZoteroSurfaceNotice | null
    const props = {
      useToast: <T,>(select: (value: ZoteroSurfaceNotice | null) => T) => select(read),
      dismiss: () => {
        notice = null
      },
    } as unknown as Parameters<typeof ZoteroSurfaceToast>[0]
    render(<ZoteroSurfaceToast {...props} />)
    expect(screen.getByRole('alert').textContent).toBe(en.parsedManagerDeleted)
  })
})
