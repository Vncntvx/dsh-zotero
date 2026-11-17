// @vitest-environment jsdom
/** Host Menu interaction over a snapshot of the user's passage. */
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { documentRead, parsedRuntime, composer, REF } from './support/parsed-document.tsx'
import {
  extractSelectionMarkdown,
  extractMarkdownTitle,
  serializeNodeToMarkdown,
  serializeTableToMarkdown,
} from '../../../src/client/components/library/ParsedDocumentTab.tsx'
import { mockT } from '../helpers/mock-translate.ts'
import { clipboardWrites } from '../setup.ts'

const owned: Awaited<ReturnType<typeof parsedRuntime>>[] = []
beforeEach(() => {
  vi.stubGlobal('Range', Range)
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 12, right: 100, top: 10, bottom: 30, width: 88, height: 20 }),
  })
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => [{ left: 12, right: 100, top: 10, bottom: 30, width: 88, height: 20 }],
  })
})
afterEach(async () => {
  cleanup()
  for (const runtime of owned.splice(0)) await runtime.dispose()
  vi.restoreAllMocks()
})
async function select() {
  const range = document.createRange()
  range.selectNodeContents(screen.getByText('Selected passage'))
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
  await act(async () => {
    document.dispatchEvent(new Event('selectionchange'))
  })
  await screen.findByRole('menu')
}
async function mount() {
  const actions = composer()
  const runtime = await parsedRuntime(documentRead('Selected passage'))
  owned.push(runtime)
  const view = runtime.mount({ actions })
  await act(async () => {})
  return { actions, runtime, view }
}

describe('parsed passage menu', () => {
  it('copies the saved passage after DOM selection is gone', async () => {
    const { runtime } = await mount()
    await select()
    window.getSelection()!.removeAllRanges()
    fireEvent.click(screen.getByRole('menuitem', { name: mockT('parsedCopySelection') }))
    await act(async () => {})
    expect(clipboardWrites).toHaveBeenCalledWith('Selected passage')
    // The confirmation is raised in the shell overlay, so it outlives this tab.
    expect(runtime.notify).toHaveBeenCalledWith(mockT('libraryParsedCopied'), 'success')
  })

  it('inserts the whole request as one quote card', async () => {
    const { actions } = await mount()
    await select()
    window.getSelection()!.removeAllRanges()
    fireEvent.click(screen.getByRole('menuitem', { name: mockT('parsedExplain') }))
    await act(async () => {})
    // One card: the instruction asks about the excerpt that closes it, so the
    // composer keeps a single removable block instead of loose text.
    expect(actions.insertQuote).toHaveBeenCalledWith(
      `${mockT('parsedExplainPrompt', { source: JSON.stringify({ kind: 'ref', ref: REF }) })}\n\nPaper\n\nSelected passage`,
      { label: mockT('parsedExplain'), title: 'Paper', detail: 'Paper', body: 'Selected passage' },
    )
    expect(actions.insertText).not.toHaveBeenCalled()
    expect(actions.persistDraft).toHaveBeenCalledOnce()
  })

  it('dismisses on Escape from the focused host menu', async () => {
    await mount()
    await select()
    const item = screen.getByRole('menuitem', { name: mockT('parsedExplain') })
    item.focus()
    fireEvent.keyDown(item, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('keeps rejected insertion visible without sending a message', async () => {
    const { actions } = await mount()
    actions.insertQuote.mockReturnValue(false)
    await select()
    fireEvent.click(screen.getByRole('menuitem', { name: mockT('parsedExplain') }))
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toBe(mockT('libraryInsertFailed'))
    expect(actions.persistDraft).not.toHaveBeenCalled()
  })

  it('suppresses the menu during drag selection until pointerup', async () => {
    const { runtime } = await mount()
    const open = vi.spyOn(runtime.contextMenus, 'open')
    const target = screen.getByText('Selected passage')
    fireEvent.pointerDown(target, { button: 0 })
    const range = document.createRange()
    range.selectNodeContents(target)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    act(() => {
      document.dispatchEvent(new Event('selectionchange'))
    })
    expect(open).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()

    act(() => {
      fireEvent.pointerUp(document)
    })
    expect(await screen.findByRole('menu')).not.toBeNull()
  })

  it('cancels the menu without opening on pointercancel', async () => {
    await mount()
    const target = screen.getByText('Selected passage')
    fireEvent.pointerDown(target, { button: 0 })
    const range = document.createRange()
    range.selectNodeContents(target)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    act(() => {
      document.dispatchEvent(new Event('selectionchange'))
    })
    expect(screen.queryByRole('menu')).toBeNull()

    act(() => {
      fireEvent.pointerCancel(document)
    })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('suppresses the menu during keyboard selection until keyup', async () => {
    const { runtime } = await mount()
    const open = vi.spyOn(runtime.contextMenus, 'open')
    fireEvent.keyDown(screen.getByText('Selected passage'), { key: 'Shift' })
    const range = document.createRange()
    range.selectNodeContents(screen.getByText('Selected passage'))
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    act(() => {
      document.dispatchEvent(new Event('selectionchange'))
    })
    expect(open).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()

    act(() => {
      fireEvent.keyUp(document, { key: 'Shift' })
    })
    expect(await screen.findByRole('menu')).not.toBeNull()
  })

  it('extracts Markdown with preserved KaTeX formulas and text formatting', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <p>
        Specifically, the former represents <strong>amplifying</strong>
        <span class="katex">
          <annotation encoding="application/x-tex">1+1&gt;2</annotation>
        </span>
        influence.
      </p>
    `
    document.body.appendChild(container)
    const range = document.createRange()
    range.selectNodeContents(container)

    const md = extractSelectionMarkdown(range)
    expect(md).toContain('$1+1>2$')
    expect(md).toContain('**amplifying**')
    document.body.removeChild(container)
  })

  it('extracts display math with $$ delimiters', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <div class="katex-display">
        <span class="katex">
          <annotation encoding="application/x-tex">E = mc^2</annotation>
        </span>
      </div>
    `
    document.body.appendChild(container)
    const range = document.createRange()
    range.selectNodeContents(container)

    const md = extractSelectionMarkdown(range)
    expect(md).toBe('$$\nE = mc^2\n$$')
    document.body.removeChild(container)
  })

  it('extracts document title from top-level markdown heading', () => {
    const markdown =
      '# Risk response decisions for critical infrastructures\n\nSome introductory text'
    expect(extractMarkdownTitle(markdown)).toBe(
      'Risk response decisions for critical infrastructures',
    )
    expect(extractMarkdownTitle('No heading text')).toBeUndefined()
  })
})

describe('the selection markdown serializer', () => {
  it('serializes every block and inline element the parsed body carries', () => {
    const host = document.createElement('div')
    host.innerHTML = [
      '<h1>Head</h1>',
      '<h2>Sub</h2>',
      '<h3>S3</h3>',
      '<h4>S4</h4>',
      '<h5>S5</h5>',
      '<h6>S6</h6>',
      '<p>Paragraph</p>',
      '<p><strong>Bold</strong><em>Italic</em><del>Gone</del><s>Struck</s><code>inline</code></p>',
      '<p><a href="https://example.org">Link</a><img alt="Alt" src="images/f.png"></p>',
      '<blockquote>Quoted</blockquote>',
      '<ul><li>Item</li></ul><ol><li>Numbered</li></ol>',
      'Before<br>After<hr>',
      '<pre><code>const x = 1</code></pre>',
      '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr><tr><td>3</td></tr></table>',
      '<span>Plain</span>',
    ].join('')
    host
      .querySelectorAll(
        'h1,h2,h3,h4,h5,h6,p,strong,em,del,s,code,a,img,blockquote,ul,ol,pre,table,span',
      )
      .forEach((el) => {
        const markdown = serializeNodeToMarkdown(el)
        expect(markdown.replace(/\n+/g, '\n').trim()).not.toBe('')
      })
    expect(serializeNodeToMarkdown(host.querySelector('br')!)).toBe('\n')
    expect(serializeNodeToMarkdown(host.querySelector('hr')!)).toBe('\n\n---\n\n')
    expect(serializeNodeToMarkdown(document.createTextNode(''))).toBe('')
    expect(serializeNodeToMarkdown(document.createComment('note'))).toBe('')
    expect(serializeNodeToMarkdown(document.createDocumentFragment())).toBe('')
    const headerless = document.createElement('table')
    const rowless = document.createElement('div')
    rowless.innerHTML = '<table><tr><td>x</td></tr></table>'
    expect(serializeTableToMarkdown(headerless)).toBe('')
    expect(serializeTableToMarkdown(rowless.querySelector('table')!)).toContain('| x |')
    const table = host.querySelector('table')!
    expect(serializeNodeToMarkdown(table)).toContain('| A | B |')
    expect(serializeNodeToMarkdown(table)).toContain('| --- | --- |')
    expect(serializeNodeToMarkdown(table)).toContain('| 3 |  |')
    const emptyTable = document.createElement('table')
    expect(serializeNodeToMarkdown(emptyTable)).toBe('')
    expect(serializeNodeToMarkdown(host.querySelector('strong')!)).toBe('**Bold**')
    expect(serializeNodeToMarkdown(host.querySelector('em')!)).toBe('*Italic*')
    expect(serializeNodeToMarkdown(host.querySelector('del')!)).toBe('~~Gone~~')
    expect(serializeNodeToMarkdown(host.querySelector('a')!)).toBe('[Link](https://example.org)')
    expect(serializeNodeToMarkdown(host.querySelector('code')!)).toBe('`inline`')
    expect(extractMarkdownTitle('# Title')).toBe('Title')
    expect(extractMarkdownTitle('no heading')).toBeUndefined()
  })
})

it.each([false, true])(
  'uses the actual focus end of a multiline selection (backwards=%s)',
  async (backwards) => {
    const { runtime } = await mount()
    const open = vi.spyOn(runtime.contextMenus, 'open')
    const node = screen.getByText('Selected passage')
    vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue([
      { left: 40, right: 80, top: 10, bottom: 30, width: 40, height: 20 },
      { left: 90, right: 200, top: 40, bottom: 60, width: 110, height: 20 },
    ] as unknown as DOMRectList)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.setBaseAndExtent(node, backwards ? 1 : 0, node, backwards ? 0 : 1)
    await act(async () => document.dispatchEvent(new Event('selectionchange')))
    await screen.findByRole('menu')
    expect(open).toHaveBeenCalledWith(
      { kind: 'zoteroSelection', value: { owner: expect.any(String), text: 'Selected passage' } },
      backwards ? { x: 40, y: 30 } : { x: 200, y: 60 },
    )
  },
)

it('shares one popup with other feature targets', async () => {
  const { runtime } = await mount()
  await select()
  const run = vi.fn()
  const dispose = runtime.contextMenus.register({
    target: 'url',
    id: 'other-feature',
    order: 0,
    resolve: () => [{ id: 'other', label: 'Other feature', run }],
  })
  await act(async () =>
    runtime.contextMenus.open(
      { kind: 'url', value: { sessionId: 'test' as never, url: 'https://example.org' } },
      { x: 400, y: 300 },
    ),
  )
  await screen.findByRole('menuitem', { name: 'Other feature' })
  expect(screen.queryByRole('menuitem', { name: mockT('parsedExplain') })).toBeNull()
  expect(screen.getAllByRole('menu')).toHaveLength(1)
  dispose()
})

it('withdraws the captured selection action and closes its popup on unmount', async () => {
  const { runtime, view } = await mount()
  await select()
  const target = runtime.contextMenus.active.getSnapshot()!
  view.unmount()
  const resolution = runtime.contextMenus.resolve(target)
  await resolution.ready
  expect(resolution.source.getSnapshot()).toEqual([])
  resolution.dispose()
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
})
