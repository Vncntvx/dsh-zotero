const BLOCK_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DD',
  'DIV',
  'DL',
  'DT',
  'FIGCAPTION',
  'FIGURE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TD',
  'TH',
  'TR',
  'UL',
])

const MAX_MATCHES = 1000

interface TextNodeRange {
  readonly node: Text
  readonly start: number
  readonly end: number
}

function blockOf(node: Text, root: HTMLElement): Element {
  for (
    let element = node.parentElement;
    element && element !== root;
    element = element.parentElement
  ) {
    if (BLOCK_TAGS.has(element.tagName)) return element
  }
  return root
}

function textIndex(root: HTMLElement) {
  const nodes: TextNodeRange[] = []
  const chunks: string[] = []
  let length = 0
  let previousBlock: Element | undefined
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let next = walker.nextNode(); next; next = walker.nextNode()) {
    const node = next as Text
    if (!node.data || node.parentElement?.closest('button,[hidden],[aria-hidden="true"]')) {
      previousBlock = undefined
      continue
    }
    const block = blockOf(node, root)
    const previousSibling = node.previousSibling
    const lineBreak = previousSibling instanceof HTMLBRElement
    if (previousBlock && (block !== previousBlock || lineBreak)) {
      chunks.push('\n')
      length += 1
    }
    const start = length
    chunks.push(node.data)
    length += node.length
    nodes.push({ node, start, end: length })
    previousBlock = block
  }
  return { nodes, text: chunks.join('') }
}

/** Find case-insensitive text occurrences across inline markup without crossing document blocks. */
export function searchTextNodes(root: HTMLElement, query: string) {
  const needle = query.trim()
  if (!needle) return { ranges: [] as Range[], truncated: false }
  const indexed = textIndex(root)
  const matcher = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')
  const ranges: Range[] = []
  let truncated = false
  let nodeIndex = 0
  const startNodeAt = (offset: number) => {
    while (nodeIndex < indexed.nodes.length && indexed.nodes[nodeIndex]!.end <= offset)
      nodeIndex += 1
    const entry = indexed.nodes[nodeIndex]
    return entry && offset >= entry.start && offset < entry.end ? entry : undefined
  }
  const endNodeAt = (offset: number) => {
    let index = nodeIndex
    while (index < indexed.nodes.length && indexed.nodes[index]!.end < offset) index += 1
    const entry = indexed.nodes[index]
    return entry && offset > entry.start && offset <= entry.end ? entry : undefined
  }
  for (const match of indexed.text.matchAll(matcher)) {
    if (ranges.length === MAX_MATCHES) {
      truncated = true
      break
    }
    const start = match.index
    const end = start + match[0].length
    const startNode = startNodeAt(start)
    const endNode = endNodeAt(end)
    if (!startNode || !endNode) continue
    const range = root.ownerDocument.createRange()
    range.setStart(startNode.node, start - startNode.start)
    range.setEnd(endNode.node, end - endNode.start)
    ranges.push(range)
  }
  return { ranges, truncated }
}
