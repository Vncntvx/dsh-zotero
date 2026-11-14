// @vitest-environment jsdom
/** The parsed-document manager entry keeps My Library first in the header. */
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
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
})
