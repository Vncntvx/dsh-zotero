// @vitest-environment jsdom
/**
 * Tests for the Zotero tool card render error boundary.
 * Verifies that rendering exceptions in individual cards are caught and render fallback rows.
 * @module tests/client/toolviews/card-boundary
 */

import { cleanup, render, screen } from '@testing-library/react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ZoteroCardBoundary,
  withCardBoundary,
} from '../../../src/client/toolviews/ZoteroCardBoundary.tsx'
import { registerZoteroToolviews, REGISTRATIONS } from '../../../src/client/toolviews/index.ts'
import { settled } from '../helpers/blocks.ts'
import { createToolViewProps } from '../helpers/mock-disclosure.ts'
import { getErrorReporter, setErrorReporter } from '../../../src/client/actions/error-reporter.ts'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroClientErrorReport, ZoteroReportResultView } from '../../../src/client/remote.ts'
import { zh } from '../../../src/client/locales.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('../helpers/primitives-stub.ts')
  return primitivesStub()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function captureConsoleError() {
  return vi.spyOn(console, 'error').mockImplementation(() => {})
}

function Bomb(): never {
  throw new Error('card render failed: unexpected data error')
}

describe('ZoteroCardBoundary', () => {
  it('renders children normally when nothing throws', () => {
    const props = createToolViewProps({
      toolName: 'zotero_search',
      block: settled(),
    })

    const view = render(
      <ZoteroCardBoundary props={props}>
        <div data-testid="healthy-card">healthy content</div>
      </ZoteroCardBoundary>,
    )

    expect(screen.getByTestId('healthy-card')).toBeDefined()
    expect(view.container.querySelector('[data-zotero-card-error]')).toBeNull()
  })

  it('catches card throw, logs plugin identity, and renders fallback tool row', () => {
    const logged = captureConsoleError()
    const inspectSpy = vi.fn()
    const props = createToolViewProps({
      toolName: 'zotero_search',
      block: settled(),
      inspect: inspectSpy,
    })

    const view = render(
      <ZoteroCardBoundary props={props}>
        <Bomb />
      </ZoteroCardBoundary>,
    )

    const fallback = view.container.querySelector('[data-zotero-card-error]')
    expect(fallback).not.toBeNull()
    expect(fallback?.textContent).toContain('zotero_search')
    expect(fallback?.textContent).toContain(zh.renderFailed)
    expect(fallback?.textContent).toContain('card render failed: unexpected data error')

    expect(
      logged.mock.calls.some((call) =>
        String(call[0]).includes('dsh-zotero: tool card failed to render:'),
      ),
    ).toBe(true)
  })

  it('renders the fallback itself when the block is the hostile thing', () => {
    // The fallback must be safe against the very input that likely crashed
    // the card: a block whose every read throws. The static fallback touches
    // no block field, so the degraded face still renders — and the crash
    // never reaches the harness boundary that would retire the card.
    const logged = captureConsoleError()
    // Built by hand, not through `settled()`: the factory itself reads `call`
    // to derive `args`, which would throw before the render even starts. The
    // hostile getter stands in for any block read the wrapped card might make.
    const hostile = {
      kind: 'tool-result',
      seq: 2,
      time: 2,
      callId: 'c1',
      get call(): never {
        throw new Error('hostile block')
      },
    } as unknown as Parameters<typeof createToolViewProps>[0]['block']
    const props = createToolViewProps({ toolName: 'zotero_get', block: hostile })

    const view = render(
      <ZoteroCardBoundary props={props}>
        <Bomb />
      </ZoteroCardBoundary>,
    )

    const fallback = view.container.querySelector('[data-zotero-card-error]')
    expect(fallback).not.toBeNull()
    expect(fallback?.textContent).toContain('zotero_get')
    expect(fallback?.textContent).toContain(zh.renderFailed)
    expect(fallback?.textContent).toContain('card render failed: unexpected data error')
    expect(
      logged.mock.calls.some((call) =>
        String(call[0]).includes('dsh-zotero: tool card failed to render:'),
      ),
    ).toBe(true)
  })

  it('files a non-Error crash without a stack when a reporter is wired', () => {
    captureConsoleError()
    const report =
      vi.fn<(report: ZoteroClientErrorReport) => Promise<RemoteResult<ZoteroReportResultView>>>()
    report.mockResolvedValue({ ok: true as const, value: { seq: 2 } })
    setErrorReporter(report)
    try {
      const props = createToolViewProps({
        toolName: 'zotero_get',
        block: settled(),
      })
      const ThrowString = (): never => {
        throw 'bare string card failure'
      }
      render(
        <ZoteroCardBoundary props={props}>
          <ThrowString />
        </ZoteroCardBoundary>,
      )
      expect(report).toHaveBeenCalledTimes(1)
      const filed = report.mock.calls[0]?.[0]
      expect(filed).toMatchObject({
        surface: 'tool:zotero_get',
        message: 'bare string card failure',
      })
      // A thrown string has no stack to file.
      expect(filed?.stack).toBeUndefined()
    } finally {
      setErrorReporter(undefined)
    }
  })

  it('handles non-Error throws and empty error messages', () => {
    captureConsoleError()
    const props = createToolViewProps({
      toolName: 'zotero_get',
      block: settled(),
    })

    const ThrowString = (): never => {
      throw 'bare string card failure'
    }
    const view1 = render(
      <ZoteroCardBoundary props={props}>
        <ThrowString />
      </ZoteroCardBoundary>,
    )
    expect(view1.container.textContent).toContain('bare string card failure')

    const ThrowEmpty = (): never => {
      throw new Error('')
    }
    const view2 = render(
      <ZoteroCardBoundary props={props}>
        <ThrowEmpty />
      </ZoteroCardBoundary>,
    )
    expect(view2.container.querySelector('[data-zotero-card-error]')).not.toBeNull()
  })

  it('falls back to ToolView when displayName and name are absent', () => {
    const Anonymous = withCardBoundary(Object.defineProperty(() => null, 'name', { value: '' }))
    expect(Anonymous.displayName).toBe('Guarded(ToolView)')
  })

  it('files a crash report under the tool wire name when a reporter is wired', () => {
    captureConsoleError()
    expect(getErrorReporter()).toBeUndefined()
    const report =
      vi.fn<(report: ZoteroClientErrorReport) => Promise<RemoteResult<ZoteroReportResultView>>>()
    report.mockResolvedValue({ ok: true as const, value: { seq: 1 } })
    setErrorReporter(report)
    try {
      const props = createToolViewProps({
        toolName: 'zotero_search',
        block: settled(),
      })
      render(
        <ZoteroCardBoundary props={props}>
          <Bomb />
        </ZoteroCardBoundary>,
      )
      expect(report).toHaveBeenCalledTimes(1)
      const filed = report.mock.calls[0]?.[0]
      expect(filed).toMatchObject({
        surface: 'tool:zotero_search',
        message: 'card render failed: unexpected data error',
      })
      expect(filed?.stack).toBeDefined()
    } finally {
      setErrorReporter(undefined)
    }
  })

  it('withCardBoundary creates a wrapped component with Guarded displayName', () => {
    function SimpleCard() {
      return <div>simple</div>
    }
    SimpleCard.displayName = 'SimpleCard'

    const Guarded = withCardBoundary(SimpleCard)
    expect(Guarded.displayName).toBe('Guarded(SimpleCard)')

    const props = createToolViewProps({
      toolName: 'zotero_get',
      block: settled(),
    })

    const view = render(<Guarded {...props} />)
    expect(view.container.textContent).toContain('simple')
  })

  it('registerZoteroToolviews registers all 16 tools wrapped with card boundaries', () => {
    const registered: Array<{ name: string; key: string; component: unknown }> = []
    const ctx = {
      slots: {
        inject: (
          _slot: string,
          fn: () => Iterable<{ name: string; key: string; component: unknown }>,
        ) => {
          for (const item of fn()) {
            registered.push(item)
          }
        },
        register: (spec: { name: string; key: string }, component: unknown) => ({
          ...spec,
          component,
        }),
      },
    }

    registerZoteroToolviews(ctx as unknown as ClientContext)
    expect(registered).toHaveLength(16)
    expect(registered.map((r) => r.key)).toEqual(REGISTRATIONS.map(([k]) => k))

    // Every registered component is wrapped by withCardBoundary
    for (const item of registered) {
      expect(typeof item.component).toBe('function')
      expect((item.component as { displayName?: string }).displayName).toMatch(/^Guarded\(/)
    }
  })
})
