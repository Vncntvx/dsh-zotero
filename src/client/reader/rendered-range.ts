import type { TextRange } from '../../reader/evidence.ts'

export function renderedRange(root: HTMLElement, { start, end }: TextRange) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= end)
    return
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let offset = 0
  let range: Range | undefined
  for (let next = walker.nextNode(); next; next = walker.nextNode()) {
    const node = next as Text
    const after = offset + node.length
    if (!range && start >= offset && start < after) {
      range = root.ownerDocument.createRange()
      range.setStart(node, start - offset)
    }
    if (range && end <= after) {
      range.setEnd(node, end - offset)
      return range
    }
    offset = after
  }
}
