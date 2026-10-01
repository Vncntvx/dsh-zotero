import { describe, expect, it } from 'vitest'
import { markdownToNoteHtml } from '../../src/local/note-format.js'

describe('blocks', () => {
  it('renders blank-line-separated paragraphs and joins soft-wrapped lines', () => {
    expect(markdownToNoteHtml('first para\nstill first\n\nsecond para')).toBe(
      '<p>first para still first</p>\n<p>second para</p>',
    )
  })

  it('renders ATX headings up to level four and keeps deeper hashes literal', () => {
    expect(markdownToNoteHtml('# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five')).toBe(
      '<h1>One</h1>\n<h2>Two</h2>\n<h3>Three</h3>\n<h4>Four</h4>\n<p>##### Five</p>',
    )
  })

  it('renders a horizontal rule from --- and *** lines', () => {
    expect(markdownToNoteHtml('---\n\n***')).toBe('<hr/>\n<hr/>')
  })

  it('renders single-level quotes as one paragraph per block', () => {
    expect(markdownToNoteHtml('> quoted line\n> still quoted\n\nafter')).toBe(
      '<blockquote><p>quoted line still quoted</p></blockquote>\n<p>after</p>',
    )
  })

  it('collapses runs of blank lines', () => {
    expect(markdownToNoteHtml('a\n\n\n\nb')).toBe('<p>a</p>\n<p>b</p>')
  })

  it('returns the empty string for empty input', () => {
    expect(markdownToNoteHtml('')).toBe('')
  })
})

describe('emphasis and code', () => {
  it('renders bold and italic but keeps underscore text literal', () => {
    expect(markdownToNoteHtml('**bold** and *italic* and max_export_refs')).toBe(
      '<p><strong>bold</strong> and <em>italic</em> and max_export_refs</p>',
    )
  })

  it('keeps inline code spans unformatted and escaped', () => {
    expect(markdownToNoteHtml('`a *b* <tag>` stays literal')).toBe(
      '<p><code>a *b* &lt;tag&gt;</code> stays literal</p>',
    )
  })

  it('keeps an unmatched backtick literal', () => {
    expect(markdownToNoteHtml('a ` b')).toBe('<p>a ` b</p>')
  })

  it('escapes fenced code verbatim, CJK included, with no formatting inside', () => {
    expect(markdownToNoteHtml('```js\nconst s = "<b>加粗</b>";\n```')).toBe(
      '<pre><code>const s = &quot;&lt;b&gt;加粗&lt;/b&gt;&quot;;</code></pre>',
    )
  })

  it('consumes an unterminated fence to the end of the input', () => {
    expect(markdownToNoteHtml('```\nnever closed')).toBe('<pre><code>never closed</code></pre>')
  })
})

describe('links', () => {
  it('renders https and zotero links, keeping their text formattable', () => {
    expect(
      markdownToNoteHtml(
        '[**paper**](https://example.io/a) and [记](zotero://user/0/items/ABCD1234)',
      ),
    ).toBe(
      '<p><a href="https://example.io/a"><strong>paper</strong></a> and ' +
        '<a href="zotero://user/0/items/ABCD1234">记</a></p>',
    )
  })

  it('keeps unknown schemes as literal text instead of anchors', () => {
    expect(markdownToNoteHtml('[click](javascript:alert(1))')).toBe(
      '<p>[click](javascript:alert(1))</p>',
    )
    expect(markdownToNoteHtml('[rel](other/page)')).toBe('<p>[rel](other/page)</p>')
  })

  it('cannot break out of the href attribute: quotes arrive escaped', () => {
    const html = markdownToNoteHtml('[x](https://a.io/"onmouseover="y")')
    expect(html).toContain('<a href="https://a.io/&quot;onmouseover=&quot;y&quot;">x</a>')
    expect(html).not.toContain('"onmouseover')
  })
})

describe('lists', () => {
  it('renders unordered and ordered lists, including 1) markers', () => {
    expect(markdownToNoteHtml('- one\n- two\n\n1. first\n2) second')).toBe(
      '<ul><li>one</li><li>two</li></ul>\n<ol><li>first</li><li>second</li></ol>',
    )
  })

  it('renders one nested level, with a later continuation as a trailing paragraph', () => {
    expect(markdownToNoteHtml('- outer\n  - inner\n  - inner 2\n  continued\n- next')).toBe(
      '<ul><li>outer<ul><li>inner</li><li>inner 2</li></ul><p>continued</p></li><li>next</li></ul>',
    )
  })

  it('joins a continuation line that comes before any nested item into the item', () => {
    expect(markdownToNoteHtml('- outer\n  continued\n  - inner')).toBe(
      '<ul><li>outer continued<ul><li>inner</li></ul></li></ul>',
    )
  })

  it('renders an ordered nested list and an indented item after trailing text', () => {
    expect(markdownToNoteHtml('- outer\n  text\n  1. inner\n  2. inner 2')).toBe(
      '<ul><li>outer text<ol><li>inner</li><li>inner 2</li></ol></li></ul>',
    )
  })

  it('treats an indented list item after trailing text as literal continuation', () => {
    expect(markdownToNoteHtml('- outer\n  - inner\n  tail text\n  - inner2')).toBe(
      '<ul><li>outer<ul><li>inner</li></ul><p>tail text - inner2</p></li></ul>',
    )
  })

  it('keeps list-item formatting working', () => {
    expect(markdownToNoteHtml('1. `code` and **bold**\n2. [a](https://b.io)')).toBe(
      '<ol><li><code>code</code> and <strong>bold</strong></li><li><a href="https://b.io">a</a></li></ol>',
    )
  })
})

describe('tables', () => {
  it('renders a pipe table with the documented separator row', () => {
    expect(markdownToNoteHtml('| method | n |\n|---|---|\n| A | 4 |\n| B | 5 |')).toBe(
      '<table><thead><tr><th>method</th><th>n</th></tr></thead><tbody><tr><td>A</td><td>4</td></tr><tr><td>B</td><td>5</td></tr></tbody></table>',
    )
  })

  it('accepts alignment colons and header rows without outer pipes', () => {
    expect(markdownToNoteHtml('a | b\n|:---|---:|\n1 | 2')).toBe(
      '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
    )
  })

  it('pads short rows and truncates long ones to the header width', () => {
    expect(markdownToNoteHtml('| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |')).toBe(
      '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td></td></tr><tr><td>1</td><td>2</td></tr></tbody></table>',
    )
  })

  it('keeps pipe lines without a separator row as literal paragraph text', () => {
    expect(markdownToNoteHtml('a | b\nc | d')).toBe('<p>a | b c | d</p>')
  })
})

describe('the escape-unknown guarantee', () => {
  it('never lets raw markup through: scripts and handlers become visible text', () => {
    expect(markdownToNoteHtml('<script>alert(1)</script>')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    )
    expect(markdownToNoteHtml('<img src=x onerror=alert(1)>')).toBe(
      '<p>&lt;img src=x onerror=alert(1)&gt;</p>',
    )
  })

  it('escapes ampersands and angle brackets inside formatted runs', () => {
    expect(markdownToNoteHtml('**a & b** < c >')).toBe(
      '<p><strong>a &amp; b</strong> &lt; c &gt;</p>',
    )
  })

  it('preserves CJK text and typographic punctuation verbatim', () => {
    expect(markdownToNoteHtml('**方法**：“定义 2”给出 —— 见第 3 节。')).toBe(
      '<p><strong>方法</strong>：“定义 2”给出 —— 见第 3 节。</p>',
    )
  })

  it('keeps a paragraph that begins with an emphasized word from becoming a list', () => {
    expect(markdownToNoteHtml('*emphasized* opening line\nmore text')).toBe(
      '<p><em>emphasized</em> opening line more text</p>',
    )
  })

  it('ends a paragraph when a real block starts on the next line', () => {
    expect(markdownToNoteHtml('intro text\n- item')).toBe(
      '<p>intro text</p>\n<ul><li>item</li></ul>',
    )
  })
})

describe('task lists', () => {
  it('renders unchecked and checked task list items with checkbox controls and classes', () => {
    expect(markdownToNoteHtml('- [ ] todo\n- [x] done\n* [X] also done')).toBe(
      '<ul class="task-list">' +
        '<li class="task-list-item"><input type="checkbox" disabled="" /> todo</li>' +
        '<li class="task-list-item"><input type="checkbox" checked="" disabled="" /> done</li>' +
        '<li class="task-list-item"><input type="checkbox" checked="" disabled="" /> also done</li>' +
        '</ul>',
    )
  })

  it('renders a mixed list where only task items receive checkbox markup and the list carries task-list class', () => {
    expect(markdownToNoteHtml('- [ ] task\n- plain item')).toBe(
      '<ul class="task-list">' +
        '<li class="task-list-item"><input type="checkbox" disabled="" /> task</li>' +
        '<li>plain item</li>' +
        '</ul>',
    )
  })

  it('renders nested task lists with appropriate classes at each level', () => {
    expect(markdownToNoteHtml('- [ ] parent\n  - [x] child\n  continued\n- next')).toBe(
      '<ul class="task-list">' +
        '<li class="task-list-item"><input type="checkbox" disabled="" /> parent' +
        '<ul class="task-list"><li class="task-list-item"><input type="checkbox" checked="" disabled="" /> child</li></ul>' +
        '<p>continued</p></li>' +
        '<li>next</li></ul>',
    )
  })

  it('keeps invalid task markers as literal list items', () => {
    expect(markdownToNoteHtml('- [  ] spaced\n- [x]nospace')).toBe(
      '<ul><li>[  ] spaced</li><li>[x]nospace</li></ul>',
    )
  })
})

describe('highlights', () => {
  it('converts ==text== to <mark>text</mark>', () => {
    expect(markdownToNoteHtml('This is ==important== text.')).toBe(
      '<p>This is <mark>important</mark> text.</p>',
    )
  })

  it('supports CJK characters and typographic punctuation inside highlights', () => {
    expect(markdownToNoteHtml('关键结果：==显著优于基线模型（p < 0.01）==。')).toBe(
      '<p>关键结果：<mark>显著优于基线模型（p &lt; 0.01）</mark>。</p>',
    )
  })

  it('composes with bold, italic, and links in both directions', () => {
    expect(markdownToNoteHtml('==**bold mark**== and **==marked bold==**')).toBe(
      '<p><mark><strong>bold mark</strong></mark> and <strong><mark>marked bold</mark></strong></p>',
    )
    expect(markdownToNoteHtml('==*italic mark*==')).toBe('<p><mark><em>italic mark</em></mark></p>')
    expect(markdownToNoteHtml('[==link text==](https://zotero.org)')).toBe(
      '<p><a href="https://zotero.org"><mark>link text</mark></a></p>',
    )
    expect(markdownToNoteHtml('==[marked link](https://zotero.org)==')).toBe(
      '<p><mark><a href="https://zotero.org">marked link</a></mark></p>',
    )
  })

  it('leaves empty, adjacent, and unclosed markers literal', () => {
    expect(markdownToNoteHtml('====')).toBe('<p>====</p>')
    expect(markdownToNoteHtml('== unclosed')).toBe('<p>== unclosed</p>')
    expect(markdownToNoteHtml('== spaced ==')).toBe('<p>== spaced ==</p>')
  })

  it('permits single equal signs inside highlights', () => {
    expect(
      markdownToNoteHtml('==accuracy = 95%== and ==a=b== and ==[link](https://a.io?q=1)=='),
    ).toBe(
      '<p><mark>accuracy = 95%</mark> and <mark>a=b</mark> and <mark><a href="https://a.io?q=1">link</a></mark></p>',
    )
  })
})

describe('math expressions', () => {
  it('renders single-line display math blocks as <math-display>', () => {
    expect(markdownToNoteHtml('$$ E = mc^2 $$')).toBe('<math-display>E = mc^2</math-display>')
  })

  it('renders multiline display math blocks preserving newlines and escaping special chars', () => {
    expect(markdownToNoteHtml('$$\n\\begin{matrix}\na & b \\\\\nc < d\n\\end{matrix}\n$$')).toBe(
      '<math-display>\\begin{matrix}\na &amp; b \\\\\nc &lt; d\n\\end{matrix}</math-display>',
    )
  })

  it('renders multiline display math with content on the opening and closing fence lines', () => {
    expect(markdownToNoteHtml('$$ \\alpha + \\beta\n\\gamma + \\delta $$')).toBe(
      '<math-display>\\alpha + \\beta\n\\gamma + \\delta</math-display>',
    )
  })

  it('shields display math from bold and italic corruption', () => {
    expect(markdownToNoteHtml('$$\nf(x^*) = a * b * c\n$$')).toBe(
      '<math-display>f(x^*) = a * b * c</math-display>',
    )
  })

  it('consumes unterminated display math to the end of input', () => {
    expect(markdownToNoteHtml('$$\nx = 1')).toBe('<math-display>x = 1</math-display>')
  })

  it('renders inline math as <math-inline> and protects formulas from emphasis', () => {
    expect(markdownToNoteHtml('Formula $x^*_1 < x^*_2$ is valid.')).toBe(
      '<p>Formula <math-inline>x^*_1 &lt; x^*_2</math-inline> is valid.</p>',
    )
  })

  it('shields inline math with multiplication asterisks from italic', () => {
    expect(markdownToNoteHtml('Compute $a * b * c$ now.')).toBe(
      '<p>Compute <math-inline>a * b * c</math-inline> now.</p>',
    )
  })

  it('leaves currency amounts and ranges literal without creating math spans', () => {
    expect(markdownToNoteHtml('The item costs $50 and the tax is $10.')).toBe(
      '<p>The item costs $50 and the tax is $10.</p>',
    )
    expect(markdownToNoteHtml('Expected range is $10-$20.')).toBe(
      '<p>Expected range is $10-$20.</p>',
    )
    expect(markdownToNoteHtml('Price is $100.')).toBe('<p>Price is $100.</p>')
    expect(markdownToNoteHtml('a $ b')).toBe('<p>a $ b</p>')
  })

  it('handles escaped dollars inside inline math correctly', () => {
    expect(markdownToNoteHtml('$a = \\$b$')).toBe('<p><math-inline>a = \\$b</math-inline></p>')
  })

  it('accepts indented display math blocks and rejects triple dollars', () => {
    expect(markdownToNoteHtml('  $$ E = mc^2 $$')).toBe('<math-display>E = mc^2</math-display>')
    expect(markdownToNoteHtml('$$$\nnot math\n$$$')).toBe('<p>$$$ not math $$$</p>')
  })

  it('prevents inline math from crossing code span tokens or leaking control bytes', () => {
    const html = markdownToNoteHtml('$a `code` b$')
    expect(html).toContain('<code>code</code>')
    expect(html).not.toContain('\x00')
  })
})

describe('complex compositions', () => {
  it('renders inline math and highlights inside table cells', () => {
    expect(markdownToNoteHtml('| item | formula |\n|---|---|\n| ==key== | $x < y$ |')).toBe(
      '<table><thead><tr><th>item</th><th>formula</th></tr></thead><tbody><tr><td><mark>key</mark></td><td><math-inline>x &lt; y</math-inline></td></tr></tbody></table>',
    )
  })

  it('renders task items containing inline code, highlights, and math', () => {
    expect(markdownToNoteHtml('- [ ] Verify `solver()` with ==fast== $O(n)$ check')).toBe(
      '<ul class="task-list"><li class="task-list-item"><input type="checkbox" disabled="" /> Verify <code>solver()</code> with <mark>fast</mark> <math-inline>O(n)</math-inline> check</li></ul>',
    )
  })

  it('keeps math and highlight delimiters literal inside code spans and blocks', () => {
    expect(markdownToNoteHtml('`$x$` and `==y==` and `- [ ]`')).toBe(
      '<p><code>$x$</code> and <code>==y==</code> and <code>- [ ]</code></p>',
    )
    expect(markdownToNoteHtml('```\n$$ not math $$\n== not highlight ==\n```')).toBe(
      '<pre><code>$$ not math $$\n== not highlight ==</code></pre>',
    )
  })
})
