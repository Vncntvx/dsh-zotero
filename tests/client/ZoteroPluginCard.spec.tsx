// @vitest-environment jsdom
/**
 * The Zotero configuration card in the Plugins tab, rendered through a driven
 * fixture runtime: the test binds the controller's snapshot source with
 * useSyncExternalStore, feeds the component plain props, and drives user
 * gestures with testing-library's fireEvent. The card follows the section's
 * native disclosure chrome, so most test points open the card body first.
 * @module tests/client/ZoteroPluginCard
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZoteroPluginCard } from '../../src/client/ZoteroPluginCard.tsx'
import type { ZoteroPluginCardProps } from '../../src/client/ZoteroPluginCard.tsx'
import { zh, type ZoteroLocaleKey } from '../../src/client/locales.ts'
import {
  ZoteroCardController,
  type ZoteroCardFace,
  type ZoteroCardState,
} from '../../src/client/zotero-card-controller.ts'
import { fakeScope, type FakeScope } from './helpers/fake-scope.ts'

// The real primitives bundle pulls heavy dependencies (katex, shiki); the card
// only needs the controls and the chevron icon, so stub them with their DOM
// faces.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { createElement } = await import('react')
  return {
    Input: (props: Record<string, unknown>) => createElement('input', props),
    Button: ({
      children,
      ...rest
    }: Record<string, unknown> & { children?: import('react').ReactNode }) =>
      createElement('button', { type: 'button', ...rest }, children),
    IconChevronDownOutline14: () => null,
  }
})

const t = (key: ZoteroLocaleKey): string => zh[key]

/** The renderer's binding: a snapshot selector hook over the card's store. */
function Harness({ face }: { face: ZoteroCardFace }) {
  const state = useSyncExternalStore(
    face.hooks.zoteroCard.subscribe,
    face.hooks.zoteroCard.getSnapshot,
  )
  const props = {
    t,
    useZoteroCard: (selector: (snapshot: ZoteroCardState) => unknown) => selector(state),
    edit: face.edit,
    resetField: face.resetField,
    save: face.save,
    discard: face.discard,
  } as unknown as ZoteroPluginCardProps
  return <ZoteroPluginCard {...props} />
}

let scope: FakeScope

function mount(): void {
  const controller = new ZoteroCardController(scope)
  render(<Harness face={controller.inject()} />)
}

afterEach(() => {
  // vitest runs without globals, so testing-library cannot register its own
  // auto-cleanup; without it, successive renders would accumulate in the DOM.
  cleanup()
  scope = undefined as unknown as FakeScope
})

/** The disclosure header; opening it reveals the card body. */
const cardHeader = (): HTMLButtonElement =>
  screen.getByRole('button', { name: /: Zotero$/ }) as HTMLButtonElement

function openCard(): void {
  fireEvent.click(cardHeader())
}

const saveButton = (): HTMLButtonElement => screen.getByRole('button', { name: '保存' })

const discardButton = (): HTMLButtonElement => screen.getByRole('button', { name: '放弃修改' })

describe('ZoteroPluginCard', () => {
  it('renders nothing while the namespace is unavailable', () => {
    scope = fakeScope({ status: 'unavailable' })
    const { container } = render(<Harness face={new ZoteroCardController(scope).inject()} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the native disclosure chrome: header only until opened', () => {
    scope = fakeScope({ value: { baseUrl: 'http://127.0.0.1:23119/api', timeoutMs: 5000 } })
    mount()
    expect(screen.getByText('Zotero')).toBeDefined()
    expect(screen.getByText('Zotero 文献库的接入配置。')).toBeDefined()
    expect(cardHeader().getAttribute('aria-expanded')).toBe('false')
    // Collapsed: no controls are rendered yet.
    expect(document.querySelectorAll('input')).toHaveLength(0)
    openCard()
    expect(cardHeader().getAttribute('aria-expanded')).toBe('true')
    // The body carries the full configuration form plus the save footer.
    expect(document.querySelectorAll('input')).toHaveLength(20)
    expect(saveButton().disabled).toBe(true)
  })

  it('marks the header as unsaved while a draft is staged', () => {
    scope = fakeScope({ value: { timeoutMs: 5000 } })
    mount()
    openCard()
    expect(screen.queryByText('未保存')).toBeNull()
    const timeout = document.querySelector('#zotero-settings-timeoutMs') as HTMLInputElement
    fireEvent.change(timeout, { target: { value: '9000' } })
    expect(screen.getByText('未保存')).toBeDefined()
    fireEvent.click(discardButton())
    expect(screen.queryByText('未保存')).toBeNull()
  })

  it('toggles the web tab and saves the boolean write from the footer', async () => {
    scope = fakeScope({ value: { webEnabled: true } })
    mount()
    openCard()
    const toggle = screen.getByLabelText(zh.webEnabled) as HTMLInputElement
    expect(toggle.checked).toBe(true)
    fireEvent.click(toggle)
    expect(toggle.checked).toBe(false)
    expect(saveButton().disabled).toBe(false)
    fireEvent.click(saveButton())
    await vi.waitFor(() =>
      expect(scope.writes).toEqual([{ op: 'set', field: 'webEnabled', value: false }]),
    )
  })

  it('toggles webEnabled on from an absent value and saves true', async () => {
    scope = fakeScope({ value: { baseUrl: 'http://127.0.0.1:23119/api' } })
    mount()
    openCard()
    const toggle = screen.getByLabelText(zh.webEnabled) as HTMLInputElement
    expect(toggle.checked).toBe(false)
    fireEvent.click(toggle)
    expect(toggle.checked).toBe(true)
    fireEvent.click(saveButton())
    await vi.waitFor(() =>
      expect(scope.writes).toEqual([{ op: 'set', field: 'webEnabled', value: true }]),
    )
  })

  it('rejects an invalid numeric draft and blocks the save', () => {
    scope = fakeScope({ value: { timeoutMs: 5000 } })
    mount()
    openCard()
    const timeout = document.querySelector('#zotero-settings-timeoutMs') as HTMLInputElement
    fireEvent.change(timeout, { target: { value: 'abc' } })
    expect(timeout.getAttribute('aria-invalid')).toBe('true')
    expect(timeout.className).toContain('dsh-zotero-input-invalid')
    expect(screen.getByText('请填数字；留空表示使用默认值。')).toBeDefined()
    expect(saveButton().disabled).toBe(true)
  })

  it('edits a field and saves every staged write', async () => {
    scope = fakeScope({ value: { timeoutMs: 5000 } })
    mount()
    openCard()
    const timeout = document.querySelector('#zotero-settings-timeoutMs') as HTMLInputElement
    fireEvent.change(timeout, { target: { value: '9000' } })
    fireEvent.click(saveButton())
    await vi.waitFor(() =>
      expect(scope.writes).toEqual([{ op: 'set', field: 'timeoutMs', value: 9000 }]),
    )
  })

  it('shows no override marker on the web toggle even when the user layer holds it', () => {
    scope = fakeScope({
      value: { webEnabled: false },
      base: { webEnabled: true },
      user: { webEnabled: false },
    })
    mount()
    openCard()
    // The toggle's own state is its undo: no badge, no reset, no marker row.
    expect(screen.queryByText('已覆盖')).toBeNull()
    expect(screen.queryByText('恢复默认')).toBeNull()
  })

  it('resets an overridden value field back to the base from the footer', async () => {
    scope = fakeScope({
      value: { timeoutMs: 5000 },
      base: { timeoutMs: 7000 },
      user: { timeoutMs: 5000 },
    })
    mount()
    openCard()
    fireEvent.click(screen.getByText('恢复默认'))
    fireEvent.click(saveButton())
    await vi.waitFor(() => expect(scope.writes).toEqual([{ op: 'unset', field: 'timeoutMs' }]))
  })

  it('discard drops the staged draft without writing', () => {
    scope = fakeScope({ value: { timeoutMs: 5000 } })
    mount()
    openCard()
    const timeout = document.querySelector('#zotero-settings-timeoutMs') as HTMLInputElement
    fireEvent.change(timeout, { target: { value: '9000' } })
    fireEvent.click(discardButton())
    expect(scope.writes).toEqual([])
    expect(timeout.value).toBe('5000')
    expect(saveButton().disabled).toBe(true)
  })

  it('keeps the draft and reports failure when the write is refused', async () => {
    scope = fakeScope({ value: { timeoutMs: 5000 }, rejectWrites: true })
    mount()
    openCard()
    const timeout = document.querySelector('#zotero-settings-timeoutMs') as HTMLInputElement
    fireEvent.change(timeout, { target: { value: '9000' } })
    fireEvent.click(saveButton())
    await screen.findByText('本部署没有接受这些值，已保留供你修改。')
    expect(timeout.value).toBe('9000')
    // The draft survives so the user can correct it.
    expect(saveButton().disabled).toBe(false)
  })

  it('disables every control while the document is read-only', () => {
    scope = fakeScope({ value: { timeoutMs: 5000 }, writable: false })
    mount()
    openCard()
    expect(screen.getByText('本部署的设置为只读。')).toBeDefined()
    for (const input of Array.from(document.querySelectorAll('input'))) {
      expect(input.disabled).toBe(true)
    }
    expect(saveButton().disabled).toBe(true)
  })
})
