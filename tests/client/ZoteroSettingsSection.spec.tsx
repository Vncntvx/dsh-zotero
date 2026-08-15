// @vitest-environment jsdom
/**
 * The Zotero settings page rendered through a driven fixture runtime: the
 * test binds the controller's snapshot source with useSyncExternalStore (the
 * renderer's own binding), feeds the component plain props, and drives user
 * gestures with testing-library's fireEvent.
 * @module tests/client/ZoteroSettingsSection
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZoteroSettingsSection } from '../../src/client/ZoteroSettingsSection.tsx'
import type { ZoteroSettingsSectionProps } from '../../src/client/ZoteroSettingsSection.tsx'
import { zh, type ZoteroLocaleKey } from '../../src/client/locales.ts'
import {
  ZoteroCardController,
  type ZoteroCardFace,
  type ZoteroCardState,
} from '../../src/client/zotero-card-controller.ts'
import { fakeScope, type FakeScope } from './helpers/fake-scope.ts'

// The real primitives bundle pulls heavy dependencies (katex, shiki); the
// page only needs the two controls, so stub them with their DOM faces.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { createElement } = await import('react')
  return {
    Input: (props: Record<string, unknown>) => createElement('input', props),
    Button: ({
      children,
      ...rest
    }: Record<string, unknown> & { children?: import('react').ReactNode }) =>
      createElement('button', { type: 'button', ...rest }, children),
  }
})

const t = (key: ZoteroLocaleKey): string => zh[key]

/** The renderer's binding: a snapshot selector hook over the page's store. */
function Harness({ face }: { face: ZoteroCardFace }) {
  const state = useSyncExternalStore(
    face.hooks.zoteroCard.subscribe,
    face.hooks.zoteroCard.getSnapshot,
  )
  const props = {
    t,
    close: () => {},
    useZoteroCard: (selector: (snapshot: ZoteroCardState) => unknown) => selector(state),
    edit: face.edit,
    resetField: face.resetField,
    save: face.save,
  } as unknown as ZoteroSettingsSectionProps
  return <ZoteroSettingsSection {...props} />
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

/** The page's save button, matched by copy to stay robust to field controls. */
function saveButton(): HTMLButtonElement {
  const button = screen.queryByRole('button', { name: '保存' })
  if (button === null) throw new Error('save button not found')
  return button as HTMLButtonElement
}

const timeoutInput = (): HTMLInputElement =>
  document.querySelector('#zotero-settings-timeoutMs') as HTMLInputElement

describe('ZoteroSettingsSection', () => {
  it('shows the title with an explanation while the namespace is unavailable', () => {
    scope = fakeScope({ status: 'unavailable' })
    mount()
    expect(screen.getByText('Zotero')).toBeDefined()
    expect(screen.getByText('设置不可用：本部署未为 Zotero 组合设置文档。')).toBeDefined()
    expect(document.querySelectorAll('input')).toHaveLength(0)
  })

  it('shows the title while the first load is still crossing the wire', () => {
    scope = fakeScope({ status: 'loading' })
    mount()
    expect(screen.getByText('Zotero')).toBeDefined()
    expect(screen.getByText('正在加载设置…')).toBeDefined()
  })

  it('renders every field control plus the page chrome', () => {
    scope = fakeScope({ value: { baseUrl: 'http://127.0.0.1:23119/api', timeoutMs: 5000 } })
    mount()
    expect(screen.getByText('本地 Zotero 文献库的接入配置。')).toBeDefined()
    expect(document.querySelectorAll('input')).toHaveLength(20)
    expect(timeoutInput().value).toBe('5000')
    // The boolean field renders as a checkbox with the field's copy.
    expect(screen.getByLabelText('Zotero 会话标签页')).toBeDefined()
  })

  it('toggles the webEnabled checkbox and saves the boolean write', async () => {
    scope = fakeScope({ value: { baseUrl: 'http://127.0.0.1:23119/api', webEnabled: true } })
    mount()
    const toggle = screen.getByLabelText('Zotero 会话标签页') as HTMLInputElement
    expect(toggle.checked).toBe(true)
    fireEvent.click(toggle)
    expect(toggle.checked).toBe(false)
    expect(saveButton().disabled).toBe(false)
    fireEvent.click(saveButton())
    await screen.findByText('保存')
    expect(scope.writes).toEqual([{ op: 'set', field: 'webEnabled', value: false }])
  })

  it('toggles webEnabled on from an absent value', async () => {
    scope = fakeScope({ value: { baseUrl: 'http://127.0.0.1:23119/api' } })
    mount()
    const toggle = screen.getByLabelText('Zotero 会话标签页') as HTMLInputElement
    expect(toggle.checked).toBe(false)
    fireEvent.click(toggle)
    expect(toggle.checked).toBe(true)
    fireEvent.click(saveButton())
    await screen.findByText('保存')
    expect(scope.writes).toEqual([{ op: 'set', field: 'webEnabled', value: true }])
  })

  it('stages a reset for an overridden webEnabled back to the base', async () => {
    scope = fakeScope({
      value: { baseUrl: 'http://127.0.0.1:23119/api', webEnabled: false },
      base: { webEnabled: true },
      user: { webEnabled: false },
    })
    mount()
    expect(screen.getByText('已覆盖')).toBeDefined()
    fireEvent.click(screen.getByText('恢复默认'))
    fireEvent.click(saveButton())
    await screen.findByText('保存')
    expect(scope.writes).toEqual([{ op: 'unset', field: 'webEnabled' }])
  })

  it('stages typed edits and enables the save', () => {
    scope = fakeScope({ value: { timeoutMs: 5000 } })
    mount()
    expect(saveButton().disabled).toBe(true)
    fireEvent.change(timeoutInput(), { target: { value: '9000' } })
    expect(timeoutInput().value).toBe('9000')
    expect(saveButton().disabled).toBe(false)
  })

  it('writes staged edits to the namespace on save', async () => {
    scope = fakeScope({ value: { timeoutMs: 5000 } })
    mount()
    fireEvent.change(timeoutInput(), { target: { value: '9000' } })
    fireEvent.click(saveButton())
    await screen.findByText('保存')
    expect(scope.writes).toEqual([{ op: 'set', field: 'timeoutMs', value: 9000 }])
  })

  it('blocks the save while a numeric draft is invalid', () => {
    scope = fakeScope({ value: { timeoutMs: 5000 } })
    mount()
    fireEvent.change(timeoutInput(), { target: { value: 'soon' } })
    expect(timeoutInput().getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('请填数字；留空表示使用默认值。')).toBeDefined()
    expect(saveButton().disabled).toBe(true)
  })

  it('marks user-layer overrides and stages a reset back to the base', async () => {
    scope = fakeScope({
      value: { timeoutMs: 9000 },
      base: { timeoutMs: 5000 },
      user: { timeoutMs: 9000 },
    })
    mount()
    expect(screen.getByText('已覆盖')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }))
    expect(timeoutInput().value).toBe('5000')
    fireEvent.click(saveButton())
    await screen.findByText('保存')
    expect(scope.writes).toEqual([{ op: 'unset', field: 'timeoutMs' }])
  })

  it('reports a rejected save and keeps the draft', async () => {
    scope = fakeScope({ value: { timeoutMs: 5000 }, rejectWrites: true })
    mount()
    fireEvent.change(timeoutInput(), { target: { value: '9000' } })
    fireEvent.click(saveButton())
    await screen.findByText('本部署没有接受这些值，已保留供你修改。')
    expect(timeoutInput().value).toBe('9000')
  })

  it('disables every control for a read-only document', () => {
    scope = fakeScope({ value: { timeoutMs: 5000 }, writable: false })
    mount()
    expect(screen.getByText('本部署的设置为只读。')).toBeDefined()
    expect(timeoutInput().disabled).toBe(true)
  })

  it('leads the page with the web group and groups the rest by family', () => {
    scope = fakeScope({ value: { timeoutMs: 5000 } })
    mount()
    const headings = Array.from(document.querySelectorAll('h3'), (el) => el.textContent)
    expect(headings[0]).toBe('Web 视图')
    for (const heading of ['连接', '检索限制', '输出限制', '导出默认']) {
      expect(screen.getByText(heading)).toBeDefined()
    }
  })

  it('renders one labelled control per Config field', () => {
    scope = fakeScope({ value: { timeoutMs: 5000 } })
    mount()
    const page = screen.getByText('Zotero').closest('div')
    expect(page).not.toBeNull()
    expect(within(page as HTMLElement).getByText('请求超时（毫秒）')).toBeDefined()
    expect(within(page as HTMLElement).getByText('导出条目上限')).toBeDefined()
  })
})
