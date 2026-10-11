// @vitest-environment jsdom
/**
 * Render error boundary tests for the Sources tab.
 * Verifies that rendering exceptions display the localized fallback notice
 * and reset on session key changes.
 * @module tests/client/SourcesTab.boundary
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import { SourcesTab, type SourcesTabProps } from '../../src/client/components/SourcesTab.tsx'
import { ZoteroSurfaceBoundary } from '../../src/client/components/ZoteroSurfaceBoundary.tsx'
import { zh } from '../../src/client/locales.ts'
import {
  chatOf,
  connectedProbe,
  mountTab,
  searchResult,
  toolRow,
} from './helpers/sources-tab-harness.tsx'
import { mockT } from './helpers/mock-translate.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('./helpers/primitives-stub.ts')
  return primitivesStub()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/**
 * Silence React's own error logging for the deliberate throw, returning the spy
 * so a test can assert the plugin logged under its own identity.
 */
function captureConsoleError() {
  return vi.spyOn(console, 'error').mockImplementation(() => {})
}

function Bomb(): never {
  throw new Error('render failed: cannot read properties of undefined')
}

describe('ZoteroSurfaceBoundary', () => {
  it('renders its children untouched while nothing throws', () => {
    const view = render(
      <ZoteroSurfaceBoundary t={mockT}>
        <p>panel body</p>
      </ZoteroSurfaceBoundary>,
    )
    expect(screen.getByText('panel body')).toBeDefined()
    expect(view.container.querySelector('[data-zotero-surface-error]')).toBeNull()
  })

  it('keeps the surface mounted and names the failure when a child throws', () => {
    const logged = captureConsoleError()
    const view = render(
      <ZoteroSurfaceBoundary t={mockT}>
        <Bomb />
      </ZoteroSurfaceBoundary>,
    )
    // The fallback is the panel, not nothing: the slot entry stays alive.
    const fallback = view.container.querySelector('[data-zotero-surface-error]')
    expect(fallback).not.toBeNull()
    expect(fallback?.textContent).toContain(zh.renderFailed)
    // The first line of the throw is shown, so the failure is diagnosable
    // from the page instead of only from the console.
    expect(fallback?.textContent).toContain('render failed: cannot read properties of undefined')
    // The plugin still logs under its own identity for the support path.
    expect(
      logged.mock.calls.some((call) => String(call[0]).includes('dsh-zotero: the Zotero panel')),
    ).toBe(true)
  })

  it('reports a non-Error throw as text rather than crashing again', () => {
    captureConsoleError()
    const ThrowString = (): never => {
      throw 'a bare string failure'
    }
    const view = render(
      <ZoteroSurfaceBoundary t={mockT}>
        <ThrowString />
      </ZoteroSurfaceBoundary>,
    )
    expect(view.container.querySelector('[data-zotero-surface-error]')?.textContent).toContain(
      'a bare string failure',
    )
  })

  it('handles an error with an empty message', () => {
    captureConsoleError()
    const ThrowEmpty = (): never => {
      throw new Error('')
    }
    const view = render(
      <ZoteroSurfaceBoundary t={mockT}>
        <ThrowEmpty />
      </ZoteroSurfaceBoundary>,
    )
    expect(view.container.querySelector('[data-zotero-surface-error]')).not.toBeNull()
  })

  it('resets its error state when resetKey changes', () => {
    captureConsoleError()
    function Flaky({ shouldThrow }: { shouldThrow: boolean }) {
      if (shouldThrow) throw new Error('simulated panel throw')
      return <p>healthy body</p>
    }
    const view = render(
      <ZoteroSurfaceBoundary t={mockT} resetKey="s1">
        <Flaky shouldThrow={true} />
      </ZoteroSurfaceBoundary>,
    )
    expect(view.container.querySelector('[data-zotero-surface-error]')).not.toBeNull()

    view.rerender(
      <ZoteroSurfaceBoundary t={mockT} resetKey="s2">
        <Flaky shouldThrow={false} />
      </ZoteroSurfaceBoundary>,
    )
    expect(view.container.querySelector('[data-zotero-surface-error]')).toBeNull()
    expect(screen.getByText('healthy body')).toBeDefined()
  })

  it('resets its error state in place when the retry button is clicked', () => {
    captureConsoleError()
    let shouldThrow = true
    function Flaky() {
      if (shouldThrow) throw new Error('transient panel throw')
      return <p>recovered body</p>
    }
    const view = render(
      <ZoteroSurfaceBoundary t={mockT}>
        <Flaky />
      </ZoteroSurfaceBoundary>,
    )
    expect(view.container.querySelector('[data-zotero-surface-error]')).not.toBeNull()

    shouldThrow = false
    const button = view.container.querySelector(
      '[data-zotero-surface-retry]',
    ) as HTMLButtonElement | null
    if (button === null) throw new Error('retry button missing from the fallback')
    fireEvent.click(button)

    expect(view.container.querySelector('[data-zotero-surface-error]')).toBeNull()
    expect(screen.getByText('recovered body')).toBeDefined()
  })
})

describe('the Sources tab keeps its registration when its body throws', () => {
  it('renders the panel fallback instead of propagating out of the component', () => {
    const logged = captureConsoleError()
    // A snapshot whose presentation order throws is the minimal honest stand-in
    // for "the workspace build blew up on a block shape this build did not
    // know": the collector walks `order` during the tab's own render.
    const hostile = chatOf([toolRow(searchResult())])
    Object.defineProperty(hostile, 'order', {
      get() {
        throw new Error('order unavailable: malformed snapshot')
      },
    })
    const { view } = mountTab(hostile, connectedProbe())
    expect(view.container.querySelector('[data-zotero-surface-error]')).not.toBeNull()
    expect(view.container.textContent).toContain(zh.renderFailed)
    expect(
      logged.mock.calls.some((call) => String(call[0]).includes('dsh-zotero: the Zotero panel')),
    ).toBe(true)
  })

  it('resets the error boundary when switching to another session', () => {
    captureConsoleError()
    const hostile = chatOf([toolRow(searchResult())])
    Object.defineProperty(hostile, 'order', {
      get() {
        throw new Error('order unavailable: malformed snapshot')
      },
    })

    let currentSessionId = 's1'
    let currentChat: ChatSnapshot = hostile
    const props = {
      t: mockT,
      status: connectedProbe(),
      useSession: (sel: (snap: { sessionId: string }) => unknown) =>
        sel({ sessionId: currentSessionId }),
      useChat: (sel: (snap: ChatSnapshot) => unknown) => sel(currentChat),
    } as unknown as SourcesTabProps

    const view = render(<SourcesTab {...props} />)
    expect(view.container.querySelector('[data-zotero-surface-error]')).not.toBeNull()

    // Switch to a healthy session
    currentSessionId = 's2'
    currentChat = chatOf([toolRow(searchResult())])
    view.rerender(<SourcesTab {...props} />)

    expect(view.container.querySelector('[data-zotero-surface-error]')).toBeNull()
    expect(view.container.querySelectorAll('[role="option"]')).toHaveLength(1)
  })

  it('still renders the normal workspace when nothing throws', () => {
    const { view } = mountTab(chatOf([toolRow(searchResult())]), connectedProbe())
    expect(view.container.querySelector('[data-zotero-surface-error]')).toBeNull()
    expect(view.container.querySelectorAll('[role="option"]')).toHaveLength(1)
  })
})
