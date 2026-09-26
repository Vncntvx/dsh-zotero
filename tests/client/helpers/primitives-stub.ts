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
 * every other file. Specs that stage through the real settings form model
 * (the settings page and the entry wiring) keep the stubbed visuals but take
 * the real form logic through `primitivesWithRealForm`:
 *
 *     vi.mock('@deepseek-ai/dsh-client-ui-primitives', async (importOriginal) => {
 *       const { primitivesWithRealForm } = await import('./helpers/primitives-stub.ts')
 *       return primitivesWithRealForm(importOriginal)
 *     })
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

/** The harness's own staged-form model and field specs, taken real. */
type RealForm = Pick<
  typeof import('@deepseek-ai/dsh-client-ui-primitives'),
  'SettingsFormModel' | 'settingsNumberField' | 'settingsTextField' | 'SettingsValueField'
>

/** The DOM face one client spec installs in place of the primitives bundle. */
export interface PrimitivesStub extends Omit<RealForm, 'SettingsValueField'> {
  /** A staged value field with the official input contract (stubbed; see below). */
  readonly SettingsValueField: (props: Record<string, unknown>) => ReactElement

  /** A state dot carrying the state name. */
  readonly StateDot: (props: { state: string }) => ReactElement
  /** A pill as the button the filter strip renders. */
  readonly Pill: (props: Record<string, unknown>) => ReactElement
  /** The menu variant this stub installs. */
  readonly Menu: (props: MenuStubProps) => ReactElement
  /** The chevron that marks a disclosure. */
  readonly IconChevronDownOutlineMedium: (props: Record<string, unknown>) => ReactElement
  /** The chevron that marks the left edge of a scrollable strip. */
  readonly IconChevronLeftOutlineMedium: (props: Record<string, unknown>) => ReactElement
  /** The chevron that marks the right edge of a scrollable strip. */
  readonly IconChevronRightOutlineMedium: (props: Record<string, unknown>) => ReactElement
  /** The browse glyph of a search entry. */
  readonly IconBrowseOutlineMedium: (props: Record<string, unknown>) => ReactElement
  /** The glyph leading a clickable link. */
  readonly IconLinkOutlineMedium: (props: Record<string, unknown>) => ReactElement
  /** The passthrough tooltip: its children render in place, without a portal. */
  readonly Tooltip: (props: { children?: ReactElement }) => ReactElement | undefined
  /** The tag capsule, as its DOM face. */
  readonly Tag: typeof TagStub
  /** The clipboard spy assertions read back. */
  readonly writeClipboard: MockedFunction<WriteClipboard>
  /** The switch toggle button. */
  readonly Switch: (props: {
    checked: boolean
    onChange?: (next: boolean) => void
    label: string
    disabled?: boolean
    title?: string
    className?: string
  }) => ReactElement
  /** The risk acknowledgement dialog, as its DOM face. */
  readonly RiskConfirmation: (props: {
    open: boolean
    title: string
    description: string
    acknowledgeLabel: string
    cancelLabel: string
    closeLabel: string
    confirmLabel: string
    acknowledged: boolean
    disabled?: boolean
    onAcknowledgedChange: (acknowledged: boolean) => void
    onCancel: () => void
    onConfirm: () => void
  }) => ReactElement | null
  /** The disclosure row, as its DOM face. */
  readonly DisclosureRow: (props: {
    icon?: unknown
    title?: string
    open?: boolean
    expandable?: boolean
    onToggle?: () => void
    collapsedContent?: unknown
    children?: unknown
    [key: string]: unknown
  }) => ReactElement
  /** Shimmering text indicator. */
  readonly TextShimmer: (props: {
    children?: unknown
    active?: boolean
    [key: string]: unknown
  }) => ReactElement
  readonly IconInspectOutlineRegular: (props: Record<string, unknown>) => ReactElement
  readonly IconBrowseOutlineRegular: (props: Record<string, unknown>) => ReactElement
  readonly IconRefreshOutlineRegular: (props: Record<string, unknown>) => ReactElement
  readonly IconSearchOutlineRegular: (props: Record<string, unknown>) => ReactElement
  readonly IconPlusOutlineRegular: (props: Record<string, unknown>) => ReactElement
  readonly IconCopyOutlineRegular: (props: Record<string, unknown>) => ReactElement
  readonly IconDeliverDocRegular: (props: Record<string, unknown>) => ReactElement
  readonly IconBranchOutlineRegular: (props: Record<string, unknown>) => ReactElement
  readonly IconEditOutlineRegular: (props: Record<string, unknown>) => ReactElement
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
    IconChevronDownOutlineMedium: icon('chevron-down'),
    IconChevronLeftOutlineMedium: icon('chevron-left'),
    IconChevronRightOutlineMedium: icon('chevron-right'),
    IconBrowseOutlineMedium: icon('browse'),
    IconLinkOutlineMedium: icon('link'),
    SettingsValueField: (props) => {
      // Faithful to the official control's input contract (label, input with
      // draft text, hint/invalid copy, override badge with reset): the real
      // component cannot render here because its bundle carries a second
      // React copy, while the model and field specs behind it stay real
      // (see `primitivesWithRealForm`). Tracks
      // `ui-primitives/src/settings-form/fields.tsx` `SettingsValueField`.
      const {
        id,
        label,
        hint,
        text,
        overridden,
        invalid,
        overriddenLabel,
        resetLabel,
        invalidLabel,
        disabled,
        onEdit,
        onReset,
        numeric,
        placeholder,
      } = props as {
        id: string
        label: unknown
        hint?: unknown
        text: string
        overridden: boolean
        invalid: boolean
        overriddenLabel: unknown
        resetLabel: unknown
        invalidLabel: unknown
        disabled: boolean
        onEdit: (text: string) => void
        onReset: () => void
        numeric?: boolean
        placeholder?: string
      }
      return createElement(
        'div',
        null,
        createElement('label', { htmlFor: id }, label as never),
        overridden
          ? createElement(
              'span',
              null,
              createElement('span', null, overriddenLabel as never),
              createElement(
                'button',
                { type: 'button', disabled, onClick: () => (onReset as () => void)() },
                resetLabel as never,
              ),
            )
          : null,
        createElement('input', {
          id,
          type: 'text',
          ...(numeric === true ? { inputMode: 'numeric' as const } : {}),
          ...(invalid ? { 'aria-invalid': true } : {}),
          value: text,
          placeholder: placeholder ?? '',
          disabled,
          onChange: (event: { target: { value: string } }) => {
            ;(onEdit as (text: string) => void)(event.target.value)
          },
        }),
        invalid || hint !== undefined
          ? createElement('p', null, (invalid ? invalidLabel : hint) as never)
          : null,
      )
    },
    Tooltip: ({ children }) => children,
    Tag: TagStub,
    writeClipboard: vi.fn(async () => true),
    Switch: ({ checked, onChange, label, disabled }) =>
      createElement('input', {
        type: 'checkbox',
        role: 'switch',
        'aria-label': label,
        'aria-checked': checked,
        checked,
        disabled,
        onChange: (event: { target: { checked: boolean } }) => {
          onChange?.(event.target.checked)
        },
      }),
    RiskConfirmation: ({
      open,
      title,
      description,
      acknowledgeLabel,
      confirmLabel,
      cancelLabel,
      acknowledged,
      disabled,
      onAcknowledgedChange,
      onCancel,
      onConfirm,
    }) => {
      if (!open) return null
      return createElement(
        'div',
        { 'data-risk-confirmation': 'open', role: 'dialog', 'aria-label': title },
        createElement('p', null, description),
        createElement(
          'label',
          null,
          createElement('input', {
            type: 'checkbox',
            checked: acknowledged,
            disabled,
            onChange: (event: { target: { checked: boolean } }) => {
              onAcknowledgedChange(event.target.checked)
            },
          }),
          createElement('span', null, acknowledgeLabel),
        ),
        createElement('button', { type: 'button', onClick: onCancel }, cancelLabel),
        createElement(
          'button',
          {
            type: 'button',
            disabled: disabled || !acknowledged,
            onClick: onConfirm,
          },
          confirmLabel,
        ),
      )
    },
    DisclosureRow: ({
      icon: leadingIcon,
      title,
      open,
      expandable,
      onToggle,
      collapsedContent,
      children,
    }) =>
      createElement(
        'div',
        {
          'data-disclosure': open ? 'open' : 'closed',
          'data-expandable': expandable ? 'true' : 'false',
        },
        createElement(
          'div',
          {
            role: 'button',
            'data-disclosure-trigger': 'true',
            onClick: () => onToggle?.(),
          },
          leadingIcon as never,
          createElement('span', { 'data-disclosure-title': 'true' }, title as never),
          collapsedContent as never,
        ),
        open ? (children as never) : null,
      ),
    TextShimmer: ({ children, active }) =>
      createElement('span', { 'data-shimmer': active ? 'true' : undefined }, children as never),
    IconInspectOutlineRegular: icon('inspect'),
    IconBrowseOutlineRegular: icon('browse-regular'),
    IconRefreshOutlineRegular: icon('refresh-regular'),
    IconSearchOutlineRegular: icon('search-regular'),
    IconPlusOutlineRegular: icon('plus-regular'),
    IconCopyOutlineRegular: icon('copy-regular'),
    IconDeliverDocRegular: icon('deliver-doc'),
    IconBranchOutlineRegular: icon('branch-regular'),
    IconEditOutlineRegular: icon('edit-regular'),
    ...overrides,
  } as PrimitivesStub
}

/**
 * The stub module body with the real form logic: stubbed visuals (icons,
 * Tag, Menu, Tooltip, clipboard) plus the harness's own staged-form model,
 * field specs, and value control. Specs driving the settings page take this
 * so their writes exercise the real save path instead of a re-implementation.
 * @param importOriginal - the mock factory's original-module loader.
 * @param overrides - per-spec visual variants, as in {@link primitivesStub}.
 * @returns the module shape the spec's `vi.mock` factory returns.
 */
export async function primitivesWithRealForm(
  importOriginal: () => Promise<typeof import('@deepseek-ai/dsh-client-ui-primitives')>,
  overrides: Partial<PrimitivesStub> = {},
): Promise<PrimitivesStub> {
  const original = await importOriginal()
  return {
    ...primitivesStub(overrides),
    SettingsFormModel: original.SettingsFormModel,
    settingsNumberField: original.settingsNumberField,
    settingsTextField: original.settingsTextField,
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
