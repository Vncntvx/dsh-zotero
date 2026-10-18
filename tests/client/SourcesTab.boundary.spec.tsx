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
  attachmentResult,
  chatOf,
  connectedProbe,
  mountTab,
  searchResult,
  sessionsOf,
  toolRow,
  type SessionsStub,
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
      <ZoteroSurfaceBoundary t={mockT} surface="sources">
        <p>panel body</p>
      </ZoteroSurfaceBoundary>,
    )
    expect(screen.getByText('panel body')).toBeDefined()
    expect(view.container.querySelector('[data-zotero-surface-error]')).toBeNull()
  })

  it('keeps the surface mounted and names the failure when a child throws', () => {
    const logged = captureConsoleError()
    const view = render(
      <ZoteroSurfaceBoundary t={mockT} surface="sources">
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
      <ZoteroSurfaceBoundary t={mockT} surface="sources">
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
      <ZoteroSurfaceBoundary t={mockT} surface="sources">
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
      <ZoteroSurfaceBoundary t={mockT} surface="sources" resetKey="s1">
        <Flaky shouldThrow={true} />
      </ZoteroSurfaceBoundary>,
    )
    expect(view.container.querySelector('[data-zotero-surface-error]')).not.toBeNull()

    view.rerender(
      <ZoteroSurfaceBoundary t={mockT} surface="sources" resetKey="s2">
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
      <ZoteroSurfaceBoundary t={mockT} surface="sources">
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
      // The standard catalog the tab resolves file addresses against; it
      // follows the session switch like the real store does.
      useSessions: (sel: (snapshot: SessionsStub) => unknown) =>
        sel(sessionsOf(currentSessionId, '/ws/project')),
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

  it('resolves a read action against the owning session workspace root', async () => {
    // The tab, not the plugin fiber, builds the address: it holds the Session
    // identity (`useSession`) and the workspace root (`useSessions`), so the
    // sidebar receives an address already scoped to this Session's root. The
    // tab hands it to the workspace as the plain `openFile(path)` seat the
    // components already speak, and this is where the root is applied.
    const openResource = vi.fn<(url: string) => void>()
    const props = {
      t: mockT,
      status: connectedProbe(),
      openResource,
      useSession: (sel: (snap: { sessionId: string }) => unknown) => sel({ sessionId: 'sess-1' }),
      useSessions: (sel: (snapshot: SessionsStub) => unknown) =>
        sel(sessionsOf('sess-1', '/ws/project')),
      useChat: (sel: (snap: ChatSnapshot) => unknown) =>
        sel(chatOf([toolRow(attachmentResult('/ws/project/storage/paper.pdf'))])),
    } as unknown as SourcesTabProps

    const view = render(<SourcesTab {...props} />)
    const readButton = await screen.findByRole('button', { name: mockT('readPdf') })
    fireEvent.click(readButton)
    // A path inside the session's workspace root is stripped of that root, so
    // the address carries the workspace-relative spelling and stays in the
    // session scope: the sidebar resolves it against the root it holds for this
    // Session rather than the filesystem's.
    expect(openResource).toHaveBeenCalledWith(
      'dsh-resource://file/session/sess-1/storage/paper.pdf',
    )
    view.unmount()
  })

  it('keeps a resolved address session-scoped for a Session without a root', async () => {
    // A Session that reports no workspace root still gets a session-scoped
    // address: `fileAddressFor` falls back to the absolute path, so the call
    // is never dropped and never leaves the Session's scope.
    const openResource = vi.fn<(url: string) => void>()
    const props = {
      t: mockT,
      status: connectedProbe(),
      openResource,
      useSession: (sel: (snap: { sessionId: string }) => unknown) => sel({ sessionId: 'sess-2' }),
      useSessions: (sel: (snapshot: SessionsStub) => unknown) => sel(sessionsOf('sess-2')),
      useChat: (sel: (snap: ChatSnapshot) => unknown) => sel(chatOf([toolRow(attachmentResult())])),
    } as unknown as SourcesTabProps

    const view = render(<SourcesTab {...props} />)
    const readButton = await screen.findByRole('button', { name: mockT('readPdf') })
    fireEvent.click(readButton)
    const opened = openResource.mock.calls[0]?.[0] ?? ''
    // Still session-scoped, never a bare filesystem path: the sidebar resolves
    // it against the Session, which is the invariant the root would have set.
    expect(opened.startsWith('dsh-resource://file/session/sess-2/')).toBe(true)
    expect(opened.endsWith('storage/paper.pdf')).toBe(true)
    view.unmount()
  })

  it('still renders the normal workspace when nothing throws', () => {
    const { view } = mountTab(chatOf([toolRow(searchResult())]), connectedProbe())
    expect(view.container.querySelector('[data-zotero-surface-error]')).toBeNull()
    expect(view.container.querySelectorAll('[role="option"]')).toHaveLength(1)
  })
})

describe('ZoteroSurfaceBoundary containment', () => {
  it('contains the crash, logs it with the surface name, and renders the fallback', () => {
    // Reporting is the slot registry's job (`ctx.slots.onEntryError`, covered by
    // `slot-crash-intake.spec.ts`), which also observes a crashed `inject`
    // factory that no boundary of ours runs for. This boundary's own contract is
    // containment plus a diagnosable console line: the surface stays mounted and
    // the crash never reaches the harness boundary that would retire the entry.
    const logged = captureConsoleError()
    const view = render(
      <ZoteroSurfaceBoundary t={mockT} surface="sources">
        <Bomb />
      </ZoteroSurfaceBoundary>,
    )
    expect(view.container.querySelector('[data-zotero-surface-error]')).not.toBeNull()
    expect(
      logged.mock.calls.some(
        (call) =>
          String(call[0]).includes('dsh-zotero: the Zotero panel failed to render') &&
          String(call[0]).includes('sources'),
      ),
    ).toBe(true)
  })

  it('renders an empty failure under the same fallback as any other', () => {
    captureConsoleError()
    // `new Error('')` and a literally empty thrown string both reach the
    // fallback: the display text is the boundary's `messageOf` result, and the
    // non-empty placeholder belongs to the intake (asserted there), not here.
    function ThrowEmptyError(): never {
      throw new Error('')
    }
    function ThrowEmptyString(): never {
      throw ''
    }
    const view = render(
      <ZoteroSurfaceBoundary t={mockT} surface="sources">
        <ThrowEmptyError />
      </ZoteroSurfaceBoundary>,
    )
    expect(view.container.querySelector('[data-zotero-surface-error]')).not.toBeNull()

    view.rerender(
      <ZoteroSurfaceBoundary t={mockT} surface="sources" resetKey="again">
        <ThrowEmptyString />
      </ZoteroSurfaceBoundary>,
    )
    expect(view.container.querySelector('[data-zotero-surface-error]')).not.toBeNull()
  })
})
