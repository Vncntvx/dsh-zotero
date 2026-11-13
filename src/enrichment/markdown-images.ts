/** Parse image references with the same GFM/math grammar as the document renderer. */
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown } from 'mdast-util-math'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-math'
import type { Nodes } from 'mdast'
import { artifactImageName } from '../artifact-images.js'

export function markdownImageReferences(markdown: string): readonly string[] {
  const root = fromMarkdown(markdown, {
    extensions: [gfm({ singleTilde: false }), math()],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  })
  const definitions = new Map<string, string>()
  const visit = (node: Nodes, action: (node: Nodes) => void): void => {
    action(node)
    if ('children' in node) for (const child of node.children) visit(child, action)
  }
  visit(root, (node) => {
    if (node.type === 'definition') {
      const identifier = node.identifier.toUpperCase()
      if (!definitions.has(identifier)) definitions.set(identifier, node.url)
    }
  })
  const names = new Set<string>()
  visit(root, (node) => {
    const destination =
      node.type === 'image'
        ? node.url
        : node.type === 'imageReference'
          ? definitions.get(node.identifier.toUpperCase())
          : undefined
    if (destination === undefined) return
    const name = artifactImageName(destination)
    if (name !== undefined) names.add(name)
    else if (/^(?:\.\/)?images\//u.test(destination))
      throw new Error('The Markdown contains an invalid local figure reference')
  })
  return [...names].sort()
}
