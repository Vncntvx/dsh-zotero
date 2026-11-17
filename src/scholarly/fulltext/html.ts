/** Structural academic HTML conversion; invisible subtrees never enter scholarly evidence. */
import { parse, type DefaultTreeAdapterTypes as Tree } from 'parse5'

const HIDDEN_TAGS = new Set([
  'script',
  'style',
  'nav',
  'button',
  'svg',
  'noscript',
  'template',
  'iframe',
  'object',
  'embed',
])
const BLOCK_TAGS = new Set([
  'p',
  'div',
  'section',
  'article',
  'figure',
  'header',
  'footer',
  'address',
])
function attr(node: Tree.Element, name: string): string | undefined {
  return node.attrs.find((attribute) => attribute.name === name)?.value
}
function hidden(node: Tree.Element): boolean {
  return (
    HIDDEN_TAGS.has(node.tagName) ||
    attr(node, 'hidden') !== undefined ||
    attr(node, 'aria-hidden')?.toLowerCase() === 'true' ||
    /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))\s*(?:!important)?\s*(?:;|$)/i.test(
      attr(node, 'style') ?? '',
    )
  )
}
function element(node: Tree.Node): node is Tree.Element {
  return 'tagName' in node
}
function findArticle(node: Tree.Node, depth = 0): Tree.Element | undefined {
  if (depth > 256) throw new Error('Academic HTML exceeds the 256-level nesting limit.')
  if (element(node) && hidden(node)) return undefined
  if (element(node) && node.tagName === 'article') return node
  if ('childNodes' in node)
    for (const child of node.childNodes) {
      const article = findArticle(child, depth + 1)
      if (article) return article
    }
  return undefined
}
function children(node: Tree.Element, depth: number): string {
  return node.childNodes.map((child) => convert(child, depth + 1)).join('')
}
function inline(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function table(node: Tree.Element, depth: number): string {
  const rows: Tree.Element[] = []
  const collect = (parent: Tree.Element): void => {
    for (const child of parent.childNodes)
      if (element(child) && !hidden(child)) {
        if (child.tagName === 'tr') rows.push(child)
        else if (['thead', 'tbody', 'tfoot'].includes(child.tagName)) collect(child)
      }
  }
  collect(node)
  const carry = new Map<number, { text: string; remaining: number }>()
  const grid: string[][] = []
  let cells = 0
  let characters = 0
  const spanOf = (cell: Tree.Element, name: string): number => {
    const raw = attr(cell, name)
    if (raw === undefined) return 1
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 1000)
      throw new Error('Academic HTML table has an invalid or excessive cell span.')
    return Number(raw)
  }
  for (const row of rows) {
    const values: string[] = []
    for (const [index, pending] of carry) {
      values[index] = pending.text
      if (--pending.remaining === 0) carry.delete(index)
    }
    let column = 0
    for (const cell of row.childNodes) {
      if (!element(cell) || hidden(cell) || !['td', 'th'].includes(cell.tagName)) continue
      const text = inline(children(cell, depth + 1)).replaceAll('|', '\\|')
      const width = spanOf(cell, 'colspan'),
        height = spanOf(cell, 'rowspan')
      while (values[column] !== undefined) column++
      for (let offset = 0; offset < width; offset++) {
        values[column + offset] = text
        if (height > 1) carry.set(column + offset, { text, remaining: height - 1 })
      }
      column += width
    }
    cells += values.length
    characters += values.reduce((total, value) => total + value.length, 0)
    if (cells > 100_000 || characters > 8 * 1_048_576)
      throw new Error('Academic HTML table exceeds its conversion budget.')
    grid.push(values)
  }
  if (grid.length === 0) return ''
  const width = Math.max(...grid.map((row) => row.length))
  const line = (row: string[]) =>
    `| ${Array.from({ length: width }, (_, index) => row[index] ?? '').join(' | ')} |`
  const hasHeader = rows[0]!.childNodes.some((cell) => element(cell) && cell.tagName === 'th')
  const header = hasHeader ? grid.shift()! : Array<string>(width).fill('')
  const caption = node.childNodes.find((child) => element(child) && child.tagName === 'caption')
  return `\n\n${caption && element(caption) ? `${inline(children(caption, depth + 1))}\n\n` : ''}${[line(header), line(Array<string>(width).fill('---')), ...grid.map(line)].join('\n')}\n\n`
}

function convert(node: Tree.Node, depth: number): string {
  if (depth > 256) throw new Error('Academic HTML exceeds the 256-level nesting limit.')
  if (node.nodeName === '#text' && 'value' in node) return node.value.replace(/[\t\r\n ]+/g, ' ')
  if (!element(node) || hidden(node)) return ''
  if (node.tagName === 'math') {
    const text = attr(node, 'alttext') ?? inline(children(node, depth))
    return attr(node, 'display') === 'block' ? `\n$$${text}$$\n` : `$${text}$`
  }
  if (node.tagName === 'table') return table(node, depth)
  if (node.tagName === 'br') return '\n'
  const text = children(node, depth)
  if (/^h[1-6]$/.test(node.tagName))
    return `\n\n${'#'.repeat(Number(node.tagName[1]))} ${inline(text)}\n\n`
  if (node.tagName === 'figcaption') return `\n[${inline(text)}]\n`
  if (node.tagName === 'li') return `\n- ${text.trim().replaceAll('\n', '\n  ')}\n`
  if (node.tagName === 'ul' || node.tagName === 'ol') return `\n${text.trim()}\n`
  if (node.tagName === 'blockquote')
    return `\n\n${text
      .trim()
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')}\n\n`
  if (BLOCK_TAGS.has(node.tagName)) return `\n\n${text}\n\n`
  return text
}

export function academicHtml(html: string): string | undefined {
  const article = findArticle(parse(html))
  if (!article) return undefined
  return convert(article, 0)
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
