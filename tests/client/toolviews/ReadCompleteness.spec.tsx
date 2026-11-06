// @vitest-environment jsdom
/** Source completeness and card preview counts convey separate facts. */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ItemToolView } from '../../../src/client/toolviews/ItemToolView.tsx'
import { WriteToolView } from '../../../src/client/toolviews/WriteToolView.tsx'
import { settled } from '../helpers/blocks.ts'
import { createToolViewProps, mockUseDisclosure } from '../helpers/mock-disclosure.ts'
import { mockT } from '../helpers/mock-translate.ts'
import { getMetaOf } from '../../../src/sources/decoders.js'
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('../helpers/primitives-stub.ts')
  return primitivesStub()
})
afterEach(cleanup)
it('retains independent page windows and labels a complete collection with fewer displayed previews', () => {
  const meta = {
    title: 'Paper',
    notes: { total: 51, returned: 1, completeness: 'page', offset: 10, limit: 1, nextOffset: 11 },
    annotations: { total: 101, returned: 101, completeness: 'complete' },
    notesPreview: [],
    annotationsPreview: [{ ref: 'zotero://user/0/annotation/ANNO1234', preview: 'A' }],
  }
  expect(getMetaOf(meta).notes).toEqual(meta.notes)
  render(
    <ItemToolView
      {...createToolViewProps({
        toolName: 'zotero_get',
        block: settled({ meta }),
        useDisclosure: mockUseDisclosure(true),
        t: mockT,
      })}
    />,
  )
  expect(screen.getByText(/指定页：偏移 10，返回 1 \/ 51 条/)).toBeTruthy()
  expect(screen.getByText(/完整读取：101 条/)).toBeTruthy()
  expect(screen.getByText(/卡片预览：1 条/)).toBeTruthy()
})
it('shows an already satisfied scalar write as a no-change receipt', () => {
  const block = settled({
    call: {
      name: 'zotero_update_item',
      argsRaw: '{"ref":"zotero://user/0/item/ABCD1234","set":{"title":"Saved"}}',
    },
    meta: {
      kind: 'applied',
      unchanged: true,
      changedCount: 0,
      version: 7,
      ref: 'zotero://user/0/item/ABCD1234',
    },
    content: [{ type: 'text', text: 'Already satisfied; no fields changed.' }],
  })
  const { container } = render(
    <WriteToolView
      {...createToolViewProps({
        toolName: 'zotero_update_item',
        block,
        useDisclosure: mockUseDisclosure(true),
        t: mockT,
      })}
    />,
  )
  expect(container.querySelector('[data-state="noop"]')).toBeTruthy()
})
