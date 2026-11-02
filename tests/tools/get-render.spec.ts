import { describe, expect, it } from 'vitest'
import { renderGet } from '../../src/tools/get.js'
describe('zotero_get render', () => {
  function render(value: never): string {
    return (renderGet({} as never, value)[0] as { text: string }).text
  }

  it('omits the additional-fields line when every extra field is undefined', () => {
    const text = render({
      ref: 'zotero://user/0/item/ABCD1234',
      itemType: 'dataset',
      title: 'T',
      creators: [],
      abstractTruncated: false,
      tags: [],
      collections: [],
      children: { total: 0 },
      extraFields: { ghost: undefined },
    } as never)
    expect(text).not.toContain('Additional fields')
  })

  it('JSON-encodes non-string extra field values', () => {
    const text = render({
      ref: 'zotero://user/0/item/ABCD1234',
      itemType: 'dataset',
      title: 'T',
      creators: [],
      abstractTruncated: false,
      tags: [],
      collections: [],
      children: { total: 0 },
      extraFields: { versionNumber: 2, flags: ['a', true] },
    } as never)
    expect(text).toContain('versionNumber: 2')
    expect(text).toContain('flags: ["a",true]')
  })

  it('renders the note body with a truncation marker for note items', () => {
    const truncated = render({
      ref: 'zotero://user/0/item/NOTE1111',
      itemType: 'note',
      title: '',
      creators: [],
      abstractTruncated: false,
      tags: [],
      collections: [],
      children: { total: 0 },
      noteBody: { text: 'first line of the note', truncated: true },
    } as never)
    expect(truncated).toContain('Note (truncated): first line of the note')

    const full = render({
      ref: 'zotero://user/0/item/NOTE2222',
      itemType: 'note',
      title: '',
      creators: [],
      abstractTruncated: false,
      tags: [],
      collections: [],
      children: { total: 0 },
      noteBody: { text: 'short note', truncated: false },
    } as never)
    expect(full).toContain('Note: short note')
  })
})
