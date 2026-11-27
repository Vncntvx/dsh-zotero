// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { searchTextNodes } from '../../../src/client/reader/text-search.ts'

afterEach(() => {
  document.body.replaceChildren()
})

it('matches case-insensitively across inline elements and returns DOM ranges', () => {
  const root = document.createElement('article')
  root.innerHTML =
    '<p>Same <strong>sentence</strong> appears.</p><p>same sentence appears again.</p>'
  const result = searchTextNodes(root, 'SAME SENTENCE')

  expect(result.truncated).toBe(false)
  expect(result.ranges.map((range) => range.toString())).toEqual(['Same sentence', 'same sentence'])
})

it('does not join separate blocks and treats query punctuation literally', () => {
  const root = document.createElement('article')
  root.innerHTML = '<p>cross</p><p>boundary</p><p>A+B is literal.</p>'

  expect(searchTextNodes(root, 'crossboundary').ranges).toHaveLength(0)
  expect(searchTextNodes(root, 'a+b').ranges.map((range) => range.toString())).toEqual(['A+B'])
})

it('bounds pathological results and reports that more matches exist', () => {
  const root = document.createElement('article')
  root.textContent = 'x'.repeat(1002)

  const result = searchTextNodes(root, 'x')
  expect(result.ranges).toHaveLength(1000)
  expect(result.truncated).toBe(true)
})

it('ignores empty queries, hidden controls, and missing text nodes', () => {
  const root = document.createElement('article')
  root.innerHTML =
    '<p>Visible <button>hidden button</button><span hidden>hidden span</span> text<br>line</p><p aria-hidden="true">secret</p>'
  expect(searchTextNodes(root, '   ').ranges).toHaveLength(0)
  expect(searchTextNodes(root, 'hidden').ranges).toHaveLength(0)
  expect(searchTextNodes(root, 'secret').ranges).toHaveLength(0)
  expect(searchTextNodes(root, 'Visible textline').ranges).toHaveLength(0)
})
