// @vitest-environment jsdom
/** The parsed-document manager entry keeps My Library first in the header. */
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { vi, afterEach, describe, expect, it } from 'vitest'
import { parseIntegrationWorld } from '../enrichment/support/parse-integration.tsx'
import { en } from '../../../src/client/locales.ts'

const worlds: ReturnType<typeof parseIntegrationWorld>[] = []
afterEach(() => {
  cleanup()
  for (const world of worlds.splice(0)) world.dispose()
})

describe('library header manager entry', () => {
  it('places My Library before the manager button, with URL parsing only in the manager tab', () => {
    const runtime = parseIntegrationWorld()
    worlds.push(runtime)
    runtime.mount()
    // The library selector is the first button in the toolbar; its Tooltip
    // wrapper leaves the accessible name empty in the jsdom harness.
    const library = screen.getAllByRole('button')[0]!
    const manager = screen.getByRole('button', { name: en.libraryParsedManager })
    expect(library.compareDocumentPosition(manager) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getAllByRole('button', { name: en.libraryParseUrl })).toHaveLength(1)
    fireEvent.click(manager)
  })

  it('hides the manager button while enrichment is not served', () => {
    const runtime = parseIntegrationWorld()
    worlds.push(runtime)
    runtime.mount()
    act(() => runtime.withdraw())
    expect(screen.queryByRole('button', { name: en.libraryParsedManager })).toBeNull()
  })

  it('seats the library selector on the Menu root so the wrap can shrink the button', async () => {
    const runtime = parseIntegrationWorld()
    worlds.push(runtime)
    runtime.mount()
    // The selector's width chain is wrap → Menu root span → Button. The Menu
    // root is inline-flex by default, a shrink-to-fit box: without the anchor
    // class the Button's 100%-width seat resolves against its own content and
    // the button paints over its neighbour in a narrow toolbar. jsdom reads no
    // stylesheet geometry, so the assertion is structural: the anchor class
    // lands on the Menu root and both pickers' seats ride it. The library
    // picker renders a loading span until the lane lands, so wait for both.
    await vi.waitFor(() => {
      const anchors = document.querySelectorAll('[class*="selectorAnchor"]')
      expect(anchors.length).toBe(2)
      for (const anchor of anchors) {
        expect(anchor.tagName).toBe('SPAN')
        expect(anchor.querySelector('button')?.className).toContain('selectorSeat')
      }
    })
  })
})
