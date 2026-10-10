// @vitest-environment jsdom
/**
 * Universal container row for Zotero tool views in the Chat stream:
 * lifecycle state rendering, shimmer, disclosure, inspect action, and error states.
 * @module tests/client/toolviews/ZoteroToolRow
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { zh } from '../../../src/client/locales.ts'
import { ZoteroToolRow } from '../../../src/client/toolviews/ZoteroToolRow.tsx'
import { mockT } from '../helpers/mock-translate.ts'
import { preparing, running, settled } from '../helpers/blocks.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('../helpers/primitives-stub.ts')
  return primitivesStub()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function createDisclosure(initial = false) {
  let open = initial
  const toggle = vi.fn(() => {
    open = !open
  })
  return {
    useDisclosure: () => ({
      get expanded() {
        return open
      },
      toggle,
      expand: () => {
        open = true
      },
      collapse: () => {
        open = false
      },
      setExpanded: (val: boolean) => {
        open = val
      },
    }),
    toggle,
  }
}

describe('ZoteroToolRow', () => {
  it('renders preparing state without expandable disclosure body', () => {
    const { useDisclosure } = createDisclosure(true)
    const { container } = render(
      <ZoteroToolRow
        useDisclosure={useDisclosure}
        t={mockT}
        toolName="zotero_search"
        block={preparing()}
        icon={<span data-icon="search" />}
        title="Zotero 检索"
        summary=""
      >
        <div>Should not render</div>
      </ZoteroToolRow>,
    )

    const root = container.querySelector('[data-tool="zotero_search"]')
    expect(root).toBeTruthy()
    expect(root?.getAttribute('data-state')).toBe('preparing')

    const disclosure = container.querySelector('[data-disclosure]')
    expect(disclosure?.getAttribute('data-expandable')).toBe('false')
    expect(screen.queryByText('Should not render')).toBeNull()
  })

  it('renders running state with active shimmer and summary', () => {
    const { useDisclosure } = createDisclosure(false)
    const { container } = render(
      <ZoteroToolRow
        useDisclosure={useDisclosure}
        t={mockT}
        toolName="zotero_retrieve"
        block={running({ name: 'zotero_retrieve' })}
        icon={<span data-icon="retrieve" />}
        title="Zotero 提取"
        summary="正在搜索全文..."
      />,
    )

    const root = container.querySelector('[data-tool="zotero_retrieve"]')
    expect(root?.getAttribute('data-state')).toBe('running')

    const shimmer = container.querySelector('[data-shimmer="true"]')
    expect(shimmer).toBeTruthy()
    expect(shimmer?.textContent).toBe('正在搜索全文...')
  })

  it('renders settled ok state with summary and optional summarySuffix', () => {
    const { useDisclosure } = createDisclosure(false)
    render(
      <ZoteroToolRow
        useDisclosure={useDisclosure}
        t={mockT}
        toolName="zotero_search"
        block={settled()}
        icon={<span data-icon="search" />}
        title="Zotero 检索"
        summary="找到 5 篇文献"
        summarySuffix="(命中 2 条笔记)"
      />,
    )

    expect(screen.getByText('找到 5 篇文献')).toBeTruthy()
    expect(screen.getByText('(命中 2 条笔记)')).toBeTruthy()
  })

  it('renders error state with errorSummary or fallback and error styling', () => {
    const { useDisclosure } = createDisclosure(false)
    const { container } = render(
      <ZoteroToolRow
        useDisclosure={useDisclosure}
        t={mockT}
        toolName="zotero_search"
        block={settled({ isError: true })}
        errorSummary="Connection refused"
        icon={<span data-icon="search" />}
        title="Zotero 检索"
        summary="找到 0 篇文献"
      />,
    )

    const root = container.querySelector('[data-tool="zotero_search"]')
    expect(root?.getAttribute('data-state')).toBe('error')
    expect(screen.getByText('Connection refused')).toBeTruthy()
  })

  it('falls back to toolFailed when errorSummary is absent on error', () => {
    const { useDisclosure } = createDisclosure(false)
    render(
      <ZoteroToolRow
        useDisclosure={useDisclosure}
        t={mockT}
        toolName="zotero_search"
        block={settled({ isError: true })}
        icon={<span data-icon="search" />}
        title="Zotero 检索"
        summary=""
      />,
    )

    expect(screen.getByText(zh.toolFailed)).toBeTruthy()
  })

  it('renders null collapsed content when summary is empty and not preparing', () => {
    const { useDisclosure } = createDisclosure(false)
    const { container } = render(
      <ZoteroToolRow
        useDisclosure={useDisclosure}
        t={mockT}
        toolName="zotero_search"
        block={settled()}
        icon={<span data-icon="search" />}
        title="Zotero 检索"
        summary=""
      />,
    )

    const sep = container.querySelector('[aria-hidden="true"]')
    expect(sep).toBeNull()
  })

  it('renders stopped state with localized stopped text when interrupted', () => {
    const { useDisclosure } = createDisclosure(false)
    const { container } = render(
      <ZoteroToolRow
        useDisclosure={useDisclosure}
        t={mockT}
        toolName="zotero_search"
        block={settled({ error: { name: 'InterruptedError', code: 'interrupted' } })}
        icon={<span data-icon="search" />}
        title="Zotero 检索"
        summary="未完成"
      />,
    )

    const root = container.querySelector('[data-tool="zotero_search"]')
    expect(root?.getAttribute('data-state')).toBe('stopped')
    expect(screen.getByText(zh.toolStopped)).toBeTruthy()
  })

  it('classifies only a declined outcome as declined', () => {
    // The two write verdicts read the outcome through the one decoder, so an
    // absent or unrecognized `kind` is an ordinary settled call, never a
    // declined one: the row's `data-state` is the observable form of that.
    const stateOf = (meta: Record<string, unknown> | undefined, isError = false): string | null => {
      const { useDisclosure } = createDisclosure(false)
      const { container, unmount } = render(
        <ZoteroToolRow
          useDisclosure={useDisclosure}
          t={mockT}
          toolName="zotero_create_note"
          block={settled({ ...(meta === undefined ? {} : { meta }), isError })}
          icon={<span data-icon="edit" />}
          title="Zotero 创建笔记"
          summary="summary"
        />,
      )
      const state = container
        .querySelector('[data-tool="zotero_create_note"]')
        ?.getAttribute('data-state')
      unmount()
      return state ?? null
    }

    expect(stateOf({ kind: 'declined' })).toBe('declined')
    expect(stateOf({ kind: 'applied' })).toBe('ok')
    expect(stateOf({ kind: 'committed-unverified' })).toBe('unverified')
    // No meta at all, and a meta with no recognizable kind, are both an
    // ordinary settled call rather than a write verdict.
    expect(stateOf(undefined)).toBe('ok')
    expect(stateOf({})).toBe('ok')
    expect(stateOf({ kind: 'invented' })).toBe('ok')
  })

  it('renders declined state without error override when declined in meta', () => {
    const { useDisclosure } = createDisclosure(false)
    const { container } = render(
      <ZoteroToolRow
        useDisclosure={useDisclosure}
        t={mockT}
        toolName="zotero_create_note"
        block={settled({ meta: { kind: 'declined' }, isError: true })}
        errorSummary="Should not override declined summary"
        icon={<span data-icon="edit" />}
        title="Zotero 创建笔记"
        summary="已拒绝写操作"
      />,
    )

    const root = container.querySelector('[data-tool="zotero_create_note"]')
    expect(root?.getAttribute('data-state')).toBe('declined')
    expect(screen.getByText(mockT('toolDeclined'))).toBeTruthy()
    expect(screen.queryByText('Should not override declined summary')).toBeNull()
  })

  it('renders a committed-unverified write as its own caution state, not ok', () => {
    const { useDisclosure } = createDisclosure(false)
    const { container } = render(
      <ZoteroToolRow
        useDisclosure={useDisclosure}
        t={mockT}
        toolName="zotero_create_note"
        block={settled({
          meta: { kind: 'committed-unverified', reason: 'saved-state-unverified' },
        })}
        icon={<span data-icon="edit" />}
        title="Zotero 创建笔记"
        summary={'已创建笔记 "Reading"'}
      />,
    )

    // The card's own summary claims a created note; the row must override it,
    // because the write committed without its state ever being proven.
    expect(container.querySelector('[data-tool]')?.getAttribute('data-state')).toBe('unverified')
    expect(screen.getByText(mockT('toolUnverified'))).toBeTruthy()
    expect(screen.queryByText('已创建笔记 "Reading"')).toBeNull()
    // The caution colour is the visible difference from an ordinary row.
    const caution = screen.getByText(mockT('toolUnverified')).closest('span[class]')
    expect(caution?.getAttribute('class')).toContain('cautionSummary')
  })

  it('toggles expansion when clicking disclosure trigger', () => {
    const { useDisclosure, toggle } = createDisclosure(false)
    render(
      <ZoteroToolRow
        useDisclosure={useDisclosure}
        t={mockT}
        toolName="zotero_search"
        block={settled()}
        icon={<span data-icon="search" />}
        title="Zotero 检索"
        summary="找到 1 篇"
      >
        <div>Expanded Content</div>
      </ZoteroToolRow>,
    )

    const trigger = screen.getByRole('button')
    fireEvent.click(trigger)
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('renders inspect button when open and inspect is provided, stopping propagation on click', () => {
    const { useDisclosure } = createDisclosure(true)
    const inspectSpy = vi.fn()
    const outerClick = vi.fn()

    render(
      <div onClick={outerClick}>
        <ZoteroToolRow
          useDisclosure={useDisclosure}
          t={mockT}
          toolName="zotero_search"
          block={settled()}
          inspect={inspectSpy}
          icon={<span data-icon="search" />}
          title="Zotero 检索"
          summary="找到 1 篇"
        >
          <div>Child details</div>
        </ZoteroToolRow>
      </div>,
    )

    expect(screen.getByText('Child details')).toBeTruthy()
    const inspectBtn = screen.getByText(zh.toolInspect)
    expect(inspectBtn).toBeTruthy()

    fireEvent.click(inspectBtn)
    expect(inspectSpy).toHaveBeenCalledTimes(1)
    expect(outerClick).not.toHaveBeenCalled()
  })
})
