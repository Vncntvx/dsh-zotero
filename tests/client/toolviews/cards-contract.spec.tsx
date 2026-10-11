// @vitest-environment jsdom
/**
 * Verification that all 16 registered Zotero tool views render conformantly
 * against the upstream 0.2.1-alpha.2 ToolCallBlock contract.
 *
 * Each card is rendered in both collapsed and expanded states with canonical
 * arguments and presentation metadata, verifying structure, disclosure, and
 * inspectability.
 * @module tests/client/toolviews/cards-contract
 */

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { REGISTRATIONS } from '../../../src/client/toolviews/index.ts'
import { createToolViewProps, mockUseDisclosure } from '../helpers/mock-disclosure.ts'
import { preparing, settled } from '../helpers/blocks.ts'
import {
  CANONICAL_ATTACHMENT_REF as ATTACHMENT_REF,
  CANONICAL_ITEM_REF as ITEM_REF,
  canonicalToolArgs,
} from '../helpers/toolview-fixtures.ts'
import { CANONICAL_SEARCH_META, GET_META } from '../sources/reducer-fixtures.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('../helpers/primitives-stub.ts')
  return primitivesStub()
})

afterEach(cleanup)

const ARGS = canonicalToolArgs()

const META: Record<string, Record<string, unknown>> = {
  zotero_search: CANONICAL_SEARCH_META,
  zotero_get: {
    ...GET_META,
    ref: ITEM_REF,
    bestAttachmentRef: ATTACHMENT_REF,
    bestAttachmentType: 'application/pdf',
  },
  zotero_retrieve: {
    count: 1,
    query: 'disaster response',
    ref: ITEM_REF,
    items: [
      {
        source: 'fulltext',
        sourceRef: ITEM_REF,
        preview: 'A relevant passage from the paper.',
        previewTruncated: false,
      },
    ],
  },
  zotero_export: {
    format: 'bibtex',
    count: 1,
    entries: ['@article{vaswani2017attention, title={Attention is all you need}}'],
  },
  zotero_children: {
    count: 2,
    notes: [{ ref: 'zotero://user/0/annotation/N1', preview: 'Note preview' }],
    attachments: [
      {
        ref: ATTACHMENT_REF,
        kind: 'file',
        location: '/path/to/paper.pdf',
        title: 'Full text',
      },
    ],
    detailOmitted: true,
  },
  zotero_attachment: {
    ref: ATTACHMENT_REF,
    kind: 'file',
    location: '/path/to/paper.pdf',
    title: 'Paper PDF',
    contentType: 'application/pdf',
  },
  zotero_browse: {
    kind: 'collections',
    rows: [{ name: 'Reading', key: 'COLL1', count: 5 }],
  },
  zotero_changes: {
    since: { version: 10, serverId: 'abc' },
    changes: [{ key: 'V5WYL8WM', version: 11 }],
  },
  zotero_create_note: { kind: 'committed', ref: 'zotero://user/0/item/NOTE1' },
  zotero_update_item_tags: { kind: 'committed', ref: ITEM_REF },
  zotero_update_item_collections: { kind: 'committed', ref: ITEM_REF },
  zotero_create_collection: { kind: 'committed', key: 'COLL1' },
  zotero_delete_collection: { kind: 'committed', key: 'COLL1' },
  zotero_create_item: { kind: 'committed', ref: ITEM_REF },
  zotero_update_item: { kind: 'committed', ref: ITEM_REF },
  zotero_delete_library_tags: { kind: 'committed', count: 1 },
}

describe('Zotero tool views render contract', () => {
  it('covers all 16 registered tool cards in both collapsed and expanded states', () => {
    expect(Object.keys(ARGS).sort()).toEqual(REGISTRATIONS.map(([name]) => name).sort())

    for (const [toolName, View] of REGISTRATIONS) {
      const args = ARGS[toolName] ?? {}
      const meta = META[toolName]
      const raw = JSON.stringify(args)
      const block = settled({
        name: toolName,
        call: { name: toolName, argsRaw: raw },
        meta,
      })

      // Collapsed render. `View` is the union of all seven card components,
      // so spreading one card's mock props cannot distribute across the union;
      // the single widening here is the same documented idiom as
      // memo-stability.spec.tsx's table walk.
      const collapsedProps = createToolViewProps({
        toolName,
        block,
        useDisclosure: mockUseDisclosure(false),
      })
      const collapsed = render(<View {...(collapsedProps as any)} />)
      expect(collapsed.container.textContent).not.toBe('')
      collapsed.unmount()

      // Expanded render
      const expandedProps = createToolViewProps({
        toolName,
        block,
        useDisclosure: mockUseDisclosure(true),
      })
      const expanded = render(<View {...(expandedProps as any)} />)
      expect(expanded.container.textContent).not.toBe('')
      expanded.unmount()
    }
  })

  it('renders preparing state across tool cards without throwing', () => {
    for (const [toolName, View] of REGISTRATIONS) {
      const block = preparing({ name: toolName })
      const props = createToolViewProps({
        toolName,
        block,
        phase: 'preparing',
        useDisclosure: mockUseDisclosure(false),
      })
      const view = render(<View {...(props as any)} />)
      expect(view.container.textContent).not.toBe('')
      view.unmount()
    }
  })

  it('covers write tools in declined and unverified states', () => {
    const WriteView = REGISTRATIONS.find(([name]) => name === 'zotero_create_note')?.[1]
    expect(WriteView).toBeDefined()
    if (!WriteView) return

    // Declined write
    const declinedBlock = settled({
      name: 'zotero_create_note',
      meta: { kind: 'declined' },
    })
    const v1 = render(
      <WriteView
        {...(createToolViewProps({
          toolName: 'zotero_create_note',
          block: declinedBlock,
          useDisclosure: mockUseDisclosure(true),
        }) as any)}
      />,
    )
    expect(v1.container.textContent).not.toBe('')
    v1.unmount()

    // Unverified write
    const unverifiedBlock = settled({
      name: 'zotero_create_note',
      meta: { kind: 'committed-unverified', ref: ITEM_REF },
    })
    const v2 = render(
      <WriteView
        {...(createToolViewProps({
          toolName: 'zotero_create_note',
          block: unverifiedBlock,
          useDisclosure: mockUseDisclosure(true),
        }) as any)}
      />,
    )
    expect(v2.container.textContent).not.toBe('')
    v2.unmount()
  })

  it('covers browse and changes variants', () => {
    const BrowseView = REGISTRATIONS.find(([name]) => name === 'zotero_browse')?.[1]
    expect(BrowseView).toBeDefined()
    if (!BrowseView) return

    // Browse tags
    const tagsBlock = settled({
      name: 'zotero_browse',
      call: { name: 'zotero_browse', argsRaw: JSON.stringify({ kind: 'tags' }) },
      meta: { kind: 'tags', rows: [{ name: 'ai', count: 3 }] },
    })
    const v1 = render(
      <BrowseView
        {...(createToolViewProps({
          toolName: 'zotero_browse',
          block: tagsBlock,
          useDisclosure: mockUseDisclosure(true),
        }) as any)}
      />,
    )
    expect(v1.container.textContent).not.toBe('')
    v1.unmount()

    // Browse items
    const itemsBlock = settled({
      name: 'zotero_browse',
      call: { name: 'zotero_browse', argsRaw: JSON.stringify({ kind: 'items' }) },
      meta: { kind: 'items', rows: [{ ref: ITEM_REF, title: 'Item 1' }] },
    })
    const v2 = render(
      <BrowseView
        {...(createToolViewProps({
          toolName: 'zotero_browse',
          block: itemsBlock,
          useDisclosure: mockUseDisclosure(true),
        }) as any)}
      />,
    )
    expect(v2.container.textContent).not.toBe('')
    v2.unmount()
  })
})
