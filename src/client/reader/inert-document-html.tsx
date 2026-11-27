import { createElement, Fragment, type ReactNode } from 'react'

export const DOCUMENT_CONTENT_TAGS = new Set([
  'a',
  'b',
  'blockquote',
  'br',
  'caption',
  'code',
  'dd',
  'del',
  'div',
  'dl',
  'dt',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'ins',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  's',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
])
const SKIP_TAGS = new Set([
  'head',
  'iframe',
  'noscript',
  'object',
  'script',
  'style',
  'template',
  'title',
])
function tableSpan(node: HTMLElement, name: 'colspan' | 'rowspan') {
  const span = Number(node.getAttribute(name))
  return Number.isInteger(span) && span >= 1 && span <= 100 ? span : undefined
}

/** Parse in an inert template and recreate content with no active URLs or attributes. */
export function inertDocumentHtml(
  html: string,
  imageLabel: string,
  renderImage?: (key: string, alt: string | undefined) => ReactNode,
) {
  const template = document.createElement('template')
  template.innerHTML = html
  let remaining = 4_000
  let truncated = false
  function children(parent: Node, depth: number): ReactNode[] {
    const rendered: ReactNode[] = []
    for (const node of parent.childNodes) {
      if (depth > 32 || --remaining < 0) {
        truncated = true
        break
      }
      if (node instanceof Text) {
        rendered.push(node.data)
        continue
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue
      const element = node as HTMLElement
      const tag = element.localName
      if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml' || SKIP_TAGS.has(tag)) continue
      const key = rendered.length
      if (tag === 'img') {
        const alt = element.getAttribute('alt')?.trim()
        const attachment = element.getAttribute('data-attachment-key')
        rendered.push(
          <Fragment key={key}>
            {(attachment && renderImage?.(attachment, alt)) || (
              <span>{alt ? `${alt} · ${imageLabel}` : imageLabel}</span>
            )}
          </Fragment>,
        )
        continue
      }
      const attrs =
        tag === 'td' || tag === 'th'
          ? { key, colSpan: tableSpan(element, 'colspan'), rowSpan: tableSpan(element, 'rowspan') }
          : { key }
      if (tag === 'br' || tag === 'hr') rendered.push(createElement(tag, attrs))
      else
        rendered.push(
          createElement(
            DOCUMENT_CONTENT_TAGS.has(tag) ? tag : Fragment,
            attrs,
            children(node, depth + 1),
          ),
        )
    }
    return rendered
  }
  return { nodes: children(template.content, 0), truncated }
}
