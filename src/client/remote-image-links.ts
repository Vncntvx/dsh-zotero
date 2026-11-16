/** Display remote figures as explicit links; document rendering never fetches them. */
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown } from 'mdast-util-math'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-math'
import type { Nodes } from 'mdast'
import { webUrlOf } from './actions/web-url.ts'

export function remoteImageLinks(markdown: string): string {
  const root = fromMarkdown(markdown, {
    extensions: [gfm({ singleTilde: false }), math()],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  })
  const definitions = new Map<string, string>()
  const walk = (node: Nodes, action: (node: Nodes) => void): void => {
    action(node)
    if ('children' in node) for (const child of node.children) walk(child, action)
  }
  walk(root, (node) => {
    if (node.type === 'definition' && !definitions.has(node.identifier.toUpperCase()))
      definitions.set(node.identifier.toUpperCase(), node.url)
  })
  const edits: { start: number; end: number; text: string }[] = []
  walk(root, (node) => {
    const destination =
      node.type === 'image'
        ? node.url
        : node.type === 'imageReference'
          ? definitions.get(node.identifier.toUpperCase())
          : undefined
    if (destination === undefined || !/^https?:/i.test(destination)) return
    // fromMarkdown always attaches source offsets; the tree is never transformed.
    const start = node.position!.start.offset!
    const end = node.position!.end.offset!
    const label = (
      (node.type === 'image' || node.type === 'imageReference' ? node.alt : '') || destination
    ).replace(/[\\\[\]]/g, '\\$&')
    const url = webUrlOf(destination)
    edits.push({
      start,
      end,
      text: url === undefined ? label : `[${label}](<${url.replaceAll('>', '%3E')}>)`,
    })
  })
  let result = markdown
  for (const edit of edits.sort((a, b) => b.start - a.start))
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end)
  return result
}
