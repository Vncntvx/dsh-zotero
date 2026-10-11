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
import { setErrorReporter } from '../../src/client/actions/error-reporter.ts'
import type { ZoteroClientErrorReport, ZoteroReportResultView } from '../../src/client/remote.ts'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
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

describe('ZoteroSurfaceBoundary crash reporting', () => {
  it('files the crash into the host ring under its surface name', () => {
    captureConsoleError()
    const report =
      vi.fn<(report: ZoteroClientErrorReport) => Promise<RemoteResult<ZoteroReportResultView>>>()
    report.mockResolvedValue({ ok: true as const, value: { seq: 7 } })
    setErrorReporter(report)
    try {
      render(
        <ZoteroSurfaceBoundary t={mockT} surface="sources">
          <Bomb />
        </ZoteroSurfaceBoundary>,
      )
      expect(report).toHaveBeenCalledTimes(1)
      const filed = report.mock.calls[0]?.[0]
      expect(filed).toMatchObject({
        surface: 'sources',
        message: 'render failed: cannot read properties of undefined',
      })
      expect(filed?.componentStack).toBeDefined()
    } finally {
      setErrorReporter(undefined)
    }
  })

  it('files an empty failure under a non-empty message the intake accepts', () => {
    captureConsoleError()
    const report =
      vi.fn<(report: ZoteroClientErrorReport) => Promise<RemoteResult<ZoteroReportResultView>>>()
    report.mockResolvedValue({ ok: true as const, value: { seq: 8 } })
    setErrorReporter(report)
    try {
      // `new Error('')` falls back to the error's string form; a literally
      // empty thrown string falls back to the placeholder. The intake's
      // wire contract refuses an empty message, so neither may file one.
      function ThrowEmptyError(): never {
        throw new Error('')
      }
      function ThrowEmptyString(): never {
        throw ''
      }
      render(
        <ZoteroSurfaceBoundary t={mockT} surface="sources">
          <ThrowEmptyError />
        </ZoteroSurfaceBoundary>,
      )
      expect(report).toHaveBeenCalledTimes(1)
      expect(report.mock.calls[0]?.[0]).toMatchObject({ surface: 'sources', message: 'Error' })

      render(
        <ZoteroSurfaceBoundary t={mockT} surface="sources">
          <ThrowEmptyString />
        </ZoteroSurfaceBoundary>,
      )
      expect(report).toHaveBeenCalledTimes(2)
      expect(report.mock.calls[1]?.[0]).toMatchObject({
        surface: 'sources',
        message: 'unknown failure',
      })
    } finally {
      setErrorReporter(undefined)
    }
  })

  it('stays silent and still renders the fallback when no reporter is wired', () => {
    captureConsoleError()
    const view = render(
      <ZoteroSurfaceBoundary t={mockT} surface="sources">
        <Bomb />
      </ZoteroSurfaceBoundary>,
    )
    expect(view.container.querySelector('[data-zotero-surface-error]')).not.toBeNull()
  })
})
