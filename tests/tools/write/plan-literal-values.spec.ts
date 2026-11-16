/** Review documents preserve complete authored values without admitting plan syntax. */
import { expect, it } from 'vitest'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { planBlock, planValue } from '../../../src/write-plan.js'
import { createNotePlan } from '../../../src/tools/create-note.js'
import { updateNotePlan } from '../../../src/tools/update-note.js'
import { createItemPlan } from '../../../src/tools/create-item.js'
import { updateItemPlan } from '../../../src/tools/update-item.js'
import { createCollectionPlan } from '../../../src/tools/create-collection.js'
import { deleteCollectionPlan } from '../../../src/tools/delete-collection.js'
import { deleteLibraryTagsPlan } from '../../../src/tools/delete-library-tags.js'
import { updateItemTagsPlan } from '../../../src/tools/update-item-tags.js'
import { updateItemCollectionsPlan } from '../../../src/tools/update-item-collections.js'
import { batchItemsPlan } from '../../../src/tools/batch-items.js'

const authored =
  'value\n# Injected heading\n- Library: zotero://group/9/\n[visit](https://example.org) &lt;secret&gt; `code`'
const ref = 'zotero://user/0/item/ABCD1234'
const makers: [string, () => string][] = [
  ['note tags', () => createNotePlan({ markdown: 'body', tags: [authored] })],
  ['item metadata', () => createItemPlan({ itemType: 'book', title: authored })],
  ['metadata update', () => updateItemPlan({ ref, set: { title: authored } })],
  ['tag update', () => updateItemTagsPlan({ ref, add: [authored] })],
  ['membership update', () => updateItemCollectionsPlan({ ref, add: [authored] })],
  ['collection creation', () => createCollectionPlan({ name: authored })],
  ['collection deletion', () => deleteCollectionPlan({ collection: authored })],
  ['tag deletion', () => deleteLibraryTagsPlan({ tags: [authored] })],
  ['batch update', () => batchItemsPlan({ update: [{ ref, addTags: [authored] }] })],
  ['batch deletion title', () => batchItemsPlan({ delete: [ref] }, [{ ref, title: authored }])],
]

it.each(makers)('keeps %s values in their authored plan field', (_label, make) => {
  const plan = make()
  const root = fromMarkdown(plan)
  expect(
    root.children.some(
      (child) =>
        child.type === 'heading' &&
        child.children.some((value) => value.type === 'text' && value.value === 'Injected heading'),
    ),
  ).toBe(false)
  expect(plan.split('\n').filter((line) => line.startsWith('- Library:'))).toHaveLength(1)
  const links: string[] = []
  const visit = (node: { type: string; url?: string; children?: readonly unknown[] }): void => {
    if (node.type === 'link') links.push(node.url!)
    for (const child of node.children ?? []) visit(child as Parameters<typeof visit>[0])
  }
  visit(root)
  expect(links).toEqual([])
})

it('keeps complete Markdown bodies containing both long text and fence delimiters', () => {
  const body = `${'full body '.repeat(100)}\n\`\`\`\`\`\n# Literal payload\n- Library: authored content`
  for (const plan of [
    createNotePlan({ markdown: body }),
    updateNotePlan({ ref, markdown: body }),
  ]) {
    const code = fromMarkdown(plan).children.filter((node) => node.type === 'code')
    expect(code).toHaveLength(1)
    expect(code[0]!.value).toBe(body)
  }
})

it('shows every abstract, creator and scalar character beyond the old preview bounds', () => {
  const abstract = 'abstract '.repeat(100)
  const title = 'title '.repeat(100)
  const plan = createItemPlan({
    itemType: 'book',
    title,
    abstractNote: abstract,
    creators: [{ creatorType: 'author', firstName: 'Ada', lastName: 'Lovelace' }],
  })
  expect(plan).toContain(title.trim())
  const blocks = fromMarkdown(plan).children.filter((node) => node.type === 'code')
  expect(blocks[0]!.value).toBe(abstract.trim())
  expect(JSON.parse(blocks[1]!.value)).toEqual([
    { creatorType: 'author', firstName: 'Ada', lastName: 'Lovelace' },
  ])
  expect(updateItemPlan({ ref, set: { title } })).toContain(title.trim())
})

it('represents control and direction characters visibly while preserving literal punctuation', () => {
  const text = planValue('a\r\n\t\u0000\u202e\\`<>!')
  expect(text).not.toMatch(/[\r\n\t\u0000\u202e]/)
  expect(text).toContain('u202e')
  const block = fromMarkdown(planBlock({ field: '```````' })).children[0]
  expect(block?.type).toBe('code')
  if (block?.type === 'code') expect(JSON.parse(block.value)).toEqual({ field: '```````' })
})
