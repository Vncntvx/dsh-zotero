// @vitest-environment jsdom
/** Host Menu interaction over a snapshot of the user's passage. */
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { documentRead, parsedRuntime, composer } from './support/parsed-document.tsx'
import {
  computeSelectionAnchor,
  extractSelectionMarkdown,
  extractMarkdownTitle,
  serializeNodeToMarkdown,
  serializeTableToMarkdown,
} from '../../../src/client/components/library/ParsedDocumentTab.tsx'
import { mockT } from '../helpers/mock-translate.ts'
import { clipboardWrites } from '../setup.ts'

const owned: ReturnType<typeof parsedRuntime>[] = []
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
function select() {
  const range = document.createRange()
  range.selectNodeContents(screen.getByText('Selected passage'))
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
  act(() => {
    document.dispatchEvent(new Event('selectionchange'))
  })
}
async function mount() {
  const actions = composer()
  const runtime = parsedRuntime(documentRead('Selected passage'))
  owned.push(runtime)
  runtime.mount({ actions })
  await act(async () => {})
  return actions
}

describe('parsed passage menu', () => {
  it('copies the saved passage after DOM selection is gone', async () => {
    await mount()
    select()
    window.getSelection()!.removeAllRanges()
    fireEvent.click(screen.getByRole('menuitem', { name: mockT('parsedCopySelection') }))
    await act(async () => {})
    expect(clipboardWrites).toHaveBeenCalledWith('Selected passage')
    expect(screen.getByRole('alert').textContent).toContain(mockT('libraryParsedCopied'))
  })

  it('inserts the explanation and persists the draft', async () => {
    const actions = await mount()
    select()
    window.getSelection()!.removeAllRanges()
    fireEvent.click(screen.getByRole('menuitem', { name: mockT('parsedExplain') }))
    await act(async () => {})
    expect(actions.insertQuote).toHaveBeenCalledWith(
      `${mockT('parsedExplainPrompt')}\n\nSelected passage\n\nPaper`,
    )
    expect(actions.persistDraft).toHaveBeenCalledOnce()
  })

  it('dismisses on Escape from the focused host menu', async () => {
    await mount()
    select()
    const item = screen.getByRole('menuitem', { name: mockT('parsedExplain') })
    item.focus()
    fireEvent.keyDown(item, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('keeps rejected insertion visible without sending a message', async () => {
    const actions = await mount()
    actions.insertQuote.mockReturnValue(false)
    select()
    fireEvent.click(screen.getByRole('menuitem', { name: mockT('parsedExplain') }))
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toBe(mockT('libraryInsertFailed'))
    expect(actions.persistDraft).not.toHaveBeenCalled()
  })

  it('suppresses the menu during drag selection until pointerup', async () => {
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
      fireEvent.pointerUp(document)
    })
    expect(screen.getByRole('menu')).not.toBeNull()
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
    await mount()
    fireEvent.keyDown(document, { key: 'Shift' })
    const range = document.createRange()
    range.selectNodeContents(screen.getByText('Selected passage'))
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    act(() => {
      document.dispatchEvent(new Event('selectionchange'))
    })
    expect(screen.queryByRole('menu')).toBeNull()

    act(() => {
      fireEvent.keyUp(document, { key: 'Shift' })
    })
    expect(screen.getByRole('menu')).not.toBeNull()
  })

  it('computes adaptive anchor point from the active ending line of multi-line selection', () => {
    const range = document.createRange()
    vi.spyOn(range, 'getBoundingClientRect').mockReturnValue({
      left: 20,
      right: 700,
      top: 50,
      bottom: 250,
      width: 680,
      height: 200,
    } as DOMRect)
    vi.spyOn(range, 'getClientRects').mockReturnValue({
      length: 2,
      item: (i: number) =>
        i === 0
          ? ({ left: 20, right: 650, top: 50, bottom: 80, width: 630, height: 30 } as DOMRect)
          : ({ left: 20, right: 180, top: 220, bottom: 250, width: 160, height: 30 } as DOMRect),
      [Symbol.iterator]: function* () {
        yield { left: 20, right: 650, top: 50, bottom: 80, width: 630, height: 30 } as DOMRect
        yield { left: 20, right: 180, top: 220, bottom: 250, width: 160, height: 30 } as DOMRect
      },
    } as unknown as DOMRectList)

    const anchor = computeSelectionAnchor(range)
    // The active line is line 2 (right: 180). focalX = 180, menuWidth = 160 => x = 180 - 80 = 100
    // Rather than being stuck at bbox.left (20), x is adaptively positioned around 100
    expect(anchor.point.x).toBe(100)
    expect(anchor.side).toBe('top')
    expect(anchor.point.y).toBe(220)
  })

  it('clamps anchor horizontal coordinate to stay within viewport bounds', () => {
    const range = document.createRange()
    vi.spyOn(range, 'getBoundingClientRect').mockReturnValue({
      left: 750,
      right: 790,
      top: 100,
      bottom: 120,
      width: 40,
      height: 20,
    } as DOMRect)
    vi.spyOn(range, 'getClientRects').mockReturnValue([
      { left: 750, right: 790, top: 100, bottom: 120, width: 40, height: 20 } as DOMRect,
    ] as unknown as DOMRectList)

    // With window.innerWidth = 800, menuWidth = 160, margin = 16:
    // maximum x = 800 - 160 - 16 = 624
    const anchor = computeSelectionAnchor(range)
    expect(anchor.point.x).toBeLessThanOrEqual(window.innerWidth - 160 - 16)
    expect(anchor.point.x).toBeGreaterThanOrEqual(16)
  })

  it('places menu below when there is insufficient space above', () => {
    const range = document.createRange()
    vi.spyOn(range, 'getBoundingClientRect').mockReturnValue({
      left: 50,
      right: 200,
      top: 10,
      bottom: 30,
      width: 150,
      height: 20,
    } as DOMRect)
    vi.spyOn(range, 'getClientRects').mockReturnValue([
      { left: 50, right: 200, top: 10, bottom: 30, width: 150, height: 20 } as DOMRect,
    ] as unknown as DOMRectList)

    const anchor = computeSelectionAnchor(range)
    expect(anchor.side).toBe('bottom')
    expect(anchor.point.y).toBe(30)
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
