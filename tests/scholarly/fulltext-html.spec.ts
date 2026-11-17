/** Academic HTML uses its DOM structure for visibility, nesting, tables, entities and formulas. */
import { expect, it } from 'vitest'
import { academicHtml } from '../../src/scholarly/fulltext/html.js'

it.each([
  '<noscript>hidden <b>nested</b></noscript>',
  '<template><p>hidden</p></template>',
  '<iframe>hidden</iframe>',
  '<object>hidden</object>',
  '<embed src="hidden">',
  '<div hidden><p>hidden <span>nested</span></p></div>',
  '<span aria-hidden="true">hidden</span>',
  '<div style="color:red; display: none !important"><p>hidden</p></div>',
  '<div style="visibility: collapse">hidden</div>',
])('excludes an invisible subtree: %s', (hidden) => {
  const text = academicHtml(`<article><h1>Visible</h1>${hidden}<p>retained paragraph</p></article>`)
  expect(text).toBe('# Visible\n\nretained paragraph')
})
it('parses quoted brackets, upper-case tags and malformed but recoverable HTML', () => {
  expect(academicHtml('<ARTICLE title="1 > 0"><P>alpha &amp; beta<P>gamma</ARTICLE>')).toBe(
    'alpha & beta\n\ngamma',
  )
  expect(academicHtml('<div hidden><article>invisible</article></div>')).toBeUndefined()
})
it('preserves nested list order and complete table rows with merged cells', () => {
  const text = academicHtml(
    '<article><ul><li>first<ul><li>nested</li></ul></li><li>second</li></ul><table><caption>Measurements</caption><tr><th>Group</th><th>Value</th></tr><tr><td rowspan="2">A</td><td>1</td></tr><tr><td>2</td></tr></table></article>',
  )!
  expect(text).toMatch(/- first\n  - nested\n\n- second/)
  expect(text).toContain('Measurements\n\n| Group | Value |\n| --- | --- |\n| A | 1 |\n| A | 2 |')
})
it('preserves decoded formula attributes and fallback MathML text without double decoding prose', () => {
  const text = academicHtml(
    '<article><p>&amp;lt;literal&amp;gt; <math alttext="a &lt; b">ignored</math> <math display="block"><mi>x</mi><mo>+</mo><mi>y</mi></math></p></article>',
  )!
  expect(text).toContain('&lt;literal&gt; $a < b$')
  expect(text).toContain('$$x+y$$')
})
it('refuses excessive nesting instead of returning a partially converted document', () => {
  expect(() =>
    academicHtml('<article>' + '<div>'.repeat(257) + 'body' + '</div>'.repeat(257) + '</article>'),
  ).toThrow('nesting limit')
})
