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
import { setErrorReporter } from '../../../src/client/actions/error-reporter.ts'
import { zh } from '../../../src/client/locales.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('../helpers/primitives-stub.ts')
  return primitivesStub()
})

afterEach(() => {
  setErrorReporter(undefined)
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

  it('contains the crash locally and reports to the active error reporter', () => {
    const logged = captureConsoleError()
    const reportFn = vi.fn(async () => {})
    setErrorReporter(reportFn)
    const props = createToolViewProps({
      toolName: 'zotero_search',
      block: settled(),
    })
    const view = render(
      <ZoteroCardBoundary props={props}>
        <Bomb />
      </ZoteroCardBoundary>,
    )
    expect(view.container.querySelector('[data-zotero-card-error]')).not.toBeNull()
    expect(logged).toHaveBeenCalled()
    expect(reportFn).toHaveBeenCalledTimes(1)
    expect(reportFn).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'tool:zotero_search',
        message: 'card render failed: unexpected data error',
      }),
    )
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

  it('registerZoteroToolviews registers all tools wrapped with card boundaries', () => {
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
    // The count is derived from the table: a card added without a test that
    // walks the table is what `parity.spec.tsx` exists to catch.
    expect(registered).toHaveLength(REGISTRATIONS.length)
    expect(registered.map((r) => r.key)).toEqual(REGISTRATIONS.map(([k]) => k))

    // Every registered component is wrapped by withCardBoundary
    for (const item of registered) {
      expect(typeof item.component).toBe('function')
      expect((item.component as { displayName?: string }).displayName).toMatch(/^Guarded\(/)
    }
  })
})
