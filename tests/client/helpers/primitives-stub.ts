/**
 * Shared stub for `@deepseek-ai/dsh-client-ui-primitives`: the client specs
 * replace the real bundle (katex, shiki, the portal machinery) with the DOM
 * face they assert on. `vi.mock` factories are hoisted above the spec's
 * imports, so a spec must reach this module through a dynamic import inside
 * its own factory — a module-scope binding would be initialized too late:
 *
 *     vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
 *       const { primitivesStub } = await import('./helpers/primitives-stub.ts')
 *       return primitivesStub()
 *     })
 *
 * A spec that drives more of a primitive than the shared face offers passes
 * its own variant through `primitivesStub({ … })`, so the difference stays
 * visible at the spec's mock site instead of widening the shared stub for
 * every other file.
 * @module tests/client/helpers/primitives-stub
 */

import { createElement, type ReactElement } from 'react'
import { vi, type MockedFunction } from 'vitest'
import { TagStub } from './tag-stub.tsx'

/** One selectable row of the `Menu` stub, as the workspace specs declare it. */
export interface MenuStubItem {
  readonly id: string
  readonly label?: unknown
  readonly disabled?: boolean
}

/** Props the `Menu` stub reads: the subset of the primitive's surface in play. */
export interface MenuStubProps {
  readonly anchor?: unknown
  readonly items?: readonly MenuStubItem[]
  readonly open?: boolean
  /** Row activation; the interactive variant forwards it. */
  readonly onSelect?: (id: string) => void
  /** Escape and outside-click close; the interactive variant forwards it. */
  readonly onClose?: () => void
}

/** The real clipboard writer, reached through the mocked module. */
type WriteClipboard = (typeof import('@deepseek-ai/dsh-client-ui-primitives'))['writeClipboard']

/** The DOM face one client spec installs in place of the primitives bundle. */
export interface PrimitivesStub {
  /** A state dot carrying the state name. */
  readonly StateDot: (props: { state: string }) => ReactElement
  /** A pill as the button the filter strip renders. */
  readonly Pill: (props: Record<string, unknown>) => ReactElement
  /** The menu variant this stub installs. */
  readonly Menu: (props: MenuStubProps) => ReactElement
  /** The chevron that marks a disclosure. */
  readonly IconChevronDownOutline14: (props: Record<string, unknown>) => ReactElement
  /** The chevron that marks the left edge of a scrollable strip. */
  readonly IconChevronLeftOutline14: (props: Record<string, unknown>) => ReactElement
  /** The chevron that marks the right edge of a scrollable strip. */
  readonly IconChevronRightOutline14: (props: Record<string, unknown>) => ReactElement
  /** The browse glyph of a search entry. */
  readonly IconBrowseOutline16: (props: Record<string, unknown>) => ReactElement
  /** The glyph leading a clickable link. */
  readonly LinkIcon: (props: Record<string, unknown>) => ReactElement
  /** The info glyph beside an optional help disclosure. */
  readonly IconInfoOutline14: (props: Record<string, unknown>) => ReactElement
  /** The passthrough tooltip: its children render in place, without a portal. */
  readonly Tooltip: (props: { children?: ReactElement }) => ReactElement | undefined
  /** The tag capsule, as its DOM face. */
  readonly Tag: typeof TagStub
  /** The clipboard spy assertions read back. */
  readonly writeClipboard: MockedFunction<WriteClipboard>
}

/** The icon stubs: an inline glyph carrying the icon name. */
const icon =
  (name: string) =>
  (props: Record<string, unknown>): ReactElement =>
    createElement('span', { 'data-icon': name, ...props })

/**
 * The display-only `Menu`: the trigger plus the open rows, without the
 * primitive's callbacks. Owners whose menu rows act through their own state
 * need no more than this.
 */
function staticMenu({ anchor, items, open }: MenuStubProps): ReactElement {
  return createElement(
    'div',
    { 'data-menu': open === true ? 'open' : undefined },
    anchor as never,
    open === true
      ? items?.map((item) =>
          createElement('span', { key: item.id, 'data-menu-item': item.id }, item.label as never),
        )
      : undefined,
  )
}

/**
 * The `Menu` variant that keeps the primitive's contract: a row click invokes
 * `onSelect`, Escape invokes `onClose` — so the owning component's own
 * callbacks stay exercised without the real portal. Opt in where the spec
 * asserts on them: `primitivesStub({ Menu: interactiveMenu })`.
 */
export function interactiveMenu({
  anchor,
  items,
  open,
  onSelect,
  onClose,
}: MenuStubProps): ReactElement {
  return createElement(
    'div',
    {
      'data-menu': open === true ? 'open' : undefined,
      onKeyDown: (event: { key: string }) => {
        if (event.key === 'Escape') onClose?.()
      },
    },
    anchor as never,
    open === true
      ? items?.map((item) =>
          createElement(
            'span',
            {
              key: item.id,
              'data-menu-item': item.id,
              onClick: () => {
                onSelect?.(item.id)
              },
            },
            item.label as never,
          ),
        )
      : undefined,
  )
}

/**
 * The stub module body: every primitives surface the client specs replace,
 * with a fresh clipboard spy per call (the mock registry is per test file).
 * @param overrides - per-spec variants, e.g. the interactive `Menu`.
 * @returns the module shape the spec's `vi.mock` factory returns.
 */
export function primitivesStub(overrides: Partial<PrimitivesStub> = {}): PrimitivesStub {
  return {
    StateDot: ({ state }) => createElement('span', { 'data-dot': state }),
    Pill: ({ active, children, ...rest }) =>
      createElement(
        'button',
        { 'data-pill': active === true ? 'active' : undefined, ...rest },
        children as never,
      ),
    Menu: staticMenu,
    IconChevronDownOutline14: icon('chevron-down'),
    IconChevronLeftOutline14: icon('chevron-left'),
    IconChevronRightOutline14: icon('chevron-right'),
    IconBrowseOutline16: icon('browse'),
    LinkIcon: icon('link'),
    IconInfoOutline14: icon('info'),
    Tooltip: ({ children }) => children,
    Tag: TagStub,
    writeClipboard: vi.fn(async () => true),
    ...overrides,
  }
}

/**
 * The `writeClipboard` spy the current file's stub installed. Read back
 * through the mocked module rather than a module-scope binding, so the spec
 * never touches the stub before its hoisted factory has run.
 * @returns the spy, typed as the real writer it replaces.
 */
export async function writeClipboardSpy(): Promise<MockedFunction<WriteClipboard>> {
  const primitives = await vi.importMock<typeof import('@deepseek-ai/dsh-client-ui-primitives')>(
    '@deepseek-ai/dsh-client-ui-primitives',
  )
  return vi.mocked(primitives.writeClipboard)
}
