// @vitest-environment jsdom
/** Source completeness and card preview counts convey separate facts. */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ItemToolView } from '../../../src/client/toolviews/ItemToolView.tsx'
import { settled } from '../helpers/blocks.ts'
import { createToolViewProps, mockUseDisclosure } from '../helpers/mock-disclosure.ts'
import { mockT } from '../helpers/mock-translate.ts'
import { getMetaOf } from '../../../src/client/sources/decoders.ts'
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
