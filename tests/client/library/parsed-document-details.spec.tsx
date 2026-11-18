// @vitest-environment jsdom
/** Document identity, citation and recoverable explanation failures. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import {
  ParsedDocumentTab,
  ParsedDocumentTitle,
} from '../../../src/client/components/library/ParsedDocumentTab.tsx'
import { documentRead, parsedRuntime, composer, METADATA } from './support/parsed-document.tsx'
import { ITEM_DETAIL } from '../helpers/library-panel-harness.tsx'
import { mockT } from '../helpers/mock-translate.ts'
import { deferred } from '../../helpers/sync.ts'
import type { ZoteroItemDetailView } from '../../../src/contract.ts'

const owned: Awaited<ReturnType<typeof parsedRuntime>>[] = []
afterEach(async () => {
  cleanup()
  for (const runtime of owned.splice(0)) await runtime.dispose()
  vi.restoreAllMocks()
})
const tick = async () => {
  await act(async () => {})
}
async function select() {
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(12, 10, 88, 20),
  })
  const range = document.createRange()
  range.selectNodeContents(screen.getByText('Passage'))
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
  await act(async () => document.dispatchEvent(new Event('selectionchange')))
  await screen.findByRole('menu')
}
async function fixture(
  options: Parameters<Awaited<ReturnType<typeof parsedRuntime>>['props']>[0] = {},
) {
  const runtime = await parsedRuntime(documentRead('Passage'))
  owned.push(runtime)
  runtime.mount(options)
  await tick()
  return runtime
}

it('names a tab from presentation parameters while keeping its resource address stable', async () => {
  const runtime = await fixture({ title: 'Paper title' })
  cleanup()
  const props = runtime.props({ title: 'Paper title' })
  render(<ParsedDocumentTitle {...props} documents={runtime.documents} />)
  expect(screen.getByText('Paper title')).toBeDefined()
  cleanup()
  render(<ParsedDocumentTitle {...runtime.props({ title: '' })} documents={runtime.documents} />)
  expect(screen.getByText(mockT('tabParsedFallback'))).toBeDefined()
})

it('resolves a generic tab title through the lease-free metadata read alone', async () => {
  const read = documentRead('Passage', { title: 'Real Paper Title' })
  const runtime = await parsedRuntime(read)
  owned.push(runtime)
  await tick()
  const streamOpens = read.mock.calls.filter(([request]) => request.op === 'open').length
  render(<ParsedDocumentTitle {...runtime.props({ title: 'PDF' })} documents={runtime.documents} />)
  await tick()
  expect(screen.getByText('Real Paper Title')).toBeDefined()
  expect(read.mock.calls.filter(([request]) => request.op === 'open')).toHaveLength(streamOpens)
  expect(read.mock.calls.filter(([request]) => request.op === 'meta')).toHaveLength(1)
})

it('keeps a denied session title local and resolves it only after read access returns', async () => {
  const read = documentRead('Passage', { title: 'Protected title' })
  const runtime = await parsedRuntime(read)
  owned.push(runtime)
  act(() => runtime.access.publish(false))
  render(<ParsedDocumentTitle {...runtime.props({ title: 'PDF' })} documents={runtime.documents} />)
  await tick()
  expect(read.mock.calls.filter(([request]) => request.op === 'meta')).toHaveLength(0)
  act(() => runtime.access.publish(true))
  await tick()
  expect(screen.getByText('Protected title')).toBeDefined()
  act(() => runtime.access.publish(false))
  expect(screen.queryByText('Protected title')).toBeNull()
})

it('starts a fresh metadata read on regrant while the revoked request is still settling', async () => {
  const read = documentRead('Passage', { title: 'Current title' })
  const oldReply = deferred<Awaited<ReturnType<typeof read>>>()
  read.mockImplementationOnce(async () => await oldReply.promise)
  const runtime = await parsedRuntime(read)
  owned.push(runtime)
  render(<ParsedDocumentTitle {...runtime.props({ title: 'PDF' })} documents={runtime.documents} />)
  await tick()
  act(() => runtime.access.publish(false))
  act(() => runtime.access.publish(true))
  await tick()
  expect(screen.getByText('Current title')).toBeDefined()
  expect(read.mock.calls.filter(([request]) => request.op === 'meta')).toHaveLength(2)
  oldReply.resolve({
    ok: false,
    error: new RemoteError('gateway/internal', 'Revoked request settled late', {}),
  })
  await tick()
  expect(screen.getByText('Current title')).toBeDefined()
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
  await select()
  fireEvent.click(screen.getByRole('menuitem', { name: mockT('parsedExplain') }))
  await tick()
  expect(item).toHaveBeenCalledWith({ ref: ITEM_DETAIL.ref, include: [] }, expect.any(AbortSignal))
  expect(actions.insertQuote.mock.calls[0]![0]).toContain(ITEM_DETAIL.ref)
  expect(actions.insertQuote.mock.calls[0]![0]).toContain('DOI: 10.0/example')
})

it('instructs the model to read the full document through zotero_retrieve', async () => {
  const actions = composer()
  await fixture({ actions })
  await select()
  fireEvent.click(screen.getByRole('menuitem', { name: mockT('parsedExplain') }))
  await tick()
  const draft = actions.insertQuote.mock.calls[0]![0] as string
  // The instruction names the exact tool call and source; no local path
  // or uninterpolated placeholder survives, and the excerpt closes the card.
  expect(draft).toContain('mode="fulltext"')
  expect(draft).toContain(JSON.stringify({ kind: 'artifactId', artifactId: METADATA.artifactId }))
  expect(draft).toContain('complete=true')
  expect(draft).toContain('Answer in English (en)')
  expect(draft).not.toContain('{source}')
  expect(draft).not.toContain('{language}')
  expect(draft).not.toContain('/full.md')
  expect(draft).toContain(
    'Explain request: read the paper’s complete parsed document before answering.',
  )
  // These assertions lock in the prompt's answer rules: verification,
  // no motive analysis, and a fixed paragraph structure.
  expect(draft).toContain('mode="evidence"')
  expect(draft).toContain('read the complete document through that handle')
  expect(draft).toContain('verify it against the document')
  expect(draft).toContain('Do not analyze the authors’ motives')
  expect(draft).toContain('clearly separated blocks')
  expect(draft).toContain('bullet points')
  expect(draft.endsWith('\n\nPassage')).toBe(true)
})

it('addresses a URL-sourced document by artifact id in the explanation', async () => {
  const actions = composer()
  const artifactId = 'e'.repeat(64)
  const runtime = await parsedRuntime(documentRead('Passage', { artifactId }))
  owned.push(runtime)
  runtime.mount({
    actions,
    address: `dsh-resource://zotero-parsed/artifact/parsed-session/${artifactId}`,
  })
  await tick()
  await select()
  fireEvent.click(screen.getByRole('menuitem', { name: mockT('parsedExplain') }))
  await tick()
  const draft = actions.insertQuote.mock.calls[0]![0] as string
  expect(draft).toContain(JSON.stringify({ kind: 'artifactId', artifactId }))
  expect(draft).not.toContain('"kind":"ref"')
  expect(draft).not.toContain('/full.md')
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
    await select()
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
  await select()
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
  await select()
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
  await select()
  expect(screen.getByRole('menu')).toBeDefined()
  act(() => window.dispatchEvent(new Event('resize')))
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
})

it('ignores a whitespace selection and keeps copy available when no composer is present', async () => {
  await fixture()
  await select()
  expect(
    screen.getByRole('menuitem', { name: mockT('parsedExplain') }).hasAttribute('disabled'),
  ).toBe(true)
  expect(screen.getByRole('menuitem', { name: mockT('parsedCopySelection') })).toBeDefined()
  act(() => window.dispatchEvent(new Event('scroll')))
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
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
