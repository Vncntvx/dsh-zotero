import { DOCUMENT_CONTENT_TAGS } from './inert-document-html.tsx'

const XHTML = 'http://www.w3.org/1999/xhtml'
const MAX_CONTENT = 128_000
const MAX_NODES = 1_000
const MAX_SIDE = 2_048
const STYLE = [
  'background-color',
  'border',
  'border-bottom',
  'border-collapse',
  'border-left',
  'border-right',
  'border-spacing',
  'border-top',
  'color',
  'direction',
  'display',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'line-height',
  'list-style-type',
  'margin',
  'overflow-wrap',
  'padding',
  'tab-size',
  'text-align',
  'text-decoration',
  'vertical-align',
  'white-space',
  'word-break',
]

/** Copy only the Reader body and crop the rendered copy to the current text selection. */
export function excerptRegion(root: HTMLElement, range: Range) {
  if (
    typeof range.getBoundingClientRect !== 'function' ||
    !root.contains(range.commonAncestorContainer)
  )
    return undefined
  const bounds = root.getBoundingClientRect()
  const selection = range.getBoundingClientRect()
  const left = Math.max(0, Math.floor(selection.left - bounds.left) - 4)
  const top = Math.max(0, Math.floor(selection.top - bounds.top) - 4)
  const width =
    Math.min(Math.ceil(bounds.width), Math.ceil(selection.right - bounds.left) + 4) - left
  const height =
    Math.min(Math.ceil(bounds.height), Math.ceil(selection.bottom - bounds.top) + 4) - top
  if (
    !selection.width ||
    !selection.height ||
    width <= 0 ||
    height <= 0 ||
    bounds.width > MAX_SIDE ||
    width > MAX_SIDE ||
    height > MAX_SIDE ||
    top > 8 * MAX_SIDE ||
    (root.textContent?.length ?? 0) > MAX_CONTENT
  )
    return undefined

  const owner = root.ownerDocument
  let remaining = MAX_NODES
  const copy = (node: Node, depth: number): Node | undefined => {
    if (depth > 32) remaining = 0
    if (--remaining < 0) return
    if (node instanceof Text) return owner.createTextNode(node.data)
    if (!(node instanceof HTMLElement)) return
    const tag = node.localName
    if (tag === 'img') return owner.createTextNode(node.getAttribute('alt') ?? '')
    if (!DOCUMENT_CONTENT_TAGS.has(tag)) return
    const element = owner.createElementNS(XHTML, tag) as HTMLElement
    const computed = getComputedStyle(node)
    for (const property of STYLE) {
      const value = computed.getPropertyValue(property)
      if (value && !value.includes('url(')) element.style.setProperty(property, value)
    }
    if (tag === 'table' || tag === 'td' || tag === 'th') {
      element.style.boxSizing = 'border-box'
      element.style.width = `${node.getBoundingClientRect().width}px`
    }
    for (const attribute of ['colspan', 'rowspan', 'start']) {
      const value = node.getAttribute(attribute)
      if (value && /^\d{1,4}$/u.test(value)) element.setAttribute(attribute, value)
    }
    for (const child of node.childNodes) {
      if (remaining < 0) break
      const next = copy(child, depth + 1)
      if (next) element.append(next)
    }
    return element
  }
  const content = copy(root, 0) as HTMLElement | undefined
  if (!content || remaining < 0) return undefined
  content.style.width = `${bounds.width}px`
  content.style.margin = '0'
  let background = getComputedStyle(root).backgroundColor
  for (
    let ancestor = root.parentElement;
    ancestor && background === 'rgba(0, 0, 0, 0)';
    ancestor = ancestor.parentElement
  )
    background = getComputedStyle(ancestor).backgroundColor
  const crop = owner.createElementNS(XHTML, 'div') as HTMLElement
  crop.style.position = 'absolute'
  crop.style.left = `${-left}px`
  crop.style.top = `${-top}px`
  crop.append(content)
  const markup = new XMLSerializer().serializeToString(crop)
  if (markup.length > MAX_CONTENT) return undefined
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${markup}</foreignObject></svg>`
  return { src: `data:image/svg+xml,${encodeURIComponent(svg)}`, width, height, background }
}
