// @vitest-environment jsdom
/** Document identity, citation and recoverable explanation failures. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import {
  ParsedDocumentTab,
  ParsedDocumentTitle,
} from '../../../src/client/components/library/ParsedDocumentTab.tsx'
import { documentRead, parsedRuntime, composer } from './support/parsed-document.tsx'
import { ITEM_DETAIL } from '../helpers/library-panel-harness.tsx'
import { mockT } from '../helpers/mock-translate.ts'
import { deferred } from '../../helpers/sync.ts'
import type { ZoteroItemDetailView } from '../../../src/contract.ts'

const owned: ReturnType<typeof parsedRuntime>[] = []
afterEach(async () => {
  cleanup()
  for (const runtime of owned.splice(0)) await runtime.dispose()
  vi.restoreAllMocks()
})
const tick = async () => {
  await act(async () => {})
}
function select() {
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 12, bottom: 30 }),
  })
  const range = document.createRange()
  range.selectNodeContents(screen.getByText('Passage'))
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
  act(() => document.dispatchEvent(new Event('selectionchange')))
}
async function fixture(options: Parameters<ReturnType<typeof parsedRuntime>['props']>[0] = {}) {
  const runtime = parsedRuntime(documentRead('Passage'))
  owned.push(runtime)
  runtime.mount(options)
  await tick()
  return runtime
}

it('names a tab from presentation parameters while keeping its resource address stable', async () => {
  const runtime = await fixture({ title: 'Paper title' })
  cleanup()
  const props = runtime.props({ title: 'Paper title' })
  render(<ParsedDocumentTitle {...props} />)
  expect(screen.getByText('Paper title')).toBeDefined()
  cleanup()
  render(<ParsedDocumentTitle {...runtime.props({ title: '' })} />)
  expect(screen.getByText(mockT('tabParsedFallback'))).toBeDefined()
})

it('shows unavailable for a foreign tab address and uses artifact title for an untitled paper', async () => {
  const runtime = await fixture({ title: '' })
  expect(screen.getByRole('heading', { name: 'Paper' })).toBeDefined()
  cleanup()
  render(<ParsedDocumentTab {...runtime.props({ address: 'sidebar://foreign' })} />)
  expect(screen.getByText(mockT('parsedUnavailable'))).toBeDefined()
})

it('cites item metadata and its reference in an explanation', async () => {
  const actions = composer()
  const item = vi.fn(async () => ({ ok: true as const, value: ITEM_DETAIL }))
  await fixture({ actions, item, itemRef: ITEM_DETAIL.ref })
  select()
  fireEvent.click(screen.getByRole('menuitem', { name: mockT('parsedExplain') }))
  await tick()
  expect(item).toHaveBeenCalledWith({ ref: ITEM_DETAIL.ref, include: [] }, expect.any(AbortSignal))
  expect(actions.insertQuote.mock.calls[0]![0]).toContain(ITEM_DETAIL.ref)
  expect(actions.insertQuote.mock.calls[0]![0]).toContain('DOI: 10.0/example')
})

it.each(['remote', 'throw', 'plain'] as const)(
  'reports %s item failures without inserting an incomplete explanation',
  async (kind) => {
    const actions = composer()
    const item = async (): Promise<{ ok: true; value: ZoteroItemDetailView }> => {
      if (kind === 'plain') throw 'plain failure'
      if (kind === 'throw') throw new Error('Item unavailable')
      throw new RemoteError('gateway/internal', 'Remote unavailable', {})
    }
    await fixture({ actions, item, itemRef: ITEM_DETAIL.ref })
    select()
    fireEvent.click(screen.getByRole('menuitem', { name: mockT('parsedExplain') }))
    await tick()
    expect(screen.getByRole('alert').textContent).toContain(
      kind === 'plain' ? 'plain failure' : 'unavailable',
    )
    expect(actions.insertQuote).not.toHaveBeenCalled()
  },
)

it('keeps a structured item refusal in place', async () => {
  const actions = composer()
  await fixture({
    actions,
    itemRef: ITEM_DETAIL.ref,
    item: async () => ({
      ok: false,
      error: new RemoteError('gateway/internal', 'Item permission denied', {}),
    }),
  })
  select()
  fireEvent.click(screen.getByRole('menuitem', { name: mockT('parsedExplain') }))
  await tick()
  expect(screen.getByRole('alert').textContent).toContain('Item permission denied')
  expect(actions.insertQuote).not.toHaveBeenCalled()
})

it('does not write a late explanation after its document is closed', async () => {
  const actions = composer()
  const pending = deferred<{ ok: true; value: ZoteroItemDetailView }>()
  const runtime = await fixture({
    actions,
    itemRef: ITEM_DETAIL.ref,
    item: async () => await pending.promise,
  })
  select()
  fireEvent.click(screen.getByRole('menuitem', { name: mockT('parsedExplain') }))
  cleanup()
  await runtime.dispose()
  pending.resolve({ ok: true, value: ITEM_DETAIL })
  await tick()
  expect(actions.insertQuote).not.toHaveBeenCalled()
})

it('opens the explicit reparse form for the current attachment', async () => {
  await fixture({ parse: true })
  fireEvent.click(screen.getByRole('button', { name: mockT('libraryParsedReparse') }))
  await tick()
  expect(screen.getByRole('dialog')).toBeDefined()
})

it('ignores selections outside the document and dismisses an existing menu on pane scroll', async () => {
  await fixture({ actions: composer() })
  const range = document.createRange()
  range.selectNodeContents(screen.getByRole('heading', { name: 'Paper' }))
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
  act(() => document.dispatchEvent(new Event('selectionchange')))
  expect(screen.queryByRole('menu')).toBeNull()
  select()
  expect(screen.getByRole('menu')).toBeDefined()
  act(() => window.dispatchEvent(new Event('resize')))
  expect(screen.queryByRole('menu')).toBeNull()
})

it('ignores a whitespace selection and keeps copy available when no composer is present', async () => {
  await fixture()
  select()
  expect(
    screen.getByRole('menuitem', { name: mockT('parsedExplain') }).hasAttribute('disabled'),
  ).toBe(true)
  expect(screen.getByRole('menuitem', { name: mockT('parsedCopySelection') })).toBeDefined()
  act(() => window.dispatchEvent(new Event('scroll')))
  const passage = screen.getByText('Passage')
  passage.append(document.createTextNode('   '))
  const range = document.createRange()
  range.selectNodeContents(passage.lastChild!)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
  act(() => document.dispatchEvent(new Event('selectionchange')))
  expect(screen.queryByRole('menu')).toBeNull()
})

it('clears its document when the resource provider leaves and shows loading on reattachment', async () => {
  const runtime = await fixture()
  act(() => runtime.source.publish({ status: 'none', value: undefined, failure: undefined }))
  expect(screen.queryByText('Passage')).toBeNull()
  expect(screen.getByText(mockT('parsedUnavailable'))).toBeDefined()
  act(() => runtime.source.publish({ status: 'loading', value: undefined, failure: undefined }))
  expect(screen.getByRole('status').textContent).toBe(mockT('libraryParsedLoading'))
  expect(screen.queryByText(mockT('parsedUnavailable'))).toBeNull()
})
