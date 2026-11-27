// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { excerptRegion } from '../../../src/client/reader/excerpt-region.ts'

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function selection(root: HTMLElement, bounds: DOMRect) {
  document.body.append(root)
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 40, 300, 210))
  const range = document.createRange()
  range.selectNodeContents(root.querySelector('td')!)
  Object.defineProperty(range, 'getBoundingClientRect', { value: () => bounds })
  return range
}

it('crops the displayed layout and copies only formatted document content into the image', () => {
  const root = document.createElement('div')
  root.innerHTML = `<table><tr><td colspan="2"><strong style="font-size: 18px">Finding</strong>
    <a href="https://example.org/private">citation</a><img alt="Figure" src="about:blank">
    <script>skip this</script><button>skip control</button></td></tr></table>`
  const range = selection(root, new DOMRect(50, 105, 75, 25))
  const region = excerptRegion(root, range)
  expect(region).toMatchObject({ width: 83, height: 33 })
  const xml = decodeURIComponent(region!.src.split(',')[1]!)
  expect(xml).toContain('left: -26px; top: -61px;')
  expect(xml).toContain('colspan="2"')
  expect(xml).toContain('font-size: 18px')
  expect(xml).toContain('>Finding</strong>')
  expect(xml).toContain('>citation</a>Figure')
  expect(xml).not.toMatch(/href=|src=|about:blank|example.org|script|button|skip /)
})

it('falls back to the text excerpt when the selected region has no layout', () => {
  const root = document.createElement('div')
  root.innerHTML = '<table><tr><td>Finding</td></tr></table>'
  expect(excerptRegion(root, selection(root, new DOMRect()))).toBeUndefined()
})
