/**
 * Shared stub for `@deepseek-ai/dsh-client-ui-primitives`: the client specs
 * replace the real bundle (katex, shiki, the portal machinery) with the DOM
 * face they assert on. `vi.mock` factories are hoisted above the spec's
 * imports, so a spec must reach this module through a dynamic import inside
 * its own factory, a module-scope binding would be initialized too late:
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

import {
  Fragment,
  createElement,
  useEffect,
  memo,
  useRef,
  forwardRef,
  type ReactElement,
} from 'react'
import { vi, type MockedFunction } from 'vitest'
import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { TagStub } from './tag-stub.tsx'
import { staticMenu, type MenuStubProps } from './menu-stub.tsx'
import { primitivesIcons } from './primitives-icons.ts'

/** The real clipboard writer, reached through the mocked module. */
type WriteClipboard = (typeof import('@deepseek-ai/dsh-client-ui-primitives'))['writeClipboard']

/** Props the `SettingsForm` stub reads: the official component's full surface. */
export interface SettingsFormStubProps {
  readonly labels: SettingsFormLabels
  readonly state: {
    readonly available: boolean
    readonly writable: boolean
    readonly dirty: boolean
    readonly invalid: boolean
    readonly saving: boolean
    readonly failed: boolean
  }
  readonly onSave: () => void
  readonly onDiscard: () => void
  readonly children?: unknown
}

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
  /** The labelled checkbox, as its DOM face (label wraps the input). */
  readonly Checkbox: (props: {
    checked: boolean
    onChange?: (next: boolean) => void
    label: string
    disabled?: boolean
    title?: string
    className?: string
  }) => ReactElement
  /**
   * The official settings-form chrome, as its DOM face: the
   * unavailable/read-only/failed status lines, the save button, and the
   * unmount discard.
   */
  readonly SettingsForm: (props: SettingsFormStubProps) => ReactElement
  /** The segmented tabs bar, as its DOM face. */
  readonly SegmentedTabs: (props: {
    readonly items: readonly {
      readonly value: string
      readonly label: unknown
      readonly id: string
      readonly panelId: string
    }[]
    readonly value: string
    readonly onChange: (value: string) => void
    readonly label: string
    readonly className?: string
  }) => ReactElement
  /** A staged secret field, which masks the value it holds. */
  readonly SettingsSecretField: (props: Record<string, unknown>) => ReactElement
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
  readonly SegmentedControl?: (props: Record<string, unknown>) => ReactElement
  readonly JsonTree?: (props: Record<string, unknown>) => ReactElement
  readonly IconInspectOutlineRegular: (props: Record<string, unknown>) => ReactElement
  readonly IconBrowseOutlineRegular: (props: Record<string, unknown>) => ReactElement
  readonly IconRefreshOutlineRegular: (props: Record<string, unknown>) => ReactElement
  readonly IconSearchOutlineRegular: (props: Record<string, unknown>) => ReactElement
  readonly IconSearchOutlineMedium: (props: Record<string, unknown>) => ReactElement
  readonly IconPlusOutlineRegular: (props: Record<string, unknown>) => ReactElement
  readonly IconQuestionOutlineRegular: (props: Record<string, unknown>) => ReactElement
  readonly IconCopyOutlineRegular: (props: Record<string, unknown>) => ReactElement
  readonly IconDeliverDocRegular: (props: Record<string, unknown>) => ReactElement
  readonly IconBranchOutlineRegular: (props: Record<string, unknown>) => ReactElement
  readonly IconEditOutlineRegular: (props: Record<string, unknown>) => ReactElement
  readonly IconTrashOutlineRegular: (props: Record<string, unknown>) => ReactElement
  readonly IconChevronDownOutlineRegular: (props: Record<string, unknown>) => ReactElement
  readonly IconChevronsUpDownOutlineMedium: (props: Record<string, unknown>) => ReactElement
  readonly IconCheckOutlineRegular: (props: Record<string, unknown>) => ReactElement
  readonly Button: (props: Record<string, unknown>) => ReactElement
  readonly Input: (props: Record<string, unknown>) => ReactElement
  readonly FileTypeIcon: (props: Record<string, unknown>) => ReactElement
}

/** The DOM face the `countingDisclosure` variant takes, as a memo boundary sees it. */
interface DisclosureRowStubProps {
  readonly icon?: unknown
  readonly title?: string
  readonly open?: boolean
  readonly expandable?: boolean
  readonly onToggle?: () => void
  readonly collapsedContent?: unknown
  readonly children?: unknown
}

/**
 * The one `DisclosureRow` DOM face: the default stub, and the body the
 * `countingDisclosure` variant wraps. Keeping a single tree means the variant
 * that measures render identity still renders exactly what every other spec
 * asserts on.
 */
function disclosureRowElement({
  icon: leadingIcon,
  title,
  open,
  expandable,
  onToggle,
  collapsedContent,
  children,
}: DisclosureRowStubProps): ReactElement {
  return createElement(
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
  )
}

/**
 * The `DisclosureRow` variant that behaves like the real one about identity:
 * the harness primitive is `memo`'d with a shallow prop comparison, so its DOM
 * only changes when a prop's *identity* changes. This stub installs the same
 * `memo` around the shared DOM face and counts how many times the body
 * actually ran, which is the only way to assert that a card handed it stable
 * props. A spec that needs the count opts in with
 * `primitivesStub({ DisclosureRow: countingDisclosure() })` and reads it back
 * through the returned handle.
 */
export function countingDisclosure(): {
  DisclosureRow: PrimitivesStub['DisclosureRow']
  renders: () => number
} {
  let renders = 0
  const DisclosureRow = memo((props: DisclosureRowStubProps) => {
    renders += 1
    return disclosureRowElement(props)
  }) as PrimitivesStub['DisclosureRow']
  return { DisclosureRow, renders: () => renders }
}

/**
 * The official `SettingsForm` chrome as a DOM face: the unavailable/read-only
 * status lines, the failed line, the save button, and the unmount discard.
 * The real component cannot render here (its bundle carries a second React
 * copy), so specs drive this faithful mirror of
 * `ui-primitives/src/settings-form/SettingsForm.tsx` instead. Its hook order
 * matters: the discard-on-unmount effect is unconditional, so it fires even
 * when the namespace is unavailable.
 */
function SettingsFormFace({
  labels,
  state,
  onSave,
  onDiscard,
  children,
}: SettingsFormStubProps): ReactElement {
  const discard = useRef(onDiscard)
  discard.current = onDiscard
  useEffect(
    () => () => {
      discard.current()
    },
    [],
  )
  if (!state.available) {
    return createElement('p', { role: 'status' }, labels.unavailable)
  }
  return createElement(
    Fragment,
    null,
    state.writable ? null : createElement('p', { role: 'status' }, labels.readOnly),
    children as never,
    state.failed ? createElement('p', { role: 'status' }, labels.saveFailed) : null,
    createElement(
      'button',
      {
        type: 'button',
        disabled: !state.dirty || state.invalid || state.saving,
        onClick: onSave,
      },
      state.saving ? labels.saving : labels.save,
    ),
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
    StateDot: ({ state }) => createElement('span', { 'data-state': state }),
    Pill: ({ active, children, ...rest }) =>
      createElement(
        'button',
        { 'data-pill': active === true ? 'active' : undefined, ...rest },
        children as never,
      ),
    Menu: staticMenu,
    MenuSurface: forwardRef<HTMLDivElement, Record<string, unknown>>((props, ref) => {
      const { children, className, style, compact, ...rest } = props
      return createElement(
        'div',
        {
          ref,
          className: className as string | undefined,
          style: style as React.CSSProperties | undefined,
          'data-menu-surface': compact ? 'compact' : 'true',
          ...rest,
        },
        children as never,
      )
    }),
    ...primitivesIcons,
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
    SettingsSecretField: (props) => {
      const { id, label, hint, text, disabled, onEdit, configured, stateLabel } = props as {
        id: string
        label: unknown
        hint?: unknown
        text: string
        disabled?: boolean
        onEdit: (text: string) => void
        configured: boolean
        stateLabel: string
      }
      return createElement(
        'div',
        { 'data-secret-field': id },
        createElement('label', { htmlFor: id }, label as never),
        createElement(
          'span',
          null,
          createElement(
            'span',
            { 'data-configured': configured ? 'true' : 'false' },
            stateLabel as never,
          ),
        ),
        createElement('input', {
          id,
          type: 'password',
          value: text,
          disabled,
          onChange: (event: { target: { value: string } }) => {
            onEdit(event.target.value)
          },
        }),
        hint !== undefined ? createElement('p', null, hint as never) : null,
      )
    },
    SegmentedTabs: ({
      items,
      value,
      onChange,
      label,
      className,
    }: {
      items: readonly { value: string; label: unknown; id: string; panelId: string }[]
      value: string
      onChange: (value: string) => void
      label: string
      className?: string
    }) => {
      return createElement(
        'div',
        { role: 'tablist', 'aria-label': label, className },
        items.map((item) =>
          createElement(
            'button',
            {
              key: item.value,
              type: 'button',
              role: 'tab',
              id: item.id,
              'aria-selected': item.value === value,
              'aria-controls': item.panelId,
              onClick: () => {
                onChange(item.value)
              },
            },
            item.label as never,
          ),
        ),
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
    Checkbox: ({ checked, onChange, label, disabled, title, className }) =>
      createElement(
        'label',
        { title, ...(className !== undefined ? { className } : {}) },
        createElement('input', {
          type: 'checkbox',
          checked,
          disabled,
          onChange: (event: { target: { checked: boolean } }) => {
            onChange?.(event.target.checked)
          },
        }),
        createElement('span', null, label),
      ),
    SettingsForm: SettingsFormFace,
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
    DisclosureRow: disclosureRowElement,
    TextShimmer: ({ children, active }) =>
      createElement('span', { 'data-shimmer': active ? 'true' : undefined }, children as never),
    Button: ({
      children,
      icon: buttonIcon,
      variant,
      size,
      disabled,
      onClick,
      className,
      ...rest
    }: Record<string, unknown>) =>
      createElement(
        'button',
        {
          type: 'button',
          disabled: disabled as boolean | undefined,
          onClick: onClick as React.MouseEventHandler | undefined,
          className: className as string | undefined,
          'data-variant': variant,
          'data-size': size,
          ...rest,
        },
        buttonIcon != null
          ? createElement('span', { className: 'icon' }, buttonIcon as never)
          : null,
        children as never,
      ),
    Input: ({ icon: inputIcon, className, ...rest }: Record<string, unknown>) =>
      createElement(
        'span',
        { className: className as string | undefined },
        inputIcon != null ? createElement('span', { className: 'icon' }, inputIcon as never) : null,
        createElement('input', rest),
      ),
    FileTypeIcon: ({ kind, path, className }: Record<string, unknown>) =>
      createElement('span', {
        'data-file-type': (kind ?? path) as string | undefined,
        className: className as string | undefined,
        'aria-hidden': 'true',
      }),
    SegmentedControl: ({ value, options, onChange, label, className }: Record<string, unknown>) =>
      createElement(
        'div',
        { role: 'tablist', 'aria-label': label as string, className: className as string },
        ((options as readonly { value: string; label: string }[]) ?? []).map((opt) =>
          createElement(
            'button',
            {
              key: opt.value,
              type: 'button',
              role: 'tab',
              'aria-selected': opt.value === value,
              onClick: () => (onChange as (val: string) => void)?.(opt.value),
            },
            opt.label,
          ),
        ),
      ),
    JsonTree: ({ data, label }: Record<string, unknown>) =>
      createElement('div', { role: 'tree', 'aria-label': label as string }, JSON.stringify(data)),
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
